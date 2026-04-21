from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import List, Dict, Any
from app.services.narrator import generate_narrative
from app.services.enricher import get_news_context_cached
from app.models.schemas import NarrativeResponse
from app.rate_limit import limiter

router = APIRouter()

class NarrativeRequest(BaseModel):
    anomaly_data: Dict[str, Any]
    correlation_data: List[str]

@router.post("/narrate", response_model=NarrativeResponse)
@limiter.limit("10/minute")
async def narrate_anomaly(request: Request, payload: NarrativeRequest):
    # 1. Get News Context
    # Using column name and value as search terms, plus anomaly date if exists
    search_query = f"{payload.anomaly_data['column']} spike drop"
    date = payload.anomaly_data.get('timestamp', '')
    
    news = await get_news_context_cached(search_query, date)
    
    # 2. Generate Story
    story = await generate_narrative(
        payload.anomaly_data,
        payload.correlation_data,
        news
    )
    
    return NarrativeResponse(
        story=story,
        context=", ".join([n.get("title", "") for n in news if n.get("title")]) if news else "No external context found",
        articles=news,
    )
