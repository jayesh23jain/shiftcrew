import { Component } from 'react';
import { Link } from 'react-router-dom';

// Without this, an error while rendering one page leaves a blank white screen.
// It resets itself whenever the URL changes, so navigating away recovers the app.
export default class ErrorBoundary extends Component {
  state = { error: null, key: this.props.resetKey };

  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Page crashed:', error, info?.componentStack); }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty" role="alert">
        <h3>This page ran into a problem</h3>
        <p>{String(this.state.error?.message || this.state.error)}</p>
        <p><Link to="/dashboard">Go to dashboard</Link> or <button className="btn btn-quiet" onClick={() => window.location.reload()}>reload the page</button></p>
        <p className="muted small">Open the browser console (F12) for details and send that error if it keeps happening.</p>
      </div>
    );
  }
}
