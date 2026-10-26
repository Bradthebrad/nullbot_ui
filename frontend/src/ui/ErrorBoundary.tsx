import {Component, type ErrorInfo, type ReactNode} from 'react';

/**
 * Contains a rendering error to one area of the app, so a bad record in one
 * view can't blank the whole window.
 */
export class ErrorBoundary extends Component<{area: string; children: ReactNode; resetKey?: unknown}, {error: Error | null}> {
  state = {error: null as Error | null};

  static getDerivedStateFromError(error: Error) {
    return {error};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[NullBot] ${this.props.area} failed to render`, error, info.componentStack);
  }

  componentDidUpdate(previous: {resetKey?: unknown}) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({error: null});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="blank" role="alert">
        <strong>{this.props.area} couldn’t be shown.</strong>
        <p className="muted">{this.state.error.message || String(this.state.error)}</p>
        <button className="btn" onClick={() => this.setState({error: null})}>Try again</button>
      </div>
    );
  }
}
