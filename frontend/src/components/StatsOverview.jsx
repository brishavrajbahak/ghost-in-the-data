import React from "react";
import { Database, AlertCircle, Activity, TrendingUp } from "lucide-react";

const ACCENTS = {
  slate: {
    iconBg: "rgba(148,163,184,0.10)",
    iconBorder: "rgba(148,163,184,0.20)",
    iconColor: "rgba(148,163,184,0.95)",
    valueColor: "rgba(148,163,184,0.95)",
  },
  cyan: {
    iconBg: "rgba(0,240,255,0.12)",
    iconBorder: "rgba(0,240,255,0.20)",
    iconColor: "rgba(0,240,255,0.95)",
    valueColor: "rgba(0,240,255,0.95)",
  },
  purple: {
    iconBg: "rgba(139,92,246,0.12)",
    iconBorder: "rgba(139,92,246,0.20)",
    iconColor: "rgba(139,92,246,0.95)",
    valueColor: "rgba(139,92,246,0.95)",
  },
  red: {
    iconBg: "rgba(239,68,68,0.12)",
    iconBorder: "rgba(239,68,68,0.20)",
    iconColor: "rgba(239,68,68,0.95)",
    valueColor: "rgba(239,68,68,0.95)",
  },
};

const StatCard = ({ title, value, icon, accent }) => {
  const a = ACCENTS[accent] || ACCENTS.slate;

  return (
    <div className="glass-card card stat-card">
      <div className="stat-card__icon" style={{ background: a.iconBg, borderColor: a.iconBorder }}>
        {React.createElement(icon, { size: 22, color: a.iconColor })}
      </div>
      <div>
        <div className="stat-card__label">{title}</div>
        <div className="stat-card__value" style={{ color: a.valueColor }}>
          {value}
        </div>
      </div>
    </div>
  );
};

const StatsOverview = ({ metadata, anomalies }) => {
  const anomalyRate = metadata.total_rows > 0 ? ((anomalies.length / metadata.total_rows) * 100).toFixed(1) : 0;

  return (
    <div className="grid grid--stats">
      <StatCard title="Total Records" value={metadata.total_rows.toLocaleString()} icon={Database} accent="slate" />
      <StatCard title="Detected Anomalies" value={anomalies.length} icon={AlertCircle} accent="cyan" />
      <StatCard title="Anomaly Rate" value={`${anomalyRate}%`} icon={Activity} accent="purple" />
      <StatCard
        title="Severity Peak"
        value={`${(Math.max(...anomalies.map((a) => a.severity), 0) * 100).toFixed(0)}%`}
        icon={TrendingUp}
        accent="red"
      />
    </div>
  );
};

export default StatsOverview;
