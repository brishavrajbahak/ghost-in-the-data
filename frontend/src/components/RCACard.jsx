import React, { useMemo } from "react";
import { Activity, AlertTriangle, CheckCircle2, Gauge } from "lucide-react";

const Pill = ({ color, children }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 10px",
      borderRadius: 999,
      border: `1px solid ${color}`,
      background: "rgba(2,6,23,0.35)",
      fontSize: 11,
      fontWeight: 900,
      color,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </span>
);

const formatPct = (v) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
};

const RCACard = ({ report }) => {
  const primary = report?.primary_driver;
  const contributors = report?.contributors || [];
  const ruled = report?.ruled_out || [];
  const confidence = useMemo(() => {
    const c = report?.confidence;
    if (typeof c !== "number" || !Number.isFinite(c)) return null;
    return Math.round(c * 100);
  }, [report]);

  if (!report || report.error) return null;

  return (
    <div className="glass-card card" style={{ padding: 14 }}>
      <div className="section-title" style={{ marginBottom: 12 }}>
        <Activity size={18} color="rgba(0,240,255,0.9)" />
        <span>Root Cause Analysis</span>
      </div>

      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        {confidence != null ? (
          <Pill color="rgba(0,240,255,0.85)">
            <Gauge size={14} /> Confidence {confidence}%
          </Pill>
        ) : null}
        <Pill color="rgba(148,163,184,0.9)">Window ±{report.window}</Pill>
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
        <div>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            Primary driver
          </div>
          {primary ? (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 950, color: "rgba(248,113,113,0.95)" }}>
                {primary.column}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Δ {primary.delta?.toFixed?.(3) ?? primary.delta} (z {primary.z_delta?.toFixed?.(2) ?? "n/a"})
                {primary.p_value != null ? ` • p=${Number(primary.p_value).toFixed(4)}` : ""}
              </div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 12 }}>
              Not enough evidence to pick a single driver.
            </div>
          )}
        </div>

        {contributors.length ? (
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Contributing factors
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {contributors.slice(0, 3).map((c) => (
                <div key={c.column} className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontWeight: 900, color: "rgba(245,158,11,0.95)" }}>
                    <AlertTriangle size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                    {c.column}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    z {c.z_delta?.toFixed?.(2) ?? "n/a"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {ruled.length ? (
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Ruled out (stable)
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {ruled.slice(0, 4).map((c) => (
                <div key={c.column} className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontWeight: 900, color: "rgba(34,197,94,0.95)" }}>
                    <CheckCircle2 size={14} style={{ marginRight: 6, verticalAlign: "text-bottom" }} />
                    {c.column}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    z {c.z_delta?.toFixed?.(2) ?? "n/a"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default RCACard;

