import React from "react";

const DETECTORS = [
  { key: "zscore", label: "Z-Score", description: "Statistical (global)" },
  { key: "iqr", label: "IQR", description: "Statistical (robust)" },
  { key: "grubbs", label: "Grubbs", description: "Statistical (single outlier)" },
  { key: "isoforest", label: "Isolation Forest", description: "ML (global)" },
  { key: "lof", label: "Local Outlier Factor", description: "ML (local density)" },
  { key: "stl", label: "STL Decomposition", description: "Time-series residuals" },
  { key: "autoencoder", label: "Autoencoder", description: "Deep (reconstruction error)" },
];

const DetectorConfig = ({ value, onChange }) => {
  const selected = new Set(Array.isArray(value) ? value : []);

  const toggle = (key) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange?.(Array.from(next));
  };

  return (
    <div className="glass-card card">
      <div className="row">
        <div>
          <div className="card__title">Detectors</div>
          <div className="card__subtitle">Choose how the Ghost hunts.</div>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {selected.size} selected
        </div>
      </div>

      <div className="detectorGrid">
        {DETECTORS.map((d) => (
          <label key={d.key} className="detectorItem">
            <input type="checkbox" checked={selected.has(d.key)} onChange={() => toggle(d.key)} />
            <span style={{ display: "grid" }}>
              <span className="detectorItem__label">{d.label}</span>
              <span className="detectorItem__desc">{d.description}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
};

export default DetectorConfig;
