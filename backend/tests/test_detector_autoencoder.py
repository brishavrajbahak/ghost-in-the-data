import numpy as np
import pandas as pd
import warnings

from app.services.detector import detect_anomalies


def test_autoencoder_detector_flags_obvious_outlier_row():
    rng = np.random.RandomState(0)
    normal = rng.normal(loc=0.0, scale=1.0, size=(80, 4))
    df = pd.DataFrame(normal, columns=["a", "b", "c", "d"])

    # One obvious outlier row
    df.loc[79, ["a", "b", "c", "d"]] = [12.0, -11.0, 9.5, -10.5]

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        anomalies = detect_anomalies(df, detectors=["autoencoder"], max_results=20)
    assert anomalies, "expected anomalies from autoencoder-only mode"
    assert any(a.index == 79 for a in anomalies)


def test_single_detector_mode_is_allowed():
    df = pd.DataFrame({"x": [1, 1, 1, 1, 1, 10]})
    anomalies = detect_anomalies(df, detectors=["iqr"], max_results=10)
    assert anomalies, "expected anomalies when only one detector is selected"
