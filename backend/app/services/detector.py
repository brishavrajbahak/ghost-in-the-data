import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler
from scipy import stats
from statsmodels.tsa.seasonal import STL
from typing import Dict, List, Optional, Set, Tuple
from app.models.schemas import Anomaly
from app.services.torch_autoencoder import compute_reconstruction_error

_AVAILABLE_DETECTORS = {"zscore", "iqr", "grubbs", "isoforest", "lof", "stl", "autoencoder"}


def _pick_timestamp_column(df: pd.DataFrame) -> Optional[str]:
    for candidate in ("date", "timestamp", "time", "datetime"):
        if candidate in df.columns:
            return candidate

    # Fall back to first column that looks parseable as datetime for at least half the rows
    for col in df.columns:
        if df[col].dtype.kind in ("M",):
            return col
        if df[col].dtype == object:
            parsed = pd.to_datetime(df[col], errors="coerce", utc=True)
            if parsed.notna().mean() >= 0.5:
                return col

    return None


def _grubbs_outlier_index(series: pd.Series, alpha: float = 0.05) -> Optional[int]:
    x = series.dropna().astype(float)
    n = len(x)
    if n < 3:
        return None

    mean = x.mean()
    std = x.std(ddof=1)
    if std == 0 or np.isnan(std):
        return None

    diffs = (x - mean).abs()
    idx = int(diffs.idxmax())
    G = float(diffs.loc[idx] / std)

    # Grubbs critical value
    t = stats.t.ppf(1 - alpha / (2 * n), n - 2)
    numerator = (n - 1) * np.sqrt(t**2)
    denominator = np.sqrt(n) * np.sqrt(n - 2 + t**2)
    G_crit = float(numerator / denominator)

    return idx if G > G_crit else None


