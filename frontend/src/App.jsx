import React, { Suspense, useEffect, useMemo, useState } from "react";
import { Ghost, Sparkles, RefreshCcw, GitBranch, LogOut, History, FileDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import FileUpload from "./components/FileUpload";
import AnomalyTimeline from "./components/AnomalyTimeline";
import StatsOverview from "./components/StatsOverview";
import DetectorConfig from "./components/DetectorConfig";
import CorrelationMap from "./components/CorrelationMap";
import AnomalyCard from "./components/AnomalyCard";
import DataPreview from "./components/DataPreview";
import { parseCsv } from "./utils/formatters";
import { useAnalysis } from "./hooks/useAnalysis";
import FloatingSpectralBubble from "./components/FloatingSpectralBubble";
import RecallModal from "./components/RecallModal";
import RCACard from "./components/RCACard";
import DossierExport from "./components/DossierExport";
import SoundScapePlayer from "./components/SoundScapePlayer";

const SpectralCloud = React.lazy(() => import("./components/SpectralCloud"));

function App() {
  const [data, setData] = useState([]);
  const [detectors, setDetectors] = useState(["zscore", "isoforest", "lof"]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [rawCsv, setRawCsv] = useState(null);
  const [vizMode, setVizMode] = useState("2d");
  const [cloudAxes, setCloudAxes] = useState({ x: "", y: "", z: "" });
  const [isRecallOpen, setIsRecallOpen] = useState(false);
  const [isDossierOpen, setIsDossierOpen] = useState(false);
  const [datasetName, setDatasetName] = useState(null);

  const sourceUrl = import.meta.env.VITE_SOURCE_URL;

  const {
    phase,
    anomalies,
    metadata,
    error,
    selectedAnomaly,
    currentStory,
    currentArticles,
    correlations,
    chatMessages,
    isChatLoading,
    rcaReports,
    isNarrativeOpen,
    setIsNarrativeOpen,
    analyzeFile,
    narrateAnomaly,
    sendChatMessage,
    hydrateSession,
    openPersistedChat,
    reset: resetAnalysis,
  } = useAnalysis();

  const preview = useMemo(() => {
    if (!rawCsv) return { headers: [], rows: [] };
    return parseCsv(rawCsv, { maxRows: 100 });
  }, [rawCsv]);

  const numericCols = useMemo(() => metadata?.numeric_cols || [], [metadata]);

  useEffect(() => {
    if (!numericCols.length) return;
    setCloudAxes((prev) => {
      const safe = (v) => (v && numericCols.includes(v) ? v : "");
      const x = safe(prev.x) || numericCols[0] || "";
      const y = safe(prev.y) || numericCols[1] || numericCols[0] || "";
      const z = safe(prev.z) || numericCols[2] || numericCols[0] || "";
      return { x, y, z };
    });
  }, [numericCols.join("|")]);

  const onSelectFile = async (file) => {
    setSelectedFile(file);
    setDatasetName(file?.name || null);

    try {
      const text = await file.text();
      setRawCsv(text);
      const parsed = parseCsv(text, { maxRows: 200 });
      setData(parsed.rows);
    } catch (err) {
      console.error(err);
      setRawCsv(null);
      setData([]);
    }
  };

  const beginAnalysis = async () => {
    if (!selectedFile) return;
    await analyzeFile(selectedFile, { detectors });
  };

  const reset = () => {
    resetAnalysis();
    setData([]);
    setSelectedFile(null);
    setRawCsv(null);
    setVizMode("2d");
    setCloudAxes({ x: "", y: "", z: "" });
    setIsDossierOpen(false);
    setDatasetName(null);
  };

  const loadRecalled = (session) => {
    if (!session) return;
    setSelectedFile(null);
    setDatasetName(session.filename || null);
    if (session.csv_text) {
      setRawCsv(session.csv_text);
      const parsed = parseCsv(session.csv_text, { maxRows: 2000 });
      setData(parsed.rows);
    } else {
      setData([]);
      setRawCsv(null);
    }
    hydrateSession(session);
    setIsRecallOpen(false);
  };

  return (
    <div className="app">
      <nav className="nav container">
        <div className="brand" onClick={reset}>
          <div className="brand__icon" aria-hidden="true">
            <Ghost size={20} color="rgba(0,240,255,0.95)" />
          </div>
          <div className="brand__text">
            Ghost<span>InTheData</span>
          </div>
        </div>

        <div className="nav__actions">
          <button type="button" onClick={() => setIsRecallOpen(true)} className="btn btn--pill btn--subtle">
            <History size={18} />
            <span>Recall</span>
          </button>
          {phase === "view" ? (
            <button type="button" onClick={() => setIsDossierOpen(true)} className="btn btn--pill btn--subtle">
              <FileDown size={18} />
              <span>Generate Dossier</span>
            </button>
          ) : null}
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noreferrer" className="btn btn--pill btn--subtle">
              <GitBranch size={18} />
              <span>Source</span>
            </a>
          ) : null}
          {phase !== "upload" && (
            <button type="button" onClick={reset} className="btn btn--subtle">
              <LogOut size={16} />
              <span>New Analysis</span>
            </button>
          )}
        </div>
      </nav>

      <main className="container">
        {phase === "upload" && (
          <div className="section">
            <div className="hero">
              <h1 className="hero__title spectral-gradient">Anomalies have a story to tell.</h1>
              <p className="hero__subtitle">
                Upload your dataset. Spectral detectors find the outliers, and AI narrates the why behind the data.
              </p>
            </div>

            <div className="upload">
              <DetectorConfig value={detectors} onChange={setDetectors} />
              <div style={{ height: 16 }} />
              <FileUpload onSelectFile={onSelectFile} isLoading={phase === "analyzing"} />
              {error && <p className="error">{error}</p>}

              {selectedFile && (
                <div style={{ marginTop: 20, display: "grid", gap: 16 }}>
                  <DataPreview headers={preview.headers} rows={preview.rows} />
                  <div className="upload__actions">
                    <button type="button" onClick={beginAnalysis} className="btn btn--primary">
                      Begin Analysis
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {phase === "analyzing" && (
          <div className="center">
            <div className="center__orb">
              <Ghost size={44} color="rgba(0,240,255,0.95)" />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 900 }}>Summoning Insights</h2>
            <p className="muted">Running ensemble detectors across {metadata?.total_rows || "the data"}...</p>
          </div>
        )}

        {phase === "view" && metadata && (
          <div className="section">
            <StatsOverview metadata={metadata} anomalies={anomalies} />

            <div className="grid grid--main">
              <div style={{ display: "grid", gap: 16 }}>
                <div className="glass-card card" style={{ padding: 14 }}>
                  <div className="row" style={{ marginBottom: 12 }}>
                    <div className="card__title" style={{ marginBottom: 0 }}>
                      Primary Visualization
                    </div>
                    <div className="segmented">
                      <button
                        type="button"
                        className={`segmented__btn ${vizMode === "2d" ? "is-active" : ""}`}
                        onClick={() => setVizMode("2d")}
                      >
                        2D
                      </button>
                      <button
                        type="button"
                        className={`segmented__btn ${vizMode === "3d" ? "is-active" : ""}`}
                        onClick={() => setVizMode("3d")}
                      >
                        3D
                      </button>
                    </div>
                  </div>

                  {vizMode === "3d" && numericCols.length >= 3 && (
                    <div className="axisPicker">
                      {["x", "y", "z"].map((axis) => (
                        <label key={axis} className="axisPicker__field">
                          <span className="axisPicker__label">{axis.toUpperCase()}</span>
                          <select
                            className="axisPicker__select"
                            value={cloudAxes[axis]}
                            onChange={(e) => setCloudAxes((prev) => ({ ...prev, [axis]: e.target.value }))}
                          >
                            {numericCols.map((c) => (
                              <option key={`${axis}-${c}`} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                      <div className="muted" style={{ fontSize: 11 }}>
                        Tip: click a glowing point to narrate.
                      </div>
                    </div>
                  )}
                </div>

                <AnimatePresence mode="wait">
                  {vizMode === "3d" ? (
                    <motion.div
                      key="viz-3d"
                      initial={{ opacity: 0, y: 10, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.985 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                    >
                      <Suspense
                        fallback={
                          <div className="glass-card card center" style={{ minHeight: 420 }}>
                            <div className="center__orb">
                              <Ghost size={34} color="rgba(0,240,255,0.95)" />
                            </div>
                            <p className="muted">Loading 3D renderer...</p>
                          </div>
                        }
                      >
                        <SpectralCloud
                          data={data}
                          anomalies={anomalies}
                          columns={cloudAxes}
                          onSelectAnomaly={narrateAnomaly}
                        />
                      </Suspense>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="viz-2d"
                      initial={{ opacity: 0, y: 10, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.985 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                    >
                      <AnomalyTimeline data={data} anomalies={anomalies} onSelectAnomaly={narrateAnomaly} />
                    </motion.div>
                  )}
                </AnimatePresence>
                <SoundScapePlayer data={data} anomalies={anomalies} numericColumns={numericCols} />
                <CorrelationMap data={data} numericColumns={metadata.numeric_cols} />
              </div>

              <div style={{ display: "grid", gap: 16 }}>
                {selectedAnomaly && rcaReports?.[String(selectedAnomaly.index)] ? (
                  <RCACard report={rcaReports[String(selectedAnomaly.index)]} />
                ) : (
                  <div className="glass-card card skeleton">
                    <div className="section-title" style={{ marginBottom: 12 }}>
                      <Sparkles size={18} color="rgba(0,240,255,0.9)" />
                      <span>Spectral Insights</span>
                    </div>
                    <div style={{ display: "grid", gap: 10 }}>
                      <div className="skeleton-line skeleton-line--sm" />
                      <div className="skeleton-line skeleton-line--lg" />
                      <div className="skeleton-line skeleton-line--md" />
                    </div>
                    <p className="muted" style={{ fontSize: 11, marginTop: 16, textAlign: "center" }}>
                      Select an anomaly on the graph to reveal its story and RCA.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="section" style={{ marginTop: 26 }}>
              <div className="section-title">
                <RefreshCcw size={18} color="rgba(0,240,255,0.9)" />
                <span>Detected Apparitions ({anomalies.length})</span>
              </div>
              <div className="grid grid--cards">
                {anomalies.map((a, i) => (
                  <AnomalyCard key={i} anomaly={a} onSelect={narrateAnomaly} />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      <FloatingSpectralBubble
        anomaly={selectedAnomaly}
        messages={chatMessages}
        articles={currentArticles}
        isLoading={isChatLoading}
        isOpen={isNarrativeOpen}
        onOpenChange={setIsNarrativeOpen}
        onSend={sendChatMessage}
      />

      <RecallModal
        isOpen={isRecallOpen}
        onClose={() => setIsRecallOpen(false)}
        onLoadSession={loadRecalled}
        onOpenChat={openPersistedChat}
      />

      <DossierExport
        isOpen={isDossierOpen}
        onClose={() => setIsDossierOpen(false)}
        datasetName={datasetName}
        metadata={metadata}
        anomalies={anomalies}
        correlations={correlations}
        rcaReports={rcaReports}
      />

      <footer className="footer">
        <p>(c) 2026 Ghost In The Data - AI-Powered Anomaly Storytelling</p>
      </footer>
    </div>
  );
}

export default App;
