from __future__ import annotations

import io
import math
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from scipy import stats


class ToolExecutionError(ValueError):
    pass


def load_dataframe_from_csv_text(csv_text: str) -> pd.DataFrame:
    if not csv_text or not isinstance(csv_text, str):
        raise ToolExecutionError("No dataset available for tool execution.")
    try:
        return pd.read_csv(io.StringIO(csv_text))
    except Exception as e:
        raise ToolExecutionError(f"Could not parse stored CSV text: {e}") from e


def _safe_col(df: pd.DataFrame, name: str) -> str:
    if not isinstance(name, str) or not name.strip():
        raise ToolExecutionError("column must be a non-empty string")
    name = name.strip()
    if name not in df.columns:
        raise ToolExecutionError(f"Unknown column: {name}")
    return name


def _numeric_series(df: pd.DataFrame, col: str) -> pd.Series:
    s = pd.to_numeric(df[col], errors="coerce")
    if s.notna().sum() == 0:
        raise ToolExecutionError(f"Column '{col}' has no numeric values.")
    return s


def _pick_timestamp_column(df: pd.DataFrame) -> Optional[str]:
    for candidate in ("date", "timestamp", "time", "datetime"):
        if candidate in df.columns:
            return candidate

    # best-effort: parseable for at least half of the rows
    for c in df.columns:
        parsed = pd.to_datetime(df[c], errors="coerce", utc=True)
        if parsed.notna().mean() >= 0.5:
            return c
    return None


_COND_RE = re.compile(r"^\s*([A-Za-z0-9_ \-\.]+)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$")


def _parse_condition(condition: str) -> Tuple[str, str, str]:
    if not isinstance(condition, str) or not condition.strip():
        raise ToolExecutionError("condition must be a non-empty string")
    m = _COND_RE.match(condition)
    if not m:
        raise ToolExecutionError(
            "Unsupported condition. Use the form: <column> <op> <value> (e.g. 'date >= 2024-06-01')."
        )
    col, op, raw = m.group(1).strip(), m.group(2), m.group(3).strip()
    return col, op, raw


def _coerce_literal(series: pd.Series, raw: str):
    # strip quotes for string literals
    if (raw.startswith('"') and raw.endswith('"')) or (raw.startswith("'") and raw.endswith("'")):
        return raw[1:-1]

    # datetime literal?
    dt = pd.to_datetime(raw, errors="coerce", utc=True)
    if not pd.isna(dt):
        parsed = pd.to_datetime(series, errors="coerce", utc=True)
        if parsed.notna().mean() >= 0.5:
            return dt

    # numeric literal?
    try:
        return float(raw)
    except Exception:
        return raw


def _apply_condition(df: pd.DataFrame, condition: str) -> pd.DataFrame:
    col, op, raw = _parse_condition(condition)
    col = _safe_col(df, col)
    s = df[col]
    lit = _coerce_literal(s, raw)

    # datetime compare
    if isinstance(lit, pd.Timestamp):
        parsed = pd.to_datetime(s, errors="coerce", utc=True)
        mask = parsed.notna()
        parsed = parsed[mask]
        if op == ">":
            keep = parsed > lit
        elif op == ">=":
            keep = parsed >= lit
        elif op == "<":
            keep = parsed < lit
        elif op == "<=":
            keep = parsed <= lit
        elif op == "==":
            keep = parsed == lit
        elif op == "!=":
            keep = parsed != lit
        else:
            raise ToolExecutionError("Unsupported operator")
        idx = parsed.index[keep]
        return df.loc[idx]

    # numeric compare when possible
    if isinstance(lit, (int, float)) and not isinstance(lit, bool):
        ns = pd.to_numeric(s, errors="coerce")
        if op == ">":
            mask = ns > lit
        elif op == ">=":
            mask = ns >= lit
        elif op == "<":
            mask = ns < lit
        elif op == "<=":
            mask = ns <= lit
        elif op == "==":
            mask = ns == lit
        elif op == "!=":
            mask = ns != lit
        else:
            raise ToolExecutionError("Unsupported operator")
        return df.loc[mask.fillna(False)]

    # string compare (lexicographic / equality)
    ss = s.astype(str)
    lv = str(lit)
    if op == "==":
        mask = ss == lv
    elif op == "!=":
        mask = ss != lv
    else:
        raise ToolExecutionError("Only == / != supported for non-numeric comparisons.")
    return df.loc[mask]


