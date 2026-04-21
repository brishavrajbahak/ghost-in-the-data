import os

import pandas as pd
import pytest


@pytest.mark.asyncio
async def test_agentic_loop_executes_tools(monkeypatch):
    os.environ["GOOGLE_API_KEY"] = "test"

    from google.genai import types
    from app.services import narrator

    df = pd.DataFrame({"timestamp": ["2024-03-01T00:00:00Z"], "revenue": [100]})

    class _FakeAioModels:
        def __init__(self):
            self.calls = 0

        async def generate_content(self, *, model, contents, config):
            self.calls += 1
            if self.calls == 1:
                content = types.Content(
                    role="model",
                    parts=[
                        types.Part(
                            functionCall=types.FunctionCall(name="get_column_stats", args={"column": "revenue"})
                        )
                    ],
                )
                return type(
                    "Resp",
                    (),
                    {
                        "text": "",
                        "candidates": [type("Cand", (), {"content": content})()],
                    },
                )()
            # second call: final text, no function calls
            content = types.Content(role="model", parts=[types.Part(text="Final answer based on tools.")])
            return type(
                "Resp",
                (),
                {
                    "text": "Final answer based on tools.",
                    "candidates": [type("Cand", (), {"content": content})()],
                },
            )()

    class _FakeClient:
        def __init__(self, api_key=None):
            self.aio = type("Aio", (), {"models": _FakeAioModels()})()

    # Patch google genai client
    monkeypatch.setattr("google.genai.Client", _FakeClient)

    answer, events = await narrator.generate_chat_reply_agentic(
        anomaly_data={"column": "revenue", "value": 100, "expected_range": [90, 110], "severity": 0.5, "detectors": []},
        correlation_data=[],
        articles=[],
        messages=[{"role": "user", "content": "What is revenue stats?"}],
        df=df,
        max_iters=3,
    )

    assert "Final answer" in answer
    assert events and events[0]["tool_name"] == "get_column_stats"
    assert events[0]["result"]["column"] == "revenue"
