import { useCallback, useState } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000/api';

export const useAnalysis = () => {
  const [phase, setPhase] = useState('upload'); // upload | analyzing | view
  const [anomalies, setAnomalies] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [correlations, setCorrelations] = useState({});
  const [error, setError] = useState(null);

  const [selectedAnomaly, setSelectedAnomaly] = useState(null);
  const [currentStory, setCurrentStory] = useState(null);
  const [currentArticles, setCurrentArticles] = useState([]);
  const [isNarrativeOpen, setIsNarrativeOpen] = useState(false);
  const [contextByIndex, setContextByIndex] = useState({});
  const [chatSessionId, setChatSessionId] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [analysisSessionId, setAnalysisSessionId] = useState(null);
  const [rcaReports, setRcaReports] = useState(null);

  const analyzeFile = useCallback(async (file, { detectors } = {}) => {
    setPhase('analyzing');
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    if (Array.isArray(detectors)) {
      formData.append('detectors', JSON.stringify(detectors));
    }

    try {
      const response = await axios.post(`${API_BASE}/analyze`, formData);
      setAnomalies(response.data.anomalies || []);
      setCorrelations(response.data.correlations || {});
      setMetadata(response.data.metadata || null);
      setAnalysisSessionId(response.data.session_id || null);
      setRcaReports(response.data.rca_reports || response.data.metadata?.rca_reports || null);
      setPhase('view');

      // Auto-search: prefetch external context for top anomalies (cached server-side).
      try {
        const anomalies = response.data.anomalies || [];
        if (Array.isArray(anomalies) && anomalies.length) {
          const pre = await axios.post(`${API_BASE}/context/prefetch`, { anomalies, limit: 6 });
          setContextByIndex(pre.data.articles_by_index || {});
        }
      } catch (prefetchErr) {
        console.warn("context prefetch failed", prefetchErr);
        setContextByIndex({});
      }
    } catch (err) {
      console.error(err);
      setError("The Ghost couldn't parse your data. Ensure it's a valid CSV.");
      setPhase('upload');
    }
  }, []);

  const startChat = useCallback(async (anomaly) => {
    setSelectedAnomaly(anomaly);
    setCurrentStory(null);
    setCurrentArticles(contextByIndex?.[String(anomaly.index)] || []);
    setIsNarrativeOpen(true);
    setChatSessionId(null);
    setChatMessages([]);
    setIsChatLoading(true);

    try {
      const response = await axios.post(`${API_BASE}/chat/start`, {
        anomaly_data: anomaly,
        correlation_data: correlations?.[String(anomaly.index)] || [],
        analysis_session_id: analysisSessionId,
      });
      setChatSessionId(response.data.session_id);
      setChatMessages(response.data.messages || []);
      setCurrentStory((response.data.messages || [])[0]?.content || null);
      setCurrentArticles(response.data.articles || []);
    } catch (err) {
      console.error(err);
      setCurrentStory("The Ghost is lost in the machine. Could not generate narrative.");
    } finally {
      setIsChatLoading(false);
    }
  }, [correlations, contextByIndex, analysisSessionId]);

  const sendChatMessage = useCallback(async (message) => {
    const text = String(message || "").trim();
    if (!text || !chatSessionId) return;

    // optimistic user message
    setChatMessages((prev) => [
      ...(prev || []),
      { role: "user", content: text, created_at: new Date().toISOString() },
    ]);
    setIsChatLoading(true);

    try {
      const response = await axios.post(`${API_BASE}/chat/send`, {
        session_id: chatSessionId,
        message: text,
      });
      setChatMessages(response.data.messages || []);
      setCurrentArticles(response.data.articles || []);
    } catch (err) {
      console.error(err);
      setChatMessages((prev) => [
        ...(prev || []),
        {
          role: "assistant",
          content: "The Ghost encountered interference. Try again in a moment.",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  }, [chatSessionId]);

  const reset = useCallback(() => {
    setPhase('upload');
    setAnomalies([]);
    setMetadata(null);
    setCorrelations({});
    setError(null);
    setSelectedAnomaly(null);
    setCurrentStory(null);
    setCurrentArticles([]);
    setIsNarrativeOpen(false);
    setChatSessionId(null);
    setChatMessages([]);
    setIsChatLoading(false);
    setContextByIndex({});
    setAnalysisSessionId(null);
    setRcaReports(null);
  }, []);

  const hydrateSession = useCallback((session) => {
    if (!session) return;
    setPhase("view");
    setAnomalies(session.anomalies || []);
    setCorrelations(session.correlations || {});
    setMetadata(session.metadata || null);
    setAnalysisSessionId(session.id || null);
    setRcaReports(session.rca_reports || session.metadata?.rca_reports || null);
    setError(null);
  }, []);

  const openPersistedChat = useCallback((chat) => {
    if (!chat) return;
    setSelectedAnomaly(chat.anomaly_data || null);
    setChatSessionId(chat.id || null);
    setChatMessages(chat.messages || []);
    setCurrentArticles(chat.articles || []);
    setIsNarrativeOpen(true);
    setIsChatLoading(false);
    setError(null);
  }, []);

  return {
    phase,
    anomalies,
    metadata,
    correlations,
    error,
    selectedAnomaly,
    currentStory,
    currentArticles,
    contextByIndex,
    chatSessionId,
    chatMessages,
    isChatLoading,
    analysisSessionId,
    rcaReports,
    isNarrativeOpen,
    setIsNarrativeOpen,
    analyzeFile,
    narrateAnomaly: startChat,
    sendChatMessage,
    hydrateSession,
    openPersistedChat,
    reset,
  };
};
