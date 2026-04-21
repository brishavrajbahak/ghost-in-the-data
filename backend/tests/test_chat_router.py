import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_chat_start_and_send(monkeypatch):
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

    async def fake_narrative(anomaly_data, correlation_data, news_context):
        return "# Initial Story\n\nHello."

    async def fake_chat_reply(**kwargs):
        # Ensure the prompt builder got a transcript with the user message.
        msgs = kwargs.get("messages") or []
        assert any(m.get("role") == "user" for m in msgs)
        return "Follow-up answer."

    from app.routers import chat as chat_router
    from app.services import narrator as narrator_service

    monkeypatch.setattr(chat_router, "get_news_context_cached", fake_news)
    # Patch both the import site in the router and the service module to avoid real API calls.
    monkeypatch.setattr(chat_router, "generate_narrative", fake_narrative)
    monkeypatch.setattr(chat_router, "generate_chat_reply", fake_chat_reply)
    monkeypatch.setattr(narrator_service, "generate_narrative", fake_narrative)
    monkeypatch.setattr(narrator_service, "generate_chat_reply", fake_chat_reply)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        start = await client.post(
            "/api/chat/start",
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

        assert start.status_code == 200
        s = start.json()
        assert s["session_id"]
        assert s["messages"][0]["role"] == "assistant"
        assert "Initial Story" in s["messages"][0]["content"]

        send = await client.post("/api/chat/send", json={"session_id": s["session_id"], "message": "Why did this happen?"})
        assert send.status_code == 200
        body = send.json()
        assert len(body["messages"]) >= 3
        assert body["messages"][-1]["role"] == "assistant"
        assert "Follow-up answer" in body["messages"][-1]["content"]
