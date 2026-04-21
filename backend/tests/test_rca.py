import pandas as pd

from app.services.rca import analyze_root_cause


def test_rca_returns_primary_driver():
    df = pd.DataFrame(
        {
            "timestamp": pd.date_range("2024-03-01", periods=40, freq="h", tz="UTC").astype(str),
            "revenue": [100] * 20 + [50] * 5 + [98] * 15,
            "ad_spend": [10] * 20 + [3] * 5 + [10] * 15,
            "seasonal_index": [1] * 40,
        }
    )
    anomaly = {"index": 22, "column": "revenue", "value": 50, "timestamp": "2024-03-01T22:00:00Z"}
    all_anoms = [
        {"index": 22, "column": "revenue", "severity": 0.9},
        {"index": 22, "column": "ad_spend", "severity": 0.8},
    ]
    report = analyze_root_cause(df, anomaly=anomaly, all_anomalies=all_anoms, window=4)
    assert report["target"]["column"] == "revenue"
    assert report["primary_driver"] is None or "column" in report["primary_driver"]
    assert "evidence" in report

