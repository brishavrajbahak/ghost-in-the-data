import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import axios from "axios";
import { FileDown, X, Loader2 } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000/api";

const a4 = {
  width: 794, // px @96dpi-ish
  height: 1123,
  pad: 44,
};

const SeverityBadge = ({ severity }) => {
  const s = Number(severity || 0);
  const color = s >= 0.75 ? "rgba(239,68,68,0.95)" : s >= 0.5 ? "rgba(245,158,11,0.95)" : "rgba(16,185,129,0.95)";
  const label = s >= 0.75 ? "High" : s >= 0.5 ? "Medium" : "Low";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
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
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 99,
          background: color,
          display: "inline-block",
          boxShadow: `0 0 18px ${color}`,
        }}
      />
      Severity: {label} ({(s * 100).toFixed(0)}%)
    </span>
  );
};

const RCASnippet = ({ report }) => {
  if (!report || report.error) return null;
  const p = report.primary_driver;
  const contrib = report.contributors || [];
  return (
    <div
      style={{
        marginTop: 10,
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(10,14,26,0.35)",
        padding: 12,
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontWeight: 950 }}>RCA</div>
        <div style={{ fontSize: 11, color: "rgba(148,163,184,0.9)" }}>
          Confidence {Math.round((Number(report.confidence || 0) || 0) * 100)}%
        </div>
      </div>
      <div style={{ fontSize: 12, color: "rgba(148,163,184,0.95)" }}>
        {p ? (
          <>
            Primary driver: <span style={{ fontWeight: 950, color: "rgba(248,113,113,0.95)" }}>{p.column}</span>{" "}
            (z {p.z_delta?.toFixed?.(2) ?? "n/a"})
          </>
        ) : (
          <>Primary driver: <span style={{ fontWeight: 950 }}>Not determined</span></>
        )}
      </div>
      {contrib.length ? (
        <div style={{ fontSize: 12, color: "rgba(148,163,184,0.95)" }}>
          Contributing:{" "}
          {contrib
            .slice(0, 3)
            .map((c) => c.column)
            .filter(Boolean)
            .join(", ") || "None"}
        </div>
      ) : null}
    </div>
  );
};

