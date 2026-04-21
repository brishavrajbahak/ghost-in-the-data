import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Ghost, X, SendHorizonal, Minimize2, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const MessageBubble = ({ role, children }) => {
  const isUser = role === "user";
  return (
    <div className={`chatMsg ${isUser ? "chatMsg--user" : "chatMsg--assistant"}`}>
      <div className="chatMsg__bubble">{children}</div>
    </div>
  );
};

const ToolMessage = ({ message }) => {
  const ev = message?.meta || {};
  const tool = ev.tool_name || "tool";
  const args = ev.args || {};
  const error = ev.error;
  const result = ev.result;

  return (
    <div className="chatMsg chatMsg--assistant" style={{ opacity: 0.98 }}>
      <div className="chatMsg__bubble" style={{ border: "1px solid rgba(0,240,255,0.18)" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <motion.span
            animate={{ opacity: [0.45, 1, 0.45], scale: [0.98, 1.02, 0.98] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            style={{ display: "inline-flex" }}
            aria-hidden="true"
          >
            <Ghost size={18} color="rgba(0,240,255,0.95)" />
          </motion.span>
          <div style={{ display: "grid" }}>
            <div style={{ fontWeight: 900, fontSize: 12 }}>
              The Ghost is investigating: <span style={{ fontFamily: "var(--font-mono)" }}>{tool}</span>
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              {error ? "Tool failed (see details)" : "Tool returned evidence (see details)"}
            </div>
          </div>
        </div>

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", gap: 8, alignItems: "center" }}>
            <ChevronDown size={14} />
            <span style={{ fontWeight: 900, fontSize: 12 }}>Details</span>
          </summary>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            <div style={{ marginBottom: 6 }}>
              Args: <span style={{ fontFamily: "var(--font-mono)" }}>{JSON.stringify(args)}</span>
            </div>
            {error ? (
              <div style={{ color: "rgba(248,113,113,0.95)", fontWeight: 900 }}>Error: {String(error)}</div>
            ) : (
              <pre
                style={{
                  margin: 0,
                  padding: 10,
                  borderRadius: 12,
                  background: "rgba(2,6,23,0.55)",
                  border: "1px solid rgba(148,163,184,0.15)",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                }}
              >
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        </details>
      </div>
    </div>
  );
};

const FloatingSpectralBubble = ({
  anomaly,
  messages,
  articles,
  isLoading,
  isOpen,
  onOpenChange,
  onSend,
}) => {
  const [minimized, setMinimized] = useState(false);
  const [draft, setDraft] = useState("");
  const scrollerRef = useRef(null);

  const title = useMemo(() => {
    if (!anomaly) return "Spectral Bubble";
    return `Case #${anomaly.index} · ${anomaly.column}`;
  }, [anomaly]);

  useEffect(() => {
    if (!isOpen) setMinimized(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || minimized) return;
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [isOpen, minimized, (messages || []).length, isLoading]);

  if (!isOpen) return null;

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onSend?.(text);
  };

  return (
    <AnimatePresence>
      {minimized ? (
        <motion.button
          key="bubble-mini"
          className="spectralBubbleMini"
          initial={{ opacity: 0, scale: 0.9, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 10 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onClick={() => setMinimized(false)}
          type="button"
          aria-label="Open Spectral Bubble"
        >
          <Ghost size={20} color="rgba(0,240,255,0.95)" />
        </motion.button>
      ) : (
        <motion.div
          key="bubble"
          className="spectralBubble"
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          drag
          dragMomentum={false}
          dragElastic={0.08}
        >
          <div className="spectralBubble__header">
            <div className="spectralBubble__title">
              <span className="spectralBubble__icon" aria-hidden="true">
                <Ghost size={18} color="rgba(0,240,255,0.95)" />
              </span>
              <div style={{ display: "grid" }}>
                <div style={{ fontWeight: 950 }}>{title}</div>
                {anomaly?.timestamp ? (
                  <div className="muted" style={{ fontSize: 11 }}>
                    {anomaly.timestamp}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="spectralBubble__actions">
              <button
                type="button"
                className="iconBtn"
                onClick={() => setMinimized(true)}
                aria-label="Minimize"
                title="Minimize"
              >
                <Minimize2 size={18} />
              </button>
              <button
                type="button"
                className="iconBtn"
                onClick={() => {
                  setMinimized(false);
                  onOpenChange?.(false);
                }}
                aria-label="Close"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="spectralBubble__body" ref={scrollerRef}>
            {Array.isArray(messages) && messages.length ? (
              messages.map((m, i) => (
                m.role === "tool" ? (
                  <ToolMessage key={`${m.created_at || i}-${i}`} message={m} />
                ) : (
                  <MessageBubble key={`${m.created_at || i}-${i}`} role={m.role}>
                    <div className="markdown chatMsg__markdown">
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    </div>
                  </MessageBubble>
                )
              ))
            ) : (
              <MessageBubble role="assistant">
                <p className="muted" style={{ margin: 0 }}>
                  Select an anomaly to begin.
                </p>
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

          {Array.isArray(articles) && articles.length > 0 ? (
            <div className="spectralBubble__context">
              <div className="summaryItem__label" style={{ marginBottom: 8 }}>
                External context
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {articles.slice(0, 3).map((a, i) => (
                  <a
                    key={a.link || i}
                    href={a.link}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn--subtle"
                    style={{ justifyContent: "space-between" }}
                  >
                    <span style={{ display: "grid" }}>
                      <span style={{ fontWeight: 900, fontSize: 12 }}>{a.title}</span>
                      <span className="muted" style={{ fontSize: 11 }}>
                        {(a.source ? `${a.source} • ` : "") + (a.published_at || "")}
                      </span>
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      Open
                    </span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          <div className="spectralBubble__composer">
            <input
              className="chatComposer__input"
              value={draft}
              placeholder="Ask a follow-up question…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              disabled={isLoading}
            />
            <button
              type="button"
              className="btn btn--primary"
              onClick={send}
              disabled={isLoading || !draft.trim()}
              style={{ padding: "10px 14px" }}
            >
              <SendHorizonal size={18} />
              <span>Send</span>
            </button>
          </div>
          <div className="spectralBubble__hint muted">Drag this bubble anywhere.</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default FloatingSpectralBubble;
