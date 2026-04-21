import React, { useMemo, useState } from "react";
import { ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const correlation = (xs, ys) => {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }

  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  if (!den) return null;
  return num / den;
};

const buildMatrix = (rows, cols) => {
  const vectors = Object.fromEntries(
    cols.map((c) => [c, rows.map((r) => (typeof r[c] === "number" ? r[c] : null)).filter((v) => v != null)])
  );

  const matrix = {};
  for (const a of cols) {
    matrix[a] = {};
    for (const b of cols) {
      if (a === b) {
        matrix[a][b] = 1;
        continue;
      }

      const xs = vectors[a];
      const ys = vectors[b];
      const n = Math.min(xs.length, ys.length);
      matrix[a][b] = n >= 3 ? correlation(xs.slice(0, n), ys.slice(0, n)) : null;
    }
  }

  return matrix;
};

const colorFor = (r) => {
  if (r == null) return "rgba(148,163,184,0.10)";
  const v = clamp(r, -1, 1);
  const intensity = Math.abs(v);

  if (v >= 0) return `rgba(0,240,255,${0.15 + intensity * 0.55})`;
  return `rgba(139,92,246,${0.15 + intensity * 0.55})`;
};

const CorrelationMap = ({ data, numericColumns, maxColumns = 10 }) => {
  const [selectedPair, setSelectedPair] = useState(null);

  const cols = useMemo(() => (numericColumns || []).slice(0, maxColumns), [numericColumns, maxColumns]);

  const scatter = useMemo(() => {
    if (!selectedPair || !Array.isArray(data) || data.length < 3) return null;
    const [a, b] = selectedPair;
    if (!a || !b || a === b) return null;

    const points = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i] || {};
      const x = row[a];
      const y = row[b];
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x, y, i });
    }

    if (points.length <= 900) return { a, b, points };

    const step = Math.max(1, Math.floor(points.length / 900));
    const sampled = [];
    for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
    return { a, b, points: sampled.slice(0, 900) };
  }, [selectedPair, data]);

  const matrix = useMemo(() => {
    if (!Array.isArray(data) || data.length < 3 || cols.length < 2) return null;
    return buildMatrix(data, cols);
  }, [data, cols]);

  if (!cols.length) return null;

  return (
    <div className="glass-card card">
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="card__title" style={{ marginBottom: 0 }}>
          Feature Correlations
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          Up to {maxColumns} numeric columns
        </div>
      </div>

      {!matrix ? (
        <p className="muted">Not enough numeric data to compute correlations.</p>
      ) : (
        <div className="tableWrap" style={{ borderRadius: 14 }}>
          <div
            className="grid"
            style={{
              gap: 4,
              padding: 8,
              gridTemplateColumns: `140px repeat(${cols.length}, minmax(56px, 1fr))`,
            }}
          >
            <div />
            {cols.map((c) => (
              <div key={`col-${c}`} className="muted" style={{ fontSize: 11, padding: "6px 8px" }}>
                {c}
              </div>
            ))}

            {cols.map((rowCol) => (
              <React.Fragment key={`row-${rowCol}`}>
                <div className="muted" style={{ fontSize: 11, padding: "6px 8px" }}>
                  {rowCol}
                </div>
                {cols.map((colCol) => {
                  const r = matrix[rowCol][colCol];
                  const isSelected =
                    selectedPair &&
                    ((selectedPair[0] === rowCol && selectedPair[1] === colCol) ||
                      (selectedPair[0] === colCol && selectedPair[1] === rowCol));

                  return (
                    <button
                      key={`${rowCol}__${colCol}`}
                      type="button"
                      onClick={() => setSelectedPair([rowCol, colCol])}
                      className="btn"
                      style={{
                        height: 40,
                        width: "100%",
                        justifyContent: "center",
                        borderRadius: 12,
                        background: colorFor(r),
                        borderColor: isSelected ? "rgba(0,240,255,0.55)" : "rgba(255,255,255,0.06)",
                      }}
                      title={r == null ? "n/a" : r.toFixed(3)}
                    >
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,0.85)" }}>
                        {r == null ? "-" : r.toFixed(2)}
                      </span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {selectedPair && (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Selected: <span style={{ color: "rgba(226,232,240,0.95)", fontWeight: 800 }}>{selectedPair[0]}</span> vs{" "}
            <span style={{ color: "rgba(226,232,240,0.95)", fontWeight: 800 }}>{selectedPair[1]}</span>
          </p>

          {scatter && (
            <div className="vizCanvas" style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 18, right: 18, bottom: 16, left: 6 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name={scatter.a}
                    tick={{ fill: "rgba(148,163,184,0.85)", fontSize: 11 }}
                    axisLine={{ stroke: "rgba(255,255,255,0.10)" }}
                    tickLine={{ stroke: "rgba(255,255,255,0.10)" }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name={scatter.b}
                    tick={{ fill: "rgba(148,163,184,0.85)", fontSize: 11 }}
                    axisLine={{ stroke: "rgba(255,255,255,0.10)" }}
                    tickLine={{ stroke: "rgba(255,255,255,0.10)" }}
                  />
                  <Tooltip
                    cursor={{ stroke: "rgba(0,240,255,0.25)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0]?.payload;
                      if (!p) return null;
                      return (
                        <div
                          style={{
                            background: "rgba(10,14,26,0.92)",
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 12,
                            boxShadow: "0 14px 40px rgba(0,0,0,0.4)",
                            color: "rgba(226,232,240,0.95)",
                            fontSize: 12,
                            padding: "10px 12px",
                            display: "grid",
                            gap: 6,
                            minWidth: 160,
                          }}
                        >
                          <div style={{ fontWeight: 900, fontSize: 12, color: "rgba(0,240,255,0.95)" }}>
                            Row #{p.i}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <span className="muted">{scatter.a}</span>
                            <span style={{ fontFamily: "var(--font-mono)" }}>{p.x}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <span className="muted">{scatter.b}</span>
                            <span style={{ fontFamily: "var(--font-mono)" }}>{p.y}</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Scatter data={scatter.points} fill="rgba(0,240,255,0.65)" stroke="rgba(0,240,255,0.35)" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CorrelationMap;
