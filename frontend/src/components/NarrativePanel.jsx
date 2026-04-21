import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { X, Ghost, SendHorizonal } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const MessageBubble = ({ role, children }) => {
  const isUser = role === "user";
  return (
    <div className={`chatMsg ${isUser ? "chatMsg--user" : "chatMsg--assistant"}`}>
      <div className="chatMsg__bubble">{children}</div>
    </div>
  );
};

const NarrativePanel = ({ anomaly, story, articles, messages, isLoading, isOpen, onClose, onSend }) => {
  const MotionDiv = motion.div;
  const [typed, setTyped] = useState("");
  const [isTypingDone, setIsTypingDone] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollerRef = useRef(null);

  const typingSpeed = useMemo(() => {
    const len = story ? String(story).length : 0;
    if (len > 4000) return { intervalMs: 10, chunk: 18 };
    if (len > 2000) return { intervalMs: 12, chunk: 14 };
    return { intervalMs: 14, chunk: 10 };
  }, [story]);

  useEffect(() => {
    if (!isOpen || !story) return;
    setTyped("");
    setIsTypingDone(false);

    const full = String(story);
    let idx = 0;
    const t = setInterval(() => {
      idx = Math.min(full.length, idx + typingSpeed.chunk);
      setTyped(full.slice(0, idx));
      if (idx >= full.length) {
        setIsTypingDone(true);
        clearInterval(t);
      }
    }, typingSpeed.intervalMs);

    return () => clearInterval(t);
  }, [story, anomaly?.index, isOpen, typingSpeed.chunk, typingSpeed.intervalMs]);

  useEffect(() => {
    if (!isOpen) return;
    const el = scrollerRef.current;
    if (!el) return;
    // scroll to bottom when messages change
    el.scrollTop = el.scrollHeight;
  }, [isOpen, (messages || []).length, isLoading]);

  if (!isOpen) return null;
  if (!anomaly) return null;

  return (
    <AnimatePresence>
      <MotionDiv
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="panel"
      >
        <div className="panel__inner">
          <div className="panel__header">
            <div className="panel__titleRow">
              <div className="panel__icon" aria-hidden="true">
                <Ghost size={18} color="rgba(0,240,255,0.95)" />
              </div>
              <div>
                <div className="panel__title">Spectral Narrative</div>
                <div className="panel__case">Case #{anomaly.index}</div>
              </div>
            </div>
            <button type="button" onClick={onClose} className="iconBtn" aria-label="Close narrative">
              <X size={20} />
            </button>
          </div>

          <div className="glass-card card panel__summary">
            <div className="summaryGrid">
              <div>
                <div className="summaryItem__label">Target Column</div>
                <div className="summaryItem__value">{anomaly.column}</div>
              </div>
              <div>
                <div className="summaryItem__label">Anomalous Value</div>
                <div className="summaryItem__value" style={{ color: "rgba(0,240,255,0.95)" }}>
                  {String(anomaly.value)}
                </div>
              </div>
              <div>
                <div className="summaryItem__label">Severity</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="bar" aria-hidden="true">
                    <div className="bar__fill" style={{ width: `${anomaly.severity * 100}%` }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 900 }}>{(anomaly.severity * 100).toFixed(0)}%</div>
                </div>
              </div>
              <div>
                <div className="summaryItem__label">Detection Signal</div>
                <div className="summaryItem__value" style={{ color: "rgba(148,163,184,0.95)", fontSize: 12 }}>
                  {Array.isArray(anomaly.detectors) ? anomaly.detectors.join(" + ") : ""}
                </div>
              </div>
            </div>
          </div>

          <div className="chat" ref={scrollerRef}>
            {Array.isArray(messages) && messages.length ? (
              messages.map((m, i) => (
                <MessageBubble key={`${m.created_at || i}-${i}`} role={m.role}>
                  <div className="markdown chatMsg__markdown">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                </MessageBubble>
              ))
            ) : !story ? (
              <div className="center" style={{ marginTop: 40 }}>
                <Ghost size={34} color="rgba(148,163,184,0.35)" />
                <p className="muted" style={{ fontStyle: "italic" }}>
                  Whispering to the ether...
                </p>
              </div>
            ) : (
              <MessageBubble role="assistant">
                <div className="markdown">
                  {!isTypingDone ? (
                    <div className="typewriter">
                      <pre className="typewriter__pre">{typed}</pre>
                      <div className="typewriter__actions">
                        <button
                          type="button"
                          onClick={() => {
                            setTyped(String(story));
                            setIsTypingDone(true);
                          }}
                          className="btn btn--subtle"
                        >
                          Skip animation
                        </button>
                      </div>
                    </div>
                  ) : (
                    <ReactMarkdown>{story}</ReactMarkdown>
                  )}
                </div>
              </MessageBubble>
            )}

            {isLoading ? (
              <MessageBubble role="assistant">
                <p className="muted" style={{ margin: 0 }}>
                  The Ghost is thinking...
                </p>
              </MessageBubble>
            ) : null}
          </div>

          {Array.isArray(articles) && articles.length > 0 && (
            <div className="panel__footer" style={{ marginTop: 16 }}>
              <div className="summaryItem__label" style={{ marginBottom: 10 }}>
                External context
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {articles.map((a, i) => (
                  <a
                    key={a.link || i}
                    href={a.link}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn--subtle"
                    style={{ justifyContent: "space-between" }}
                  >
                    <span style={{ display: "grid" }}>
                      <span style={{ fontWeight: 900, fontSize: 13 }}>{a.title}</span>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {(a.source ? `${a.source} • ` : "") + (a.published_at || "")}
                      </span>
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Open
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="chatComposer">
            <input
              className="chatComposer__input"
              value={draft}
              placeholder="Ask a follow-up question…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const text = draft.trim();
                  if (!text) return;
                  setDraft("");
                  onSend?.(text);
                }
              }}
              disabled={isLoading}
            />
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                const text = draft.trim();
                if (!text) return;
                setDraft("");
                onSend?.(text);
              }}
              disabled={isLoading || !draft.trim()}
              style={{ padding: "10px 14px" }}
            >
              <SendHorizonal size={18} />
              <span>Send</span>
            </button>
          </div>

          <div className="panel__footer">
            <button type="button" onClick={onClose} className="btn" style={{ width: "100%", justifyContent: "center" }}>
              Close
            </button>
          </div>
        </div>
      </MotionDiv>
    </AnimatePresence>
  );
};

export default NarrativePanel;