const Page = React.forwardRef(function Page({ children }, ref) {
  return (
    <div
      ref={ref}
      style={{
        width: a4.width,
        minHeight: a4.height,
        padding: a4.pad,
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(180deg, rgba(20,27,45,0.82), rgba(10,14,26,0.78))",
        color: "rgba(226,232,240,0.92)",
        boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 20% 30%, rgba(139,92,246,0.10), transparent 55%), radial-gradient(circle at 80% 70%, rgba(0,240,255,0.10), transparent 58%)",
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative" }}>{children}</div>
    </div>
  );
});

const DossierExport = ({
  isOpen,
  onClose,
  datasetName,
  metadata,
  anomalies,
  correlations,
  rcaReports,
}) => {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ step: "", pct: 0 });
  const [storiesByIndex, setStoriesByIndex] = useState({});

  const coverRef = useRef(null);
  const summaryRef = useRef(null);
  const galleryRef = useRef(null);
  const narrativesRef = useRef(null);
  const appendixRef = useRef(null);

  const top = useMemo(() => (Array.isArray(anomalies) ? anomalies.slice(0, 5) : []), [anomalies]);

  useEffect(() => {
    if (!isOpen) {
      setGenerating(false);
      setError(null);
      setProgress({ step: "", pct: 0 });
      setStoriesByIndex({});
    }
  }, [isOpen]);

  const executiveSummary = useMemo(() => {
    const total = Array.isArray(anomalies) ? anomalies.length : 0;
    const hi = (anomalies || []).filter((a) => Number(a.severity || 0) >= 0.75).length;
    const topA = top[0];
    const driver = topA ? rcaReports?.[String(topA.index)]?.primary_driver?.column : null;
    const line1 = `This investigation detected ${total} anomalies in ${datasetName || "your dataset"}.`;
    const line2 = hi ? `${hi} are high-severity outliers requiring immediate review.` : "Most anomalies appear moderate and likely explainable.";
    const line3 = topA
      ? `The strongest apparition is in '${topA.column}' (index ${topA.index});${driver ? ` likely driven by '${driver}'.` : " root cause requires deeper inspection."}`
      : "No anomalies were found.";
    return [line1, line2, line3].join(" ");
  }, [anomalies, datasetName, rcaReports, top]);

  if (!isOpen) return null;

  const capturePage = async (el) => {
    if (!el) throw new Error("Missing page element");
    const canvas = await html2canvas(el, {
      backgroundColor: null,
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: a4.width,
      windowHeight: a4.height,
    });
    return canvas;
  };

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    setProgress({ step: "Preparing dossier pages", pct: 5 });

    try {
      // 1) Fetch narratives for top anomalies (best-effort).
      const nextStories = {};
      for (let i = 0; i < top.length; i++) {
        const a = top[i];
        setProgress({ step: `Summoning narrative ${i + 1}/${top.length}`, pct: 10 + Math.round((i / Math.max(1, top.length)) * 25) });
        try {
          const res = await axios.post(`${API_BASE}/narrate`, {
            anomaly_data: a,
            correlation_data: correlations?.[String(a.index)] || [],
          });
          nextStories[String(a.index)] = {
            story: res.data?.story || "",
            articles: res.data?.articles || [],
          };
        } catch (e) {
          nextStories[String(a.index)] = {
            story: "The Ghost could not summon this narrative (rate-limited or unavailable).",
            articles: [],
          };
        }
      }
      setStoriesByIndex(nextStories);

      // 2) Ensure React has painted the hidden pages.
      setProgress({ step: "Rendering pages", pct: 40 });
      await new Promise((r) => setTimeout(r, 60));

      // 3) Capture pages and assemble PDF.
      setProgress({ step: "Capturing pages", pct: 55 });
      const refs = [coverRef, summaryRef, galleryRef, narrativesRef, appendixRef].map((r) => r.current);

      const doc = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
      for (let i = 0; i < refs.length; i++) {
        setProgress({ step: `Composing PDF (${i + 1}/${refs.length})`, pct: 55 + Math.round((i / refs.length) * 40) });
        const canvas = await capturePage(refs[i]);
        const img = canvas.toDataURL("image/png");

        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
        const w = canvas.width * ratio;
        const h = canvas.height * ratio;
        const x = (pageW - w) / 2;
        const y = (pageH - h) / 2;

        if (i > 0) doc.addPage();
        doc.addImage(img, "PNG", x, y, w, h, undefined, "FAST");
      }

      setProgress({ step: "Saving", pct: 98 });
      const safeName = (datasetName || "analysis").replace(/[^a-z0-9_\-\.]+/gi, "_");
      doc.save(`ghost_dossier_${safeName}.pdf`);
      setProgress({ step: "Done", pct: 100 });
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Generate dossier">
      <div className="modal glass-card card" style={{ maxWidth: 920 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "grid" }}>
            <div className="card__title" style={{ marginBottom: 0 }}>
              Investigation Dossier
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Export a shareable PDF snapshot of this analysis.
            </div>
          </div>
          <button type="button" className="iconBtn" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} />
          </button>
        </div>

        {error ? (
          <p className="error" style={{ marginTop: 12 }}>
            {error}
          </p>
        ) : null}

        <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <div className="glass-card card" style={{ padding: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              Dataset: <span style={{ fontWeight: 950 }}>{datasetName || metadata?.filename || "analysis.csv"}</span>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Pages: Cover • Summary • Gallery • Narratives • Appendix
            </div>
          </div>

          <button
            type="button"
            className="btn btn--primary"
            onClick={generate}
            disabled={generating}
            style={{ justifyContent: "center" }}
          >
            {generating ? <Loader2 size={18} className="spin" /> : <FileDown size={18} />}
            <span>{generating ? `${progress.step} (${progress.pct}%)` : "Generate Dossier PDF"}</span>
          </button>
        </div>

        {/* hidden render target for html2canvas */}
        <div style={{ position: "fixed", left: -100000, top: 0, width: a4.width, pointerEvents: "none" }}>
          <Page ref={coverRef}>
            <div style={{ display: "grid", gap: 18 }}>
              <div style={{ fontSize: 46, fontWeight: 950, lineHeight: 1.03 }}>
                Ghost In The Data
                <div style={{ fontSize: 18, color: "rgba(148,163,184,0.9)", marginTop: 10 }}>
                  Investigation Dossier
                </div>
              </div>
              <div style={{ display: "grid", gap: 8, fontSize: 14, color: "rgba(148,163,184,0.95)" }}>
                <div>
                  Dataset: <span style={{ fontWeight: 900, color: "rgba(226,232,240,0.95)" }}>{datasetName || "analysis.csv"}</span>
                </div>
                <div>
                  Anomalies detected:{" "}
                  <span style={{ fontWeight: 900, color: "rgba(0,240,255,0.9)" }}>{(anomalies || []).length}</span>
                </div>
                <div>Generated: {new Date().toLocaleString()}</div>
              </div>

              <div
                style={{
                  marginTop: 18,
                  borderRadius: 18,
                  border: "1px solid rgba(0,240,255,0.18)",
                  background: "rgba(0,240,255,0.06)",
                  padding: 18,
                  fontSize: 14,
                }}
              >
                <div style={{ fontWeight: 950, marginBottom: 10 }}>Executive Summary</div>
                <div style={{ color: "rgba(226,232,240,0.92)" }}>{executiveSummary}</div>
              </div>
            </div>
          </Page>

          <div style={{ height: 18 }} />

          <Page ref={summaryRef}>
            <div style={{ display: "grid", gap: 16 }}>
              <div style={{ fontSize: 22, fontWeight: 950 }}>Findings Overview</div>
              <div style={{ color: "rgba(148,163,184,0.95)", fontSize: 13 }}>
                Top apparitions and initial root-cause signals from the dataset.
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {top.map((a) => (
                  <div
                    key={a.index}
                    style={{
                      borderRadius: 16,
                      border: "1px solid rgba(255,255,255,0.06)",
                      background: "rgba(10,14,26,0.35)",
                      padding: 14,
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                      <div style={{ fontWeight: 950 }}>
                        #{a.index} • {a.column}
                      </div>
                      <SeverityBadge severity={a.severity} />
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(148,163,184,0.95)" }}>
                      Value {String(a.value)} • Expected [{(a.expected_range || []).join(", ")}]
                    </div>
                    <RCASnippet report={rcaReports?.[String(a.index)]} />
                  </div>
                ))}
              </div>
            </div>
          </Page>

          <div style={{ height: 18 }} />

          <Page ref={galleryRef}>
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ fontSize: 22, fontWeight: 950 }}>Anomaly Gallery</div>
              <div style={{ color: "rgba(148,163,184,0.95)", fontSize: 13 }}>
                Snapshot cards for the strongest anomalies (severity + RCA).
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {top.map((a) => (
                  <div
                    key={`g-${a.index}`}
                    style={{
                      borderRadius: 16,
                      border: "1px solid rgba(255,255,255,0.06)",
                      background: "rgba(10,14,26,0.35)",
                      padding: 14,
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                      <div style={{ fontWeight: 950 }}>
                        Case #{a.index} • {a.column}
                      </div>
                      <SeverityBadge severity={a.severity} />
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(148,163,184,0.95)" }}>
                      Detectors: {(a.detectors || []).join(", ") || "n/a"}
                    </div>
                    <RCASnippet report={rcaReports?.[String(a.index)]} />
                  </div>
                ))}
              </div>
            </div>
          </Page>

          <div style={{ height: 18 }} />

          <Page ref={narrativesRef}>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontSize: 22, fontWeight: 950 }}>AI Narratives</div>
              <div style={{ color: "rgba(148,163,184,0.95)", fontSize: 13 }}>
                Generated stories for the top anomalies (best-effort; may be rate-limited).
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                {top.map((a) => {
                  const story = storiesByIndex?.[String(a.index)]?.story || "";
                  const articles = storiesByIndex?.[String(a.index)]?.articles || [];
                  return (
                    <div
                      key={`n-${a.index}`}
                      style={{
                        borderRadius: 16,
                        border: "1px solid rgba(255,255,255,0.06)",
                        background: "rgba(10,14,26,0.35)",
                        padding: 14,
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <div style={{ fontWeight: 950 }}>
                        Case #{a.index} • {a.column}
                      </div>
                      <div className="markdown" style={{ fontSize: 11, color: "rgba(226,232,240,0.92)" }}>
                        <ReactMarkdown>{story || "No story available."}</ReactMarkdown>
                      </div>
                      {articles.length ? (
                        <div style={{ fontSize: 11, color: "rgba(148,163,184,0.95)" }}>
                          Sources:
                          <ul style={{ margin: "6px 0 0 18px" }}>
                            {articles.slice(0, 3).map((x) => (
                              <li key={x.link || x.title}>{x.title}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </Page>

          <div style={{ height: 18 }} />

          <Page ref={appendixRef}>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontSize: 22, fontWeight: 950 }}>Appendix</div>
              <div style={{ color: "rgba(148,163,184,0.95)", fontSize: 13 }}>
                Detector configuration and correlation notes.
              </div>
              <div
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(10,14,26,0.35)",
                  padding: 14,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ fontWeight: 950 }}>Metadata</div>
                <pre
                  style={{
                    margin: 0,
                    fontSize: 10,
                    color: "rgba(226,232,240,0.88)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {JSON.stringify(metadata || {}, null, 2)}
                </pre>
              </div>
            </div>
          </Page>
        </div>
      </div>
    </div>
  );
};

export default DossierExport;

