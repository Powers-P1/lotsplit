import { Component, type ReactNode } from 'react';

export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return <main className="application-loading">
      <span className="brand">LOTSPLIT</span>
      <section role="alert" aria-labelledby="app-load-error" style={{ maxWidth: 460, textAlign: 'center' }}>
        <h2 id="app-load-error">We could not load this page</h2>
        <p style={{ marginTop: 16 }}>A connection problem or an app update may have interrupted this page. Refresh to load the current version.</p>
        <p className="caption" style={{ marginTop: 12 }}>Check the current status before repeating any payment action.</p>
        <button type="button" className="button button-primary" style={{ marginTop: 24 }} onClick={() => window.location.reload()}>Refresh</button>
      </section>
    </main>;
  }
}
