import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { X, History, FileText, MessagesSquare } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000/api";

const RecallModal = ({ isOpen, onClose, onLoadSession, onOpenChat }) => {
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(null);
  const [chats, setChats] = useState([]);
  const [openingChatId, setOpeningChatId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setDetails(null);
    setChats([]);
    axios
      .get(`${API_BASE}/sessions?limit=30`)
      .then((res) => setSessions(res.data || []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      axios.get(`${API_BASE}/sessions/${selectedId}`),
      axios.get(`${API_BASE}/sessions/${selectedId}/chats?limit=50`).catch(() => ({ data: [] })),
    ])
      .then(([s, c]) => {
        setDetails(s.data);
        setChats(c.data || []);
      })
      .catch(() => setError("Could not load session. Is Postgres running?"))
      .finally(() => setLoading(false));
  }, [selectedId]);

  const title = useMemo(() => {
    if (!details) return "Recall an Apparition";
    const stamp = details.created_at ? new Date(details.created_at).toLocaleString() : "";
    return `${details.filename || "analysis.csv"} • ${stamp}`;
  }, [details]);

  if (!isOpen) return null;

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="Recall sessions">
      <div className="modal glass-card card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row" style={{ gap: 10 }}>
            <History size={18} color="rgba(0,240,255,0.9)" />
            <div style={{ display: "grid" }}>
              <div className="card__title" style={{ marginBottom: 0 }}>
                Recall an Apparition
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Load previous analyses and their chats
              </div>
            </div>
          </div>
          <button type="button" className="iconBtn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error ? <p className="error" style={{ marginTop: 12 }}>{error}</p> : null}

        <div className="modalGrid">
          <div className="modalList">
            {loading && !sessions.length ? <p className="muted">Loading...</p> : null}
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`btn btn--subtle modalList__item ${selectedId === s.id ? "is-active" : ""}`}
                onClick={() => setSelectedId(s.id)}
                style={{ justifyContent: "space-between" }}
              >
                <span style={{ display: "grid", textAlign: "left" }}>
                  <span style={{ fontWeight: 900, fontSize: 13 }}>{s.filename || "analysis.csv"}</span>
                  <span className="muted" style={{ fontSize: 11 }}>
                    {s.created_at ? new Date(s.created_at).toLocaleString() : ""} • {s.anomaly_count} anomalies
                  </span>
                  {s.time_span?.start && s.time_span?.end ? (
                    <span className="muted" style={{ fontSize: 11 }}>
                      {new Date(s.time_span.start).toLocaleDateString()} → {new Date(s.time_span.end).toLocaleDateString()}
                      {s.timestamp_col ? ` • ${s.timestamp_col}` : ""}
                    </span>
                  ) : null}
                </span>
                <span className="muted" style={{ fontSize: 11 }}>
                  Open
                </span>
              </button>
            ))}
          </div>

          <div className="modalDetail">
            {!details ? (
              <p className="muted">Select a session to preview.</p>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div className="section-title" style={{ marginTop: 4 }}>
                  <FileText size={18} color="rgba(0,240,255,0.9)" />
                  <span>{title}</span>
                </div>

                <div className="muted" style={{ fontSize: 12 }}>
                  This recall loads anomalies/metadata and lets you continue the chat. (Raw points may not be restored.)
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Dataset stored:{" "}
                  <span style={{ fontWeight: 900, color: (details.metadata?.csv_stored ? "rgba(0,240,255,0.95)" : "rgba(148,163,184,0.9)") }}>
                    {details.metadata?.csv_stored ? "Yes" : "No"}
                  </span>
                </div>

                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => onLoadSession?.(details)}
                  disabled={loading}
                  style={{ justifyContent: "center" }}
                >
                  Load Session
                </button>

                <div className="section-title" style={{ marginTop: 10 }}>
                  <MessagesSquare size={18} color="rgba(139,92,246,0.95)" />
                  <span>Chats ({chats.length})</span>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  {chats.slice(0, 6).map((c) => (
                    <div key={c.id} className="glass-card card" style={{ padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ fontWeight: 900, fontSize: 13 }}>
                          Anomaly #{c.anomaly_index ?? "?"}
                        </div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {c.message_count} messages
                        </div>
                      </div>
                      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                        {c.last_message_at ? new Date(c.last_message_at).toLocaleString() : ""}
                      </div>
                      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="btn btn--subtle"
                          disabled={openingChatId === c.id}
                          onClick={async () => {
                            setOpeningChatId(c.id);
                            try {
                              const res = await axios.get(`${API_BASE}/chats/${c.id}`);
                              onOpenChat?.(res.data);
                              onClose?.();
                            } catch {
                              setError("Could not open chat.");
                            } finally {
                              setOpeningChatId(null);
                            }
                          }}
                        >
                          Open chat
                        </button>
                      </div>
                    </div>
                  ))}
                  {!chats.length ? <p className="muted">No chats stored for this session yet.</p> : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecallModal;
