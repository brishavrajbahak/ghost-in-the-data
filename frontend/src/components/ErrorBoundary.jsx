import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("UI ErrorBoundary caught:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    const msg = this.state.error?.message || "Unknown error";
    return (
      <div className="app">
        <main className="container" style={{ padding: "48px 16px" }}>
          <div className="glass-card card">
            <div className="section-title" style={{ marginBottom: 12 }}>
              <span>Something slipped through the veil</span>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {msg}
            </p>
            <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn--pill btn--subtle" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }
}

