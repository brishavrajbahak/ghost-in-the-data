import pandas as pd
import numpy as np
from typing import Dict, Any

def profile_data(df: pd.DataFrame) -> Dict[str, Any]:
    profile = {
        "row_count": len(df),
        "column_names": df.columns.tolist(),
        "column_types": {},
        "statsSummary": {}
    }
    
    for col in df.columns:
        dtype = str(df[col].dtype)
        profile["column_types"][col] = dtype
        
        if np.issubdtype(df[col].dtype, np.number):
            profile["statsSummary"][col] = {
                "mean": float(df[col].mean()) if not pd.isna(df[col].mean()) else 0,
                "median": float(df[col].median()) if not pd.isna(df[col].median()) else 0,
                "std": float(df[col].std()) if not pd.isna(df[col].std()) else 0,
                "min": float(df[col].min()) if not pd.isna(df[col].min()) else 0,
                "max": float(df[col].max()) if not pd.isna(df[col].max()) else 0,
                "null_count": int(df[col].isna().sum())
            }
        else:
            profile["statsSummary"][col] = {
                "unique_count": int(df[col].nunique()),
                "null_count": int(df[col].isna().sum())
            }
            
    return profile
