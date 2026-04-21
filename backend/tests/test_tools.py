import pandas as pd
import pytest

from app.services.tools import (
    ToolExecutionError,
    compare_periods,
    execute_tool,
    filter_and_summarize,
    find_drivers,
    get_column_stats,
    rolling_stats,
)


def _df():
    return pd.DataFrame(
        {
            "timestamp": pd.date_range("2024-03-01", periods=10, freq="h", tz="UTC").astype(str),
            "revenue": [100, 98, 97, 96, 50, 49, 52, 95, 96, 97],
            "ad_spend": [10, 10, 10, 9, 3, 3, 4, 9, 10, 10],
            "seasonal_index": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        }
    )


def test_get_column_stats_ok():
    df = _df()
    out = get_column_stats(df, column="revenue")
    assert out["column"] == "revenue"
    assert out["count"] == 10
    assert out["min"] == 49.0
    assert out["max"] == 100.0


def test_filter_and_summarize_numeric_condition():
    df = _df()
    out = filter_and_summarize(df, column="revenue", condition="revenue < 60", agg="mean")
    assert out["row_count"] >= 2
    assert out["value"] < 60


def test_filter_and_summarize_datetime_condition():
    df = _df()
    out = filter_and_summarize(df, column="revenue", condition="timestamp >= 2024-03-01T04:00:00Z", agg="count")
    assert out["value"] == out["row_count"]
    assert out["row_count"] == 6


def test_compare_periods():
    df = _df()
    out = compare_periods(df, column="revenue", period_a="2024-03-01T00:00:00Z..2024-03-01T03:00:00Z", period_b="2024-03-01T04:00:00Z..2024-03-01T06:00:00Z")
    assert out["column"] == "revenue"
    assert out["period_a"]["n"] >= 2
    assert out["period_b"]["n"] >= 2
    assert out["pct_change"] is not None


def test_find_drivers():
    df = _df()
    drivers = find_drivers(df, target_column="revenue", anomaly_index=4, window=2)
    assert isinstance(drivers, list)
    assert drivers
    assert any(d["column"] == "ad_spend" for d in drivers)


def test_rolling_stats_compact():
    df = _df()
    out = rolling_stats(df, column="revenue", window=3)
    assert out["column"] == "revenue"
    assert "highlights" in out
    assert len(out["highlights"]) <= 12


def test_execute_tool_unknown():
    df = _df()
    with pytest.raises(ToolExecutionError):
        execute_tool(df, name="nope", args={})

