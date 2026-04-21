from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
import pandas as pd
import io
import json
from typing import List, Optional
from app.models.schemas import AnalysisResult, Anomaly
from app.services.detector import detect_anomalies
from app.services.correlator import analyze_correlations
from fastapi.encoders import jsonable_encoder
from app.services.rca import analyze_root_cause
from app.db import engine, SessionLocal
from app.models.db_models import AnalysisSession as AnalysisSessionModel
from app.rate_limit import limiter
import logging

router = APIRouter()
logger = logging.getLogger("ghost.analysis")

MAX_UPLOAD_BYTES = 10 * 1024 * 1024

@router.post("/analyze", response_model=AnalysisResult)
@limiter.limit("5/minute")
async def analyze_data(
    request: Request,
    file: UploadFile = File(...),
    detectors: Optional[str] = Form(None),
    max_anomalies: int = Form(50),
):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")
    
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="CSV too large (max 10MB).")
    try:
        df = pd.read_csv(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error parsing CSV: {str(e)}")

    if len(df) < 2:
        raise HTTPException(status_code=400, detail="CSV must contain at least 2 rows.")
    numeric_cols = df.select_dtypes(include=["number"]).columns.tolist()
    if not numeric_cols:
        raise HTTPException(status_code=400, detail="CSV must contain at least 1 numeric column.")

    logger.info("Analyze: file=%s rows=%s cols=%s", file.filename, len(df), len(df.columns))
    
    # 1. Detect Anomalies
    detector_list: Optional[List[str]] = None
    if detectors:
        try:
            parsed = json.loads(detectors)
            if isinstance(parsed, list) and all(isinstance(x, str) for x in parsed):
                detector_list = parsed
        except Exception:
            detector_list = None

    anomalies = detect_anomalies(df, detectors=detector_list, max_results=max_anomalies)
    
    # 2. Analyze Correlations
    correlations = analyze_correlations(df, anomalies)

    metadata = {
        "total_rows": len(df),
        "numeric_cols": df.select_dtypes(include=['number']).columns.tolist(),
    }
    if detector_list:
        metadata["detectors_used"] = detector_list

    # V4 Phase 2: RCA for top anomalies (best-effort)
    rca_reports = {}
    try:
        top = anomalies[:5]
        for a in top:
            report = analyze_root_cause(
                df,
                anomaly=a.model_dump(),
                all_anomalies=[x.model_dump() for x in anomalies],
                window=5,
            )
            rca_reports[str(a.index)] = report
        metadata["rca_reports"] = rca_reports
    except Exception:
        logger.exception("RCA generation failed; continuing without RCA.")
        rca_reports = {}

    # Try to capture an overall time span for Recall UI (best-effort).
    try:
        ts_col = None
        for c in ("date", "timestamp", "time", "datetime"):
            if c in df.columns:
                ts_col = c
                break
        if not ts_col:
            for c in df.columns:
                parsed = pd.to_datetime(df[c], errors="coerce", utc=True)
                if parsed.notna().mean() >= 0.5:
                    ts_col = c
                    break
        if ts_col:
            parsed = pd.to_datetime(df[ts_col], errors="coerce", utc=True)
            parsed = parsed.dropna()
            if len(parsed):
                metadata["timestamp_col"] = str(ts_col)
                metadata["time_span"] = {"start": parsed.min().isoformat(), "end": parsed.max().isoformat()}
    except Exception:
        pass

    session_id: Optional[str] = None
    if engine is not None and SessionLocal is not None:
        try:
            csv_text: Optional[str] = None
            try:
                # Store raw CSV for Recall (cap to keep DB reasonable).
                if len(contents) <= 5_000_000:
                    csv_text = contents.decode("utf-8", errors="replace")
                    metadata["csv_stored"] = True
                else:
                    metadata["csv_stored"] = False
                    metadata["csv_bytes"] = int(len(contents))
            except Exception:
                csv_text = None

            async with SessionLocal() as db:
                row = AnalysisSessionModel(
                    filename=file.filename,
                    analysis_metadata=metadata,
                    anomalies=jsonable_encoder(anomalies),
                    correlations=jsonable_encoder(correlations),
                    csv_text=csv_text,
                )
                db.add(row)
                await db.commit()
                await db.refresh(row)
                session_id = row.id
        except Exception:
            logger.exception("Analyze persistence failed; continuing without session_id.")
            session_id = None
    
    return AnalysisResult(
        anomalies=anomalies,
        correlations=correlations,
        metadata=metadata,
        session_id=session_id,
        rca_reports=rca_reports or None,
    )
