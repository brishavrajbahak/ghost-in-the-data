import React from "react";
import { Sparkles } from "lucide-react";

const AnomalyCard = ({ anomaly, onSelect }) => {
  const isHighSeverity = anomaly.severity > 0.7;
  const valueLabel = typeof anomaly.value === "number" ? anomaly.value.toFixed(2) : String(anomaly.value);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(anomaly)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect?.(anomaly);
      }}
      className="glass-card card--tight anomaly-card"
    >
      <div className="anomaly-card__top">
        <span className="badge">#{anomaly.index}</span>
        <span className={isHighSeverity ? "dot dot--danger" : "dot"} />
      </div>

      <div className="anomaly-card__col">{anomaly.column}</div>
      <div className="anomaly-card__val">{valueLabel}</div>
      <div className="anomaly-card__meta">
        {Array.isArray(anomaly.detectors) ? anomaly.detectors.join(" + ") : ""}
      </div>

      <div className="anomaly-card__cta">
        <span>View Story</span>
        <Sparkles size={14} color="rgba(0,240,255,0.9)" />
      </div>
    </div>
  );
};

export default AnomalyCard;
