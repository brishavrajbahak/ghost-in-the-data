from fastapi import APIRouter, UploadFile, File, HTTPException
import pandas as pd
import io
from app.models.schemas import DataProfile
from app.services.profiler import profile_data

router = APIRouter()

@router.post("/upload", response_model=DataProfile)
async def upload_file(file: UploadFile = File(...)):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")
    
    contents = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error parsing CSV: {str(e)}")
    
    # Simple profiling
    profile = profile_data(df)
    
    return profile