def get_column_stats(df: pd.DataFrame, *, column: str) -> Dict[str, Any]:
    col = _safe_col(df, column)
    s = _numeric_series(df, col).dropna()
    q = s.quantile([0.25, 0.5, 0.75]).to_dict()
    return {
        "column": col,
        "count": int(s.shape[0]),
        "mean": float(s.mean()),
        "median": float(q.get(0.5, s.median())),
        "std": float(s.std(ddof=1)) if s.shape[0] > 1 else 0.0,
        "min": float(s.min()),
        "max": float(s.max()),
        "q1": float(q.get(0.25)),
        "q3": float(q.get(0.75)),
        "skewness": float(s.skew()) if s.shape[0] > 2 else 0.0,
    }


def filter_and_summarize(
    df: pd.DataFrame,
    *,
    column: str,
    condition: str,
    agg: str,
) -> Dict[str, Any]:
    col = _safe_col(df, column)
    filtered = _apply_condition(df, condition)

    agg = (agg or "").strip().lower()
    if agg not in {"mean", "sum", "min", "max", "median", "count"}:
        raise ToolExecutionError("agg must be one of: mean, sum, min, max, median, count")

    if agg == "count":
        value = int(filtered.shape[0])
    else:
        s = _numeric_series(filtered, col).dropna()
        if s.shape[0] == 0:
            raise ToolExecutionError("No matching rows with numeric values for the requested aggregation.")
        value = float(getattr(s, agg)())

    return {
        "condition": condition,
        "column": col,
        "agg": agg,
        "row_count": int(filtered.shape[0]),
        "value": value,
    }


def _parse_period(period: str) -> Tuple[pd.Timestamp, pd.Timestamp]:
    if not isinstance(period, str) or not period.strip():
        raise ToolExecutionError("period must be a non-empty string")
    p = period.strip()
    if ".." in p:
        a, b = [x.strip() for x in p.split("..", 1)]
        start = pd.to_datetime(a, errors="raise", utc=True)
        end = pd.to_datetime(b, errors="raise", utc=True)
        return start, end

    # YYYY-MM
    if re.match(r"^\d{4}-\d{2}$", p):
        start = pd.to_datetime(p + "-01", utc=True)
        end = (start + pd.offsets.MonthEnd(0)).to_pydatetime()
        end = pd.Timestamp(end, tz="UTC")
        return start, end

    # single date
    dt = pd.to_datetime(p, errors="raise", utc=True)
    return dt, dt


def compare_periods(df: pd.DataFrame, *, column: str, period_a: str, period_b: str) -> Dict[str, Any]:
    col = _safe_col(df, column)
    ts_col = _pick_timestamp_column(df)
    if not ts_col:
        raise ToolExecutionError("No timestamp-like column found; cannot compare time periods.")

    ts = pd.to_datetime(df[ts_col], errors="coerce", utc=True)
    if ts.notna().sum() == 0:
        raise ToolExecutionError("Timestamp column could not be parsed.")

    a0, a1 = _parse_period(period_a)
    b0, b1 = _parse_period(period_b)

    s = pd.to_numeric(df[col], errors="coerce")
    mask_a = ts.between(a0, a1, inclusive="both")
    mask_b = ts.between(b0, b1, inclusive="both")

    xa = s[mask_a].dropna()
    xb = s[mask_b].dropna()
    if xa.shape[0] < 2 or xb.shape[0] < 2:
        raise ToolExecutionError("Not enough data in one of the periods to compare (need at least 2 points each).")

    mean_a = float(xa.mean())
    mean_b = float(xb.mean())
    pct_change = None
    if mean_a != 0:
        pct_change = float((mean_b - mean_a) / abs(mean_a))

    t = stats.ttest_ind(xa.values, xb.values, equal_var=False, nan_policy="omit")
    return {
        "timestamp_col": ts_col,
        "column": col,
        "period_a": {"start": a0.isoformat(), "end": a1.isoformat(), "n": int(xa.shape[0]), "mean": mean_a},
        "period_b": {"start": b0.isoformat(), "end": b1.isoformat(), "n": int(xb.shape[0]), "mean": mean_b},
        "pct_change": pct_change,
        "t_stat": float(t.statistic) if t.statistic is not None else None,
        "p_value": float(t.pvalue) if t.pvalue is not None else None,
    }


