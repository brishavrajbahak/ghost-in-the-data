from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
import asyncio

from app.services.enricher import get_news_context_cached

router = APIRouter()


class PrefetchRequest(BaseModel):
    anomalies: List[Dict[str, Any]] = Field(default_factory=list)
    limit: int = 6


class PrefetchResponse(BaseModel):
    articles_by_index: Dict[str, List[Dict[str, Any]]] = Field(default_factory=dict)


@router.post("/context/prefetch", response_model=PrefetchResponse)
async def prefetch_context(request: PrefetchRequest):
    """
    Auto-search: prefetch external context for detected anomalies.
    Uses a 24h cache to reduce API usage.
    """
    anomalies = request.anomalies or []
    limit = max(0, min(int(request.limit or 0), 12))
    anomalies = anomalies[:limit] if limit else anomalies[:6]

    sem = asyncio.Semaphore(3)

    async def fetch_for(a: Dict[str, Any]):
        idx = str(a.get("index"))
        col = str(a.get("column") or "").strip()
        ts = str(a.get("timestamp") or "").strip()
        if not idx or idx == "None" or not col:
            return idx, []
        query = f"{col} spike drop"
        async with sem:
            articles = await get_news_context_cached(query, ts)
        return idx, articles

    tasks = [fetch_for(a) for a in anomalies]
    pairs = await asyncio.gather(*tasks, return_exceptions=False)
    return PrefetchResponse(articles_by_index={k: v for k, v in pairs if k and k != "None"})

