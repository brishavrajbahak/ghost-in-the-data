from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from scipy import stats


def _pick_timestamp_column(df: pd.DataFrame) -> Optional[str]:
    for candidate in ("date", "timestamp", "time", "datetime"):
        if candidate in df.columns:
            return candidate
    for c in df.columns:
        parsed = pd.to_datetime(df[c], errors="coerce", utc=True)
        if parsed.notna().mean() >= 0.5:
            return c
    return None


def _safe_float(x) -> Optional[float]:
    try:
        if x is None:
            return None
        v = float(x)
        if np.isnan(v):
            return None
        return v
    except Exception:
        return None


def _window_slices(df: pd.DataFrame, *, anomaly_index: int, window: int) -> Tuple[pd.DataFrame, pd.DataFrame]:
    # anomaly_index matches df index for RangeIndex case; fall back to iloc.
    idx = int(anomaly_index)
    if idx in df.index:
        pos = df.index.get_loc(idx)
    else:
        if idx < 0 or idx >= len(df):
            raise ValueError("anomaly_index out of range")
        pos = idx

    left = max(0, pos - window)
    right = min(len(df) - 1, pos + window)
    around = df.iloc[left : right + 1]

    # baseline: rows outside the around window (sampled)
    baseline = pd.concat([df.iloc[:left], df.iloc[right + 1 :]], axis=0)
    if len(baseline) > 600:
        baseline = baseline.sample(600, random_state=42)
    return around, baseline


def _driver_changes(df: pd.DataFrame, *, target_col: str, anomaly_index: int, window: int) -> List[Dict[str, Any]]:
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if not numeric_cols:
        return []

    around, baseline = _window_slices(df, anomaly_index=anomaly_index, window=window)
    out: List[Dict[str, Any]] = []
    for c in numeric_cols:
        if c == target_col:
            continue
        a = pd.to_numeric(around[c], errors="coerce").dropna()
        b = pd.to_numeric(baseline[c], errors="coerce").dropna()
        if len(a) < 3 or len(b) < 8:
            continue
        mean_a = float(a.mean())
        mean_b = float(b.mean())
        std_b = float(b.std(ddof=1)) if len(b) > 2 else 0.0
        delta = mean_a - mean_b
        z = float(delta / std_b) if std_b else None
        t = stats.ttest_ind(a.values, b.values, equal_var=False, nan_policy="omit")
        out.append(
            {
                "column": str(c),
                "window_mean": mean_a,
                "baseline_mean": mean_b,
                "delta": float(delta),
                "z_delta": z,
                "p_value": _safe_float(t.pvalue),
            }
        )
    out.sort(key=lambda r: abs(r.get("z_delta") or 0.0), reverse=True)
    return out[:12]


def _decision_tree_explainer(
    df: pd.DataFrame, *, target_col: str, anomaly_index: int, window: int
) -> List[Dict[str, Any]]:
    try:
        from sklearn.tree import DecisionTreeClassifier
    except Exception:
        return []

    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    features = [c for c in numeric_cols if c != target_col]
    if len(features) < 2:
        return []

    around, baseline = _window_slices(df, anomaly_index=anomaly_index, window=window)
    if len(around) < 6 or len(baseline) < 20:
        return []

    # label around-window as 1, baseline as 0
    X = pd.concat([around[features], baseline[features]], axis=0)
    y = np.array([1] * len(around) + [0] * len(baseline))
    X = X.apply(pd.to_numeric, errors="coerce").fillna(X.median(numeric_only=True))

    clf = DecisionTreeClassifier(max_depth=3, min_samples_leaf=8, random_state=42)
    clf.fit(X.values, y)
    imps = clf.feature_importances_
    ranked = sorted(zip(features, imps), key=lambda t: float(t[1]), reverse=True)
    out = [{"column": c, "importance": float(v)} for c, v in ranked if float(v) > 0][:8]
    return out


