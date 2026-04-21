import httpx
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from dotenv import load_dotenv
import time
import logging

load_dotenv()

NEWS_API_KEY = os.getenv("NEWSDATA_API_KEY")
logger = logging.getLogger("ghost.enricher")

_CACHE_TTL_SECONDS = 60 * 60 * 24
_CACHE: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}

def _parse_date(value: str) -> Optional[datetime]:
    if not value:
        return None

    raw = str(value).strip()

    # Fast paths: YYYY-MM-DD, ISO-ish, or python datetime strings.
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            pass

    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _date_window(date_value: str, days: int = 7) -> Optional[Tuple[str, str]]:
    dt = _parse_date(date_value)
    if not dt:
        return None

    start = (dt - timedelta(days=days)).date().isoformat()
    end = (dt + timedelta(days=days)).date().isoformat()
    return start, end


def _normalize_article(result: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "title": result.get("title") or "",
        "link": result.get("link") or result.get("url") or "",
        "description": result.get("description") or result.get("content") or "",
        "source": result.get("source_id") or result.get("source") or result.get("creator") or None,
        "published_at": result.get("pubDate") or result.get("publishedAt") or result.get("pub_date") or None,
    }


async def get_news_context(query: str, date: str) -> List[Dict[str, Any]]:
    """
    Query NewsData.io for news articles around a specific date and topic.
    """
    if not NEWS_API_KEY or NEWS_API_KEY == "your_newsdata_api_key_here":
        return []

    # NewsData date filtering varies by tier/endpoint; try a +/- window first then fallback.
    url = "https://newsdata.io/api/1/news"
    params: Dict[str, Any] = {
        "apikey": NEWS_API_KEY,
        "q": query,
        "language": "en",
    }

    window = _date_window(date, days=7)
    if window:
        from_date, to_date = window
        params["from_date"] = from_date
        params["to_date"] = to_date
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params, timeout=15.0)
            if response.status_code != 200 and window:
                # Fallback: remove date filters if not supported.
                params.pop("from_date", None)
                params.pop("to_date", None)
                response = await client.get(url, params=params, timeout=15.0)

            if response.status_code != 200:
                return []

            data = response.json()
            results = data.get("results", []) or []
            # Return top 3 articles with stable fields for UI citations.
            return [_normalize_article(r) for r in results[:3]]
    except Exception as e:
        logger.warning("News fetch failed: %s", str(e))
        return []


def _cache_key(query: str, date: str) -> str:
    window = _date_window(date, days=7)
    if window:
        from_date, to_date = window
        return f"{query.strip().lower()}|{from_date}|{to_date}"
    return f"{query.strip().lower()}|no-date"


async def get_news_context_cached(query: str, date: str, ttl_seconds: int = _CACHE_TTL_SECONDS) -> List[Dict[str, Any]]:
    """
    Cached wrapper around get_news_context() with a default 24h TTL.
    Caches both hits and empty results to reduce API usage.
    """
    key = _cache_key(query, date)
    now = time.time()
    if key in _CACHE:
        ts, payload = _CACHE[key]
        if now - ts <= ttl_seconds:
            return payload

    payload = await get_news_context(query, date)
    _CACHE[key] = (now, payload)
    return payload
