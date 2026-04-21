import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_context_prefetch_returns_articles_by_index(monkeypatch):
    async def fake_cached(query: str, date: str, ttl_seconds: int = 0):
        return [{"title": "T", "link": "https://example.com", "published_at": "2026-04-19"}]

    from app.routers import context as context_router

    monkeypatch.setattr(context_router, "get_news_context_cached", fake_cached)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/context/prefetch",
            json={
                "anomalies": [
                    {"index": 1, "column": "cpu", "timestamp": "2026-04-19"},
                    {"index": 2, "column": "mem", "timestamp": "2026-04-19"},
                ],
                "limit": 2,
            },
        )

    assert res.status_code == 200
    body = res.json()
    assert body["articles_by_index"]["1"][0]["link"] == "https://example.com"