def _granger_tests(
    df: pd.DataFrame, *, target_col: str, candidate_cols: List[str], maxlag: int = 2
) -> List[Dict[str, Any]]:
    """
    Best-effort Granger causality p-values. Returns a list of {column, min_p_value, best_lag}.
    """
    try:
        from statsmodels.tsa.stattools import grangercausalitytests
    except Exception:
        return []

    ts_col = _pick_timestamp_column(df)
    if not ts_col:
        return []

    temp = df[[ts_col, target_col] + candidate_cols].copy()
    temp[ts_col] = pd.to_datetime(temp[ts_col], errors="coerce", utc=True)
    temp = temp.dropna(subset=[ts_col]).sort_values(ts_col)

    y = pd.to_numeric(temp[target_col], errors="coerce")
    if y.notna().sum() < 20:
        return []

    results: List[Dict[str, Any]] = []
    for c in candidate_cols[:6]:
        x = pd.to_numeric(temp[c], errors="coerce")
        d = pd.concat([y, x], axis=1).dropna()
        if len(d) < 20:
            continue
        try:
            test = grangercausalitytests(d.values, maxlag=maxlag, verbose=False)
            best_p = None
            best_lag = None
            for lag, out in test.items():
                p = out[0].get("ssr_ftest", (None, None, None, None))[1]
                p = _safe_float(p)
                if p is None:
                    continue
                if best_p is None or p < best_p:
                    best_p = p
                    best_lag = lag
            if best_p is not None:
                results.append({"column": str(c), "min_p_value": best_p, "best_lag": int(best_lag or 0)})
        except Exception:
            continue

    results.sort(key=lambda r: r.get("min_p_value") or 1.0)
    return results


def analyze_root_cause(
    df: pd.DataFrame,
    *,
    anomaly: Dict[str, Any],
    all_anomalies: List[Dict[str, Any]],
    window: int = 5,
) -> Dict[str, Any]:
    """
    Produce an RCA report for a single anomaly. Best-effort and safe for arbitrary CSVs.
    """
    target_col = str(anomaly.get("column") or "").strip()
    anomaly_index = anomaly.get("index")
    if not target_col or anomaly_index is None:
        return {"error": "invalid anomaly"}

    anomaly_index = int(anomaly_index)
    window = max(2, min(int(window or 5), 30))

    # Co-occurring anomalies: other columns within +-window indices.
    co = []
    for a in all_anomalies or []:
        try:
            if int(a.get("index")) == anomaly_index:
                continue
            if abs(int(a.get("index")) - anomaly_index) <= window and str(a.get("column")) != target_col:
                co.append(
                    {
                        "index": int(a.get("index")),
                        "column": str(a.get("column")),
                        "severity": _safe_float(a.get("severity")),
                    }
                )
        except Exception:
            continue
    co = sorted(co, key=lambda r: float(r.get("severity") or 0.0), reverse=True)[:8]

    driver_changes = _driver_changes(df, target_col=target_col, anomaly_index=anomaly_index, window=window)
    dt_explainer = _decision_tree_explainer(df, target_col=target_col, anomaly_index=anomaly_index, window=window)

    candidate_cols = [d["column"] for d in driver_changes[:6]]
    granger = _granger_tests(df, target_col=target_col, candidate_cols=candidate_cols, maxlag=2)

    primary = driver_changes[0] if driver_changes else None
    contributors = driver_changes[1:4] if len(driver_changes) > 1 else []
    ruled_out = [d for d in driver_changes[4:10] if abs(d.get("z_delta") or 0.0) < 0.5][:4]

    # Confidence heuristic: agree across signals.
    signals = 0
    if primary and abs(primary.get("z_delta") or 0.0) >= 2:
        signals += 1
    if primary and (primary.get("p_value") is not None and primary.get("p_value") <= 0.05):
        signals += 1
    if dt_explainer and dt_explainer[0]["column"] == (primary["column"] if primary else None):
        signals += 1
    if granger and granger[0]["column"] == (primary["column"] if primary else None) and (granger[0]["min_p_value"] <= 0.05):
        signals += 1
    confidence = float(min(0.95, 0.35 + 0.15 * signals + 0.10 * min(3, len(co))))

    return {
        "target": {
            "index": anomaly_index,
            "column": target_col,
            "timestamp": anomaly.get("timestamp"),
            "value": anomaly.get("value"),
        },
        "co_occurring": co,
        "primary_driver": primary,
        "contributors": contributors,
        "ruled_out": ruled_out,
        "evidence": {
            "driver_changes": driver_changes[:8],
            "decision_tree": dt_explainer,
            "granger": granger,
        },
        "confidence": confidence,
        "window": window,
    }