def detect_anomalies(
    df: pd.DataFrame,
    detectors: Optional[List[str]] = None,
    max_results: int = 50,
) -> List[Anomaly]:
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    if not numeric_cols:
        return []

    selected = set(detectors or [])
    if not selected:
        selected = set(_AVAILABLE_DETECTORS)
    else:
        selected = {d for d in selected if d in _AVAILABLE_DETECTORS}
        if not selected:
            selected = set(_AVAILABLE_DETECTORS)

    numeric = df[numeric_cols].copy()
    numeric = numeric.fillna(numeric.median(numeric_only=True))

    # Per-cell detector hits: (row_index, col_name) -> set(detector names)
    cell_hits: Dict[Tuple[int, str], Set[str]] = {}

    z_df: Optional[pd.DataFrame] = None
    if "zscore" in selected:
        z = stats.zscore(numeric, nan_policy="omit")
        z_df = pd.DataFrame(z, index=numeric.index, columns=numeric_cols).abs()
        for col in numeric_cols:
            hit_idx = z_df.index[z_df[col] > 3].tolist()
            for i in hit_idx:
                cell_hits.setdefault((int(i), col), set()).add("Z-Score")

    if "iqr" in selected:
        q1 = numeric.quantile(0.25)
        q3 = numeric.quantile(0.75)
        iqr = q3 - q1
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        for col in numeric_cols:
            mask = (numeric[col] < lower[col]) | (numeric[col] > upper[col])
            for i in numeric.index[mask].tolist():
                cell_hits.setdefault((int(i), col), set()).add("IQR")

    if "grubbs" in selected:
        for col in numeric_cols:
            idx = _grubbs_outlier_index(numeric[col])
            if idx is not None:
                cell_hits.setdefault((int(idx), col), set()).add("Grubbs")

    # Row-level detectors. Map each outlier row to one "most suspicious" column.
    row_hits: Dict[int, Set[str]] = {}
    n_samples = len(numeric)
    if n_samples >= 5 and ("isoforest" in selected or "lof" in selected):
        contamination = min(0.05, 10 / n_samples) if n_samples > 10 else 0.1
        values = numeric.values

        if "isoforest" in selected:
            iso = IsolationForest(contamination=contamination, random_state=42)
            preds = iso.fit_predict(values)
            for i, p in enumerate(preds):
                if p == -1:
                    row_hits.setdefault(int(numeric.index[i]), set()).add("Isolation Forest")

        if "lof" in selected and n_samples >= 3:
            n_neighbors = max(2, min(20, n_samples - 1))
            lof = LocalOutlierFactor(n_neighbors=n_neighbors, contamination=contamination)
            preds = lof.fit_predict(values)
            for i, p in enumerate(preds):
                if p == -1:
                    row_hits.setdefault(int(numeric.index[i]), set()).add("Local Outlier Factor")

    if "autoencoder" in selected and n_samples >= 30 and len(numeric_cols) >= 3:
        try:
            contamination = min(0.05, 10 / n_samples) if n_samples > 10 else 0.1
            X = numeric.values.astype(float)
            scaler = StandardScaler()
            Xs = scaler.fit_transform(X)
            per_feature_err: np.ndarray
            mse: np.ndarray

            # Prefer PyTorch implementation; fall back to sklearn MLP autoencoder if torch is unavailable.
            try:
                ae = compute_reconstruction_error(Xs, epochs=28, batch_size=256, lr=1e-3)
                mse = ae.scores
                per_feature_err = ae.per_feature_error
            except Exception:
                # Train on a subset for speed on large datasets.
                rng = np.random.RandomState(42)
                train_n = int(min(n_samples, 5000))
                train_idx = rng.choice(n_samples, size=train_n, replace=False)

                hidden = int(max(8, min(64, Xs.shape[1] * 3)))
                bottleneck = int(max(2, min(16, Xs.shape[1] // 2)))
                mlp = MLPRegressor(
                    hidden_layer_sizes=(hidden, bottleneck, hidden),
                    activation="relu",
                    solver="adam",
                    alpha=1e-4,
                    max_iter=240,
                    early_stopping=True,
                    n_iter_no_change=12,
                    random_state=42,
                )

                mlp.fit(Xs[train_idx], Xs[train_idx])
                recon = mlp.predict(Xs)
                if recon.ndim == 1:
                    recon = recon.reshape(-1, 1)

                per_feature_err = (Xs - recon) ** 2
                mse = per_feature_err.mean(axis=1)

            thresh = float(np.quantile(mse, 1 - contamination))
            outlier_rows = np.where(mse >= thresh)[0].tolist()
            for pos in outlier_rows:
                # Map to most anomalous column by reconstruction error.
                col_pos = int(np.argmax(per_feature_err[pos]))
                best_col = str(numeric_cols[col_pos])
                row_hits.setdefault(int(numeric.index[pos]), set()).add("Autoencoder")
                cell_hits.setdefault((int(numeric.index[pos]), best_col), set()).add("Autoencoder")
        except Exception:
            # Graceful degradation: if fitting fails, skip this detector.
            pass

    if row_hits:
        # Use Z-score magnitude when available to pick the most extreme column; else fallback to abs deviation.
        for idx, detectors_for_row in row_hits.items():
            if z_df is not None:
                best_col = str(z_df.loc[idx].astype(float).idxmax())
            else:
                diffs = (numeric.loc[idx] - numeric.mean()).abs()
                best_col = str(diffs.astype(float).idxmax())

            cell_hits.setdefault((int(idx), best_col), set()).update(detectors_for_row)

    if "stl" in selected:
        ts_col = _pick_timestamp_column(df)
        if ts_col and n_samples >= 14:
            ts = pd.to_datetime(df[ts_col], errors="coerce", utc=True)
            temp = numeric.copy()
            temp["_ts_"] = ts
            temp = temp.dropna(subset=["_ts_"]).sort_values("_ts_")

            if len(temp) >= 14:
                # Heuristic period (weekly for shorter series, monthly-ish for longer)
                period = 7 if len(temp) < 24 else 12
                period = max(2, min(period, len(temp) // 2))

                for col in numeric_cols:
                    try:
                        stl = STL(temp[col].astype(float).values, period=period, robust=True)
                        res = stl.fit()
                        resid = pd.Series(res.resid, index=temp.index).astype(float)
                        rstd = float(resid.std(ddof=1))
                        if not rstd or np.isnan(rstd):
                            continue
                        mask = resid.abs() > 3 * rstd
                        for i in resid.index[mask].tolist():
                            cell_hits.setdefault((int(i), col), set()).add("STL Decomposition")
                    except Exception:
                        continue

    if not cell_hits:
        return []

    # Build anomalies with a simple consensus model.
    anomalies: List[Anomaly] = []
    max_detector_count = 6.0
    min_votes = 2 if len(selected) > 1 else 1

    ts_col = _pick_timestamp_column(df)
    for (idx, col), detector_names in cell_hits.items():
        if col not in numeric_cols:
            continue

        val = df.at[idx, col]
        if val is None or (isinstance(val, float) and np.isnan(val)):
            continue

        mean = float(numeric[col].mean())
        std = float(numeric[col].std(ddof=1))
        expected = [mean - 2 * std, mean + 2 * std] if std and not np.isnan(std) else [mean, mean]

        z_mag = 0.0
        if z_df is not None and idx in z_df.index and col in z_df.columns:
            try:
                z_mag = float(z_df.at[idx, col])
            except Exception:
                z_mag = 0.0

        detector_count = len(detector_names)
        consensus = detector_count >= min_votes or z_mag >= 5
        if not consensus:
            continue

        severity = 0.1 + 0.6 * (detector_count / max_detector_count) + 0.3 * min(1.0, z_mag / 6.0)
        severity = float(max(0.0, min(1.0, severity)))

        timestamp_value = None
        if ts_col and ts_col in df.columns:
            timestamp_value = df.at[idx, ts_col]

        anomalies.append(
            Anomaly(
                index=int(idx),
                column=str(col),
                value=float(val),
                expected_range=[float(expected[0]), float(expected[1])],
                severity=severity,
                detectors=sorted(detector_names),
                timestamp=str(timestamp_value) if timestamp_value is not None and str(timestamp_value) != "nan" else None,
            )
        )

    anomalies.sort(key=lambda a: a.severity, reverse=True)
    return anomalies[: max(1, int(max_results))]
