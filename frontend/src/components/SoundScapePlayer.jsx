import React, { useEffect, useMemo, useRef, useState } from "react";
import { createSonificationEngine } from "../engine/sonificationEngine";
import { Music, Pause, Play } from "lucide-react";

function clamp(n, lo, hi) {
  const x = Number(n) || 0;
  return Math.max(lo, Math.min(hi, x));
}

export default function SoundScapePlayer({ data, anomalies, numericColumns }) {
  const cols = Array.isArray(numericColumns) ? numericColumns : [];
  const rows = Array.isArray(data) ? data : [];

  const [col, setCol] = useState(cols[0] || "");
  const [speed, setSpeed] = useState(1);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);

  const engineRef = useRef(null);

  useEffect(() => {
    engineRef.current = createSonificationEngine();
    engineRef.current.setOnPosition((p) => setPos(p));
    return () => engineRef.current?.destroy();
  }, []);

  useEffect(() => {
    if (!cols.length) return;
    setCol((prev) => (prev && cols.includes(prev) ? prev : cols[0]));
  }, [cols.join("|")]);

  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setDataset(rows, col, anomalies);
    eng.setSpeed(speed);
    eng.setPosition(0);
    setPos(0);
    setPlaying(false);
    eng.pause();
  }, [rows, col, anomalies, speed]);

  const canPlay = rows.length >= 2 && !!col;

  const title = useMemo(() => {
    if (!canPlay) return "SoundScope (needs data)";
    return `SoundScope — ${col}`;
  }, [canPlay, col]);

  const toggle = () => {
    const eng = engineRef.current;
    if (!eng || !canPlay) return;
    if (playing) {
      eng.pause();
      setPlaying(false);
    } else {
      eng.play();
      setPlaying(true);
    }
  };

  const onScrub = (e) => {
    const eng = engineRef.current;
    if (!eng) return;
    const next = clamp(e.target.value, 0, Math.max(0, rows.length - 1));
    eng.setPosition(next);
    setPos(next);
  };

  return (
    <div className="glass-card card" style={{ marginTop: 16 }}>
      <div className="section-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Music size={18} color="rgba(0,240,255,0.9)" />
          <span>{title}</span>
        </span>
        <button type="button" className="btn btn--pill btn--subtle" onClick={toggle} disabled={!canPlay}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
          <span>{playing ? "Pause" : "Play"}</span>
        </button>
      </div>

      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 160px 130px", alignItems: "center" }}>
          <label className="field">
            <span className="field__label">Column</span>
            <select className="field__input" value={col} onChange={(e) => setCol(e.target.value)} disabled={!cols.length}>
              {cols.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Speed</span>
            <select
              className="field__input"
              value={String(speed)}
              onChange={(e) => setSpeed(Number(e.target.value))}
              disabled={!canPlay}
            >
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="4">4x</option>
            </select>
          </label>

          <div className="muted" style={{ fontSize: 12, textAlign: "right" }}>
            Row {rows.length ? pos + 1 : 0}/{rows.length}
          </div>
        </div>

        <input
          type="range"
          min={0}
          max={Math.max(0, rows.length - 1)}
          value={clamp(pos, 0, Math.max(0, rows.length - 1))}
          onChange={onScrub}
          disabled={!canPlay}
        />

        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          Tip: anomalies add dissonance (tritone) so spikes “sound wrong”.
        </p>
      </div>
    </div>
  );
}

