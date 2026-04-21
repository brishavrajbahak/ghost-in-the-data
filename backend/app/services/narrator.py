import os
from typing import Any, Dict, List
from dotenv import load_dotenv
import logging
import asyncio
import hashlib
import json
import time

load_dotenv()

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
logger = logging.getLogger("ghost.narrator")

_CACHE_TTL_SECONDS = 60 * 60 * 6
_CACHE: Dict[str, tuple[float, str]] = {}


def _cache_get(key: str) -> str | None:
    now = time.time()
    hit = _CACHE.get(key)
    if not hit:
        return None
    ts, val = hit
    if now - ts > _CACHE_TTL_SECONDS:
        _CACHE.pop(key, None)
        return None
    return val


def _cache_set(key: str, val: str) -> None:
    _CACHE[key] = (time.time(), val)


def _make_key(prefix: str, payload: Dict[str, Any]) -> str:
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
    h = hashlib.sha256(blob).hexdigest()
    return f"{prefix}:{GEMINI_MODEL}:{h}"


def _looks_like_rate_limit(err: Exception) -> bool:
    s = str(err)
    return "429" in s or "RESOURCE_EXHAUSTED" in s or "rate" in s.lower() and "limit" in s.lower()

def _gemini_api_key() -> str | None:
    # Read at call-time so tests/CI can set env vars after module import.
    v = os.getenv("GOOGLE_API_KEY")
    if not v or v == "your_gemini_api_key_here":
        return None
    return v


async def _generate_with_backoff(client, *, model: str, contents: str, retries: int = 3) -> str:
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        try:
            resp = await client.aio.models.generate_content(model=model, contents=contents)
            return resp.text or ""
        except Exception as e:
            last_exc = e
            if attempt >= retries or not _looks_like_rate_limit(e):
                raise
            sleep_s = 1.2 * (2**attempt)
            logger.warning("Gemini rate-limited; retrying in %.1fs (attempt %s/%s)", sleep_s, attempt + 1, retries + 1)
            await asyncio.sleep(sleep_s)

    raise last_exc or RuntimeError("Gemini call failed")

async def generate_narrative(anomaly_data: Dict[str, Any], correlation_data: List[str], news_context: List[Dict[str, Any]]) -> str:
    """
    Generate a human-readable story about an anomaly using Gemini.
    """
    api_key = _gemini_api_key()
    if not api_key:
        return "AI Narrative generation is unavailable. Please check your API key."

    news_lines = ""
    if news_context:
        # Keep it compact but include the citation URLs so the model can reference sources.
        news_lines = chr(10).join(
            [
                f"- {n.get('title','')}" + (f" ({n.get('published_at')})" if n.get("published_at") else "")
                + (f": {n.get('link')}" if n.get("link") else "")
                for n in news_context
                if n.get("title")
            ]
        )

    prompt = f"""
    You are an expert Data Analyst and Storyteller called "The Ghost".
    Your job is to look at data anomalies and tell the human story behind them.

    ANOMALY DETECTED:
    - Column: {anomaly_data['column']}
    - Value: {anomaly_data['value']}
    - Expected Range: {anomaly_data['expected_range']}
    - Severity Score: {anomaly_data['severity']}
    - Detection Signal: {', '.join(anomaly_data['detectors'])}
    - Date/Context: {anomaly_data.get('timestamp', 'N/A')}

    CORRELATED CHANGES AT THE SAME TIME:
    {', '.join(correlation_data) if correlation_data else "No significant correlations found."}

    EXTERNAL NEWS/EVENTS NEAR THIS DATE:
    {news_lines if news_lines else "No external news correlations found."}

    INSTRUCTIONS:
    1. Write a compelling title for this anomaly story.
    2. Explain what exactly happened in simple terms.
    3. Speculate on potential root causes based on the correlations and news (if any).
    4. Assess the business impact.
    5. Suggest a "Spectral Investigation" (what a human should check next).
    6. Maintain a professional yet slightly mysterious "Ghost" persona.
    7. Use Markdown formatting.
    """

    try:
        # google-genai SDK (successor to google-generativeai)
        from google import genai

        cache_key = _make_key(
            "narrative",
            {"anomaly": anomaly_data, "correlation": correlation_data, "news": news_context},
        )
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        client = genai.Client(api_key=api_key)
        text = await _generate_with_backoff(client, model=GEMINI_MODEL, contents=prompt)
        _cache_set(cache_key, text)
        return text
    except Exception as e:
        logger.warning("Gemini narrative failed: %s", str(e))
        if _looks_like_rate_limit(e):
            return "The Ghost is temporarily rate-limited by Gemini. Please try again in a minute."
        return f"The Ghost encountered an error: {str(e)}"