def find_drivers(
    df: pd.DataFrame,
    *,
    target_column: str,
    anomaly_index: int,
    window: int = 5,
) -> List[Dict[str, Any]]:
    target = _safe_col(df, target_column)
    if not isinstance(anomaly_index, int):
        raise ToolExecutionError("anomaly_index must be an integer")
    if window < 1 or window > 60:
        raise ToolExecutionError("window must be between 1 and 60")

    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if not numeric_cols:
        raise ToolExecutionError("No numeric columns available.")

    idx = int(anomaly_index)
    if idx not in df.index:
        # if df has RangeIndex, allow mapping directly
        if idx < 0 or idx >= len(df):
            raise ToolExecutionError("anomaly_index out of range")

    pos = idx if idx in df.index else df.index[idx]
    iloc = df.index.get_loc(pos)

    left = max(0, iloc - window)
    right = min(len(df) - 1, iloc + window)
    around = df.iloc[left : right + 1]
    before = df.iloc[max(0, left - window) : left] if left > 0 else df.iloc[0:0]
    after = df.iloc[right + 1 : min(len(df), right + 1 + window)]

    result: List[Dict[str, Any]] = []
    for c in numeric_cols:
        if c == target:
            continue
        s_all = pd.to_numeric(df[c], errors="coerce")
        s_around = pd.to_numeric(around[c], errors="coerce")
        if s_around.notna().sum() < 2:
            continue

        mean_all = float(s_all.mean())
        std_all = float(s_all.std(ddof=1)) if s_all.notna().sum() > 2 else 0.0
        mean_around = float(s_around.mean())

        baseline = None
        if before.shape[0] >= 2:
            baseline = float(pd.to_numeric(before[c], errors="coerce").mean())
        elif after.shape[0] >= 2:
            baseline = float(pd.to_numeric(after[c], errors="coerce").mean())
        else:
            baseline = mean_all

        delta = mean_around - baseline
        z = float(delta / std_all) if std_all and not math.isnan(std_all) else None
        result.append(
            {
                "column": str(c),
                "delta_vs_baseline": float(delta),
                "baseline_mean": float(baseline),
                "window_mean": float(mean_around),
                "z_delta": z,
            }
        )

    result.sort(key=lambda r: abs(r.get("z_delta") or 0.0), reverse=True)
    return result[:10]


