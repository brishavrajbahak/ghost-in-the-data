import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_narrate_endpoint_returns_story_and_articles(monkeypatch):
    async def fake_news(query: str, date: str, ttl_seconds: int = 0):
        return [
            {
                "title": "Example context",
                "link": "https://example.com/x",
                "description": "desc",
                "source": "example",
                "published_at": "2026-04-19",
            }
        ]

    async def fake_story(anomaly_data, correlation_data, news_context):
        assert news_context and news_context[0]["title"] == "Example context"
        return "# Story\n\nSomething happened."

    # Patch at router module import site
    from app.routers import narrative as narrative_router

    monkeypatch.setattr(narrative_router, "get_news_context_cached", fake_news)
    monkeypatch.setattr(narrative_router, "generate_narrative", fake_story)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/narrate",
            json={
                "anomaly_data": {
                    "index": 7,
                    "column": "cpu",
                    "value": 99,
                    "expected_range": [10, 20],
                    "severity": 0.9,
                    "detectors": ["Z-Score", "IQR"],
                    "timestamp": "2026-04-19",
                },
                "correlation_data": ["memory also spiked"],
            },
        )

    assert res.status_code == 200
    body = res.json()
    assert "Story" in body["story"]
    assert isinstance(body.get("articles"), list) and body["articles"][0]["link"] == "https://example.com/x"
