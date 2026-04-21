import pandas as pd

from app.services.detector import detect_anomalies


def test_detect_anomalies_zscore_iqr_consensus_returns_outlier():
    df = pd.DataFrame(
        {
            "value": [10, 11, 9, 10, 10, 12, 9, 10, 11, 10, 999],
        }
    )

    anomalies = detect_anomalies(df, detectors=["zscore", "iqr"], max_results=10)
    assert anomalies, "expected at least one anomaly"

    top = anomalies[0]
    assert top.index == 10
    assert top.column == "value"
    assert top.value == 999.0
    assert 0.0 <= top.severity <= 1.0
    assert isinstance(top.detectors, list) and len(top.detectors) >= 1


def test_detect_anomalies_includes_timestamp_when_date_column_present():
    df = pd.DataFrame(
        {
            "date": [f"2026-01-{d:02d}" for d in range(1, 16)],
            "metric": [100] * 14 + [999],
        }
    )

    anomalies = detect_anomalies(df, detectors=["zscore", "iqr"], max_results=5)
    assert anomalies
    assert anomalies[0].timestamp is not None
    assert "2026-01" in anomalies[0].timestamp


def test_detect_anomalies_invalid_detector_list_falls_back():
    df = pd.DataFrame({"x": [1, 1, 1, 1, 1, 50]})
    anomalies = detect_anomalies(df, detectors=["not-a-detector"], max_results=10)
    assert isinstance(anomalies, list)

