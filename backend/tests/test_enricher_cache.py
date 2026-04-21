import pytest
import respx
from httpx import Response

from app.services import enricher


@pytest.mark.asyncio
async def test_get_news_context_cached_caches_results(monkeypatch):
    monkeypatch.setattr(enricher, "NEWS_API_KEY", "test-key")

    with respx.mock(assert_all_called=True) as mock:
        route = mock.get("https://newsdata.io/api/1/news").mock(
            return_value=Response(200, json={"results": [{"title": "A", "link": "https://example.com"}]}),
        )

        a1 = await enricher.get_news_context_cached("cpu spike drop", "2026-04-19", ttl_seconds=9999)
        a2 = await enricher.get_news_context_cached("cpu spike drop", "2026-04-19", ttl_seconds=9999)

        assert route.call_count == 1
        assert a1 == a2