async def generate_chat_reply(
    *,
    anomaly_data: Dict[str, Any],
    correlation_data: List[str],
    articles: List[Dict[str, Any]],
    messages: List[Dict[str, Any]],
) -> str:
    api_key = _gemini_api_key()
    if not api_key:
        return "AI chat is unavailable. Please check your API key."

    from app.services.chat_prompt import build_chat_prompt

    prompt = build_chat_prompt(
        anomaly_data=anomaly_data,
        correlation_data=correlation_data,
        articles=articles,
        messages=messages,
    )

    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        cache_key = _make_key(
            "chat",
            {"anomaly": anomaly_data, "correlation": correlation_data, "articles": articles, "messages": messages[-12:]},
        )
        cached = _cache_get(cache_key)
        if cached is not None:
            return cached

        text = await _generate_with_backoff(client, model=GEMINI_MODEL, contents=prompt)
        _cache_set(cache_key, text)
        return text
    except Exception as e:
        logger.warning("Gemini chat failed: %s", str(e))
        if _looks_like_rate_limit(e):
            return "The Ghost is temporarily rate-limited by Gemini. Please try again in a minute."
        return f"The Ghost encountered an error: {str(e)}"


async def generate_chat_reply_agentic(
    *,
    anomaly_data: Dict[str, Any],
    correlation_data: List[str],
    articles: List[Dict[str, Any]],
    messages: List[Dict[str, Any]],
    df,
    max_iters: int = 3,
) -> tuple[str, List[Dict[str, Any]]]:
    """
    Gemini tool-calling loop. Returns (final_answer, tool_events).

    tool_events is a list of dicts:
      { tool_name, args, result, error }
    """
    api_key = _gemini_api_key()
    if not api_key:
        return "AI chat is unavailable. Please check your API key.", []

    from app.services.chat_prompt import build_chat_prompt
    from app.services.tools import TOOL_SPECS, execute_tool, ToolExecutionError

    prompt = build_chat_prompt(
        anomaly_data=anomaly_data,
        correlation_data=correlation_data,
        articles=articles,
        messages=messages,
    )

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        tool_decls = [
            types.FunctionDeclaration(
                name=name,
                description=spec.get("description"),
                parametersJsonSchema=spec.get("parametersJsonSchema"),
            )
            for name, spec in TOOL_SPECS.items()
        ]

        tools = [types.Tool(functionDeclarations=tool_decls)]
        system = (
            'You are an expert Data Analyst and Investigator called "The Ghost". '
            "You may call the provided tools to query the uploaded dataset. "
            "Tools are read-only; never claim you ran a query unless you actually called a tool. "
            "When asked for drivers/causes, prefer tool evidence over speculation. "
            "Keep answers concise and cite tool results explicitly."
        )

        history: List[types.Content] = [
            types.Content(role="user", parts=[types.Part(text=prompt)]),
        ]

        cfg = types.GenerateContentConfig(
            tools=tools,
            systemInstruction=system,
            temperature=0.25,
        )

        tool_events: List[Dict[str, Any]] = []

        for _ in range(max(1, int(max_iters))):
            resp = await client.aio.models.generate_content(model=GEMINI_MODEL, contents=history, config=cfg)
            content = None
            try:
                content = resp.candidates[0].content
            except Exception:
                content = None

            calls: List[Any] = []
            if content and getattr(content, "parts", None):
                for p in content.parts:
                    fc = getattr(p, "function_call", None)
                    if fc is not None:
                        calls.append(fc)

            # If no tool calls, return text.
            if not calls:
                text = resp.text or ""
                if not text and content and getattr(content, "parts", None):
                    text = "\n".join([p.text for p in content.parts if getattr(p, "text", None)]) or ""
                return text.strip() or "(No response.)", tool_events

            # Record the model function calls into history then execute.
            history.append(content or types.Content(role="model", parts=[]))

            tool_parts: List[types.Part] = []
            for fc in calls:
                name = getattr(fc, "name", "") or ""
                args = getattr(fc, "args", None) or {}
                event: Dict[str, Any] = {"tool_name": name, "args": args, "result": None, "error": None}
                try:
                    result = execute_tool(df, name=name, args=args)
                    event["result"] = result
                    tool_parts.append(
                        types.Part(
                            functionResponse=types.FunctionResponse(
                                name=name,
                                response={"ok": True, "result": result},
                            )
                        )
                    )
                except ToolExecutionError as e:
                    event["error"] = str(e)
                    tool_parts.append(
                        types.Part(
                            functionResponse=types.FunctionResponse(
                                name=name,
                                response={"ok": False, "error": str(e)},
                            )
                        )
                    )
                tool_events.append(event)

            history.append(types.Content(role="tool", parts=tool_parts))

        return "The Ghost could not complete the investigation in time. Try asking a narrower question.", tool_events
    except Exception as e:
        logger.warning("Gemini agentic chat failed: %s", str(e))
        if _looks_like_rate_limit(e):
            return "The Ghost is temporarily rate-limited by Gemini. Please try again in a minute.", []
        return f"The Ghost encountered an error: {str(e)}", []
