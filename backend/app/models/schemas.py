from pydantic import BaseModel
from typing import List, Dict, Any, Optional

class DataProfile(BaseModel):
    row_count: int
    column_names: List[str]
    column_types: Dict[str, str]
    statsSummary: Dict[str, Any]

class Anomaly(BaseModel):
    index: int
    column: str
    value: float
    expected_range: List[float]
    severity: float
    detectors: List[str]
    timestamp: Optional[str] = None

class AnalysisResult(BaseModel):
    anomalies: List[Anomaly]
    correlations: Dict[str, List[str]]
    metadata: Dict[str, Any]
    session_id: Optional[str] = None
    rca_reports: Optional[Dict[str, Any]] = None

class NewsArticle(BaseModel):
    title: str
    link: str
    description: Optional[str] = None
    source: Optional[str] = None
    published_at: Optional[str] = None

class NarrativeResponse(BaseModel):
    story: str
    context: Optional[str] = None
    articles: List[NewsArticle] = []