def rolling_stats(df: pd.DataFrame, *, column: str, window: int = 7) -> Dict[str, Any]:
    col = _safe_col(df, column)
    window = int(window)
    if window < 2 or window > 90:
        raise ToolExecutionError("window must be between 2 and 90")

    s = _numeric_series(df, col)
    roll_mean = s.rolling(window, min_periods=max(2, window // 2)).mean()
    roll_std = s.rolling(window, min_periods=max(2, window // 2)).std(ddof=1)
    z = (s - roll_mean) / roll_std.replace(0, np.nan)

    # Only return compact highlights (avoid huge payloads).
    highlights = []
    for idx in z.index[z.abs() > 3].tolist()[:12]:
        highlights.append(
            {
                "index": int(idx) if isinstance(idx, (int, np.integer)) else str(idx),
                "value": float(s.loc[idx]) if pd.notna(s.loc[idx]) else None,
                "rolling_mean": float(roll_mean.loc[idx]) if pd.notna(roll_mean.loc[idx]) else None,
                "rolling_std": float(roll_std.loc[idx]) if pd.notna(roll_std.loc[idx]) else None,
                "z": float(z.loc[idx]) if pd.notna(z.loc[idx]) else None,
            }
        )

    return {
        "column": col,
        "window": window,
        "highlight_count": int(len(highlights)),
        "highlights": highlights,
    }


TOOL_SPECS: Dict[str, Dict[str, Any]] = {
    "get_column_stats": {
        "description": "Returns mean, median, std, min, max, quartiles, skewness for a numeric column.",
        "parametersJsonSchema": {
            "type": "object",
            "properties": {"column": {"type": "string", "description": "Column name"}},
            "required": ["column"],
        },
    },
    "filter_and_summarize": {
        "description": "Filters rows by a simple condition and returns an aggregation over a column.",
        "parametersJsonSchema": {
            "type": "object",
            "properties": {
                "column": {"type": "string", "description": "Column to aggregate"},
                "condition": {"type": "string", "description": "e.g. 'date >= 2024-06-01'"},
                "agg": {"type": "string", "description": "mean|sum|min|max|median|count"},
            },
            "required": ["column", "condition", "agg"],
        },
    },
    "compare_periods": {
        "description": "Compares a column across two time windows; returns % change and a t-test.",
        "parametersJsonSchema": {
            "type": "object",
            "properties": {
                "column": {"type": "string"},
                "period_a": {"type": "string", "description": "YYYY-MM or 'start..end'"},
                "period_b": {"type": "string", "description": "YYYY-MM or 'start..end'"},
            },
            "required": ["column", "period_a", "period_b"],
        },
    },
    "find_drivers": {
        "description": "Identifies which other columns changed most around an anomaly index (windowed).",
        "parametersJsonSchema": {
            "type": "object",
            "properties": {
                "target_column": {"type": "string"},
                "anomaly_index": {"type": "integer"},
                "window": {"type": "integer", "default": 5},
            },
            "required": ["target_column", "anomaly_index"],
        },
    },
    "rolling_stats": {
        "description": "Computes rolling mean/std for a column and returns a compact list of >3σ deviations.",
        "parametersJsonSchema": {
            "type": "object",
            "properties": {"column": {"type": "string"}, "window": {"type": "integer", "default": 7}},
            "required": ["column"],
        },
    },
}


def execute_tool(df: pd.DataFrame, *, name: str, args: Dict[str, Any]) -> Any:
    name = (name or "").strip()
    if name not in TOOL_SPECS:
        raise ToolExecutionError(f"Unknown tool: {name}")

    args = args or {}
    try:
        if name == "get_column_stats":
            return get_column_stats(df, column=str(args.get("column", "")))
        if name == "filter_and_summarize":
            return filter_and_summarize(
                df,
                column=str(args.get("column", "")),
                condition=str(args.get("condition", "")),
                agg=str(args.get("agg", "")),
            )
        if name == "compare_periods":
            return compare_periods(
                df,
                column=str(args.get("column", "")),
                period_a=str(args.get("period_a", "")),
                period_b=str(args.get("period_b", "")),
            )
        if name == "find_drivers":
            return find_drivers(
                df,
                target_column=str(args.get("target_column", "")),
                anomaly_index=int(args.get("anomaly_index")),
                window=int(args.get("window", 5) or 5),
            )
        if name == "rolling_stats":
            return rolling_stats(
                df,
                column=str(args.get("column", "")),
                window=int(args.get("window", 7) or 7),
            )
    except ToolExecutionError:
        raise
    except Exception as e:
        raise ToolExecutionError(str(e)) from e

    raise ToolExecutionError(f"Unhandled tool: {name}")
