from typing import Any, Dict, List


def build_chat_prompt(
    *,
    anomaly_data: Dict[str, Any],
    correlation_data: List[str],
    articles: List[Dict[str, Any]],
    messages: List[Dict[str, Any]],
) -> str:
    news_lines = ""
    if articles:
        news_lines = "\n".join(
            [
                f"- {a.get('title','')}"
                + (f" ({a.get('published_at')})" if a.get("published_at") else "")
                + (f": {a.get('link')}" if a.get("link") else "")
                for a in articles
                if a.get("title")
            ][:6]
        )

    header = f"""You are an expert Data Analyst and Investigator called "The Ghost".
You are in a chat with a human. Be helpful, concrete, and grounded in the data + context provided.

CASE FILE (anomaly):
- Column: {anomaly_data.get('column')}
- Value: {anomaly_data.get('value')}
- Expected Range: {anomaly_data.get('expected_range')}
- Severity: {anomaly_data.get('severity')}
- Detection Signal: {", ".join(anomaly_data.get("detectors", []) or [])}
- Timestamp: {anomaly_data.get('timestamp', 'N/A')}

CORRELATED CHANGES:
{", ".join(correlation_data) if correlation_data else "No significant correlations found."}

EXTERNAL CONTEXT (links):
{news_lines if news_lines else "No external context available."}

INSTRUCTIONS:
- Answer the user’s latest question.
- If you make claims about external events, keep them conditional unless supported by provided links.
- Suggest 1–3 concrete next checks the user can do in the dataset.
- Use Markdown.
"""

    transcript_lines = []
    for m in messages[-12:]:
        role = (m.get("role") or "").strip().lower()
        content = (m.get("content") or "").strip()
        if not content:
            continue
        tag = "User" if role == "user" else "Assistant"
        transcript_lines.append(f"{tag}: {content}")

    transcript = "\n\n".join(transcript_lines)
    return header + "\n\nCHAT HISTORY:\n" + transcript + "\n\nAssistant:"

