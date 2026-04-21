import pandas as pd
import numpy as np
from typing import Any, Dict, List

def analyze_correlations(df: pd.DataFrame, anomalies: List[Any]) -> Dict[str, List[str]]:
    """
    Find columns that change significantly at the same time as the detected anomalies.
    """
    numeric_df = df.select_dtypes(include=[np.number])
    if numeric_df.empty or not anomalies:
        return {}

    correlations = {}
    
    # Get indices of anomalies
    anomaly_indices = list(set([a.index for a in anomalies]))
    
    # For each anomalous index, find other columns that also deviate from their mean
    for idx in anomaly_indices:
        correlated_cols = []
        for col in numeric_df.columns:
            mean = numeric_df[col].mean()
            std = numeric_df[col].std()
            val = numeric_df.iloc[idx][col]
            
            # If value is > 2 std from mean, consider it 'correlated' anomaly
            if abs(val - mean) > 2 * std:
                correlated_cols.append(col)
        
        correlations[str(idx)] = correlated_cols
        
    return correlations
