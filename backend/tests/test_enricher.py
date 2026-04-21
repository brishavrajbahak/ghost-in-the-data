from datetime import timezone

import pytest
import respx
from httpx import Response

from app.services import enricher


def test_parse_date_accepts_common_formats():
    dt = enricher._parse_date("2026-04-19")
    assert dt is not None
    assert dt.tzinfo == timezone.utc

    dt2 = enricher._parse_date("2026-04-19T10:20:30Z")
    assert dt2 is not None
    assert dt2.tzinfo is not None


def test_date_window_is_symmetric():
    start, end = enricher._date_window("2026-04-19", days=7)
    assert start == "2026-04-12"
    assert end == "2026-04-26"


@pytest.mark.asyncio
async def test_get_news_context_uses_date_window_and_normalizes_fields(monkeypatch):
    monkeypatch.setattr(enricher, "NEWS_API_KEY", "test-key")

    with respx.mock(assert_all_called=True) as mock:
        route = mock.get("https://newsdata.io/api/1/news").mock(
            return_value=Response(
                200,
                json={
                    "results": [
                        {
                            "title": "Example headline",
                            "link": "https://example.com/a",
                            "description": "A desc",
                            "source_id": "example",
                            "pubDate": "2026-04-18 10:00:00",
                        }
                    ]
                },
            )
        )

        articles = await enricher.get_news_context("cpu spike drop", "2026-04-19")
        assert route.called

        request = route.calls[0].request
        qs = dict(request.url.params)
        assert qs.get("from_date") == "2026-04-12"
        assert qs.get("to_date") == "2026-04-26"

        assert articles and isinstance(articles, list)
        a = articles[0]
        assert a["title"] == "Example headline"
        assert a["link"] == "https://example.com/a"
        assert a["source"] == "example"
        assert a["published_at"] == "2026-04-18 10:00:00"

