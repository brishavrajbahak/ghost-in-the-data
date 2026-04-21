import React from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const point = payload[0].payload;

    return (
      <div className="glass-card card--tight" style={{ maxWidth: 320 }}>
        <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 6 }}>Index: {point.index}</div>
        {Object.entries(point).map(([key, val]) => {
          if (key === "index" || key === "isAnomaly") return null;
          if (typeof val !== "number") return null;

          return (
            <div key={key} className="muted" style={{ fontSize: 12 }}>
              <span style={{ opacity: 0.9 }}>{key}:</span> {val.toFixed(2)}
            </div>
          );
        })}
        {point.isAnomaly && (
          <div style={{ marginTop: 10, fontSize: 11, fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(0,240,255,0.95)" }}>
            Anomaly Detected
          </div>
        )}
      </div>
    );
  }

  return null;
};

const AnomalyTimeline = ({ data, anomalies, onSelectAnomaly }) => {
  const chartData = (data || []).map((d, i) => ({
    ...d,
    index: i,
    isAnomaly: (anomalies || []).some((a) => a.index === i),
  }));

  const numericKey = (obj) => {
    const keys = Object.keys(obj || {});
    return obj[keys.find((k) => typeof obj[k] === "number" && k !== "index")];
  };

  return (
    <div className="glass-card card" style={{ height: 420 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="card__title" style={{ marginBottom: 0 }}>
          Anomaly Distribution
        </div>
        <div className="legend">
          <span className="legend__item">
            <span className="legend__dot" /> Normal
          </span>
          <span className="legend__item">
            <span className="legend__dot legend__dot--anomaly" /> Anomaly
          </span>
        </div>
      </div>

      <div style={{ height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              type="number"
              dataKey="index"
              name="Index"
              stroke="rgba(148,163,184,0.75)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="number"
              dataKey={numericKey}
              stroke="rgba(148,163,184,0.75)"
              fontSize={12}
              tickLine={false}
              axisLine={false}
            />
            <ZAxis range={[40, 400]} />
            <Tooltip content={<CustomTooltip />} />
            <Scatter
              name="Data Points"
              data={chartData}
              onClick={(point) => {
                if (!point?.isAnomaly) return;
                const anomaly = (anomalies || []).find((a) => a.index === point.index);
                if (anomaly) onSelectAnomaly?.(anomaly);
              }}
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.isAnomaly ? "rgba(0,240,255,0.95)" : "rgba(148,163,184,0.18)"}
                  stroke={entry.isAnomaly ? "rgba(0,240,255,0.85)" : "transparent"}
                  strokeWidth={entry.isAnomaly ? 2 : 0}
                  fillOpacity={entry.isAnomaly ? 1 : 0.8}
                  style={{ cursor: entry.isAnomaly ? "pointer" : "default" }}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default AnomalyTimeline;
