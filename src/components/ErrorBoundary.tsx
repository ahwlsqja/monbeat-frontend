'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Optional fallback to render instead of the default error UI. */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary — Catches render-time errors in child tree and shows
 * a retry-capable fallback UI instead of crashing the whole page.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <GameView ... />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[MonBeat ErrorBoundary]', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          data-testid="error-boundary-fallback"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: 16,
            background: '#0a0a0f',
            color: '#e0e0e0',
            fontFamily: 'monospace',
          }}
        >
          <span style={{ fontSize: 48 }}>💥</span>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            Something went wrong
          </h2>
          <p
            data-testid="error-message"
            style={{ margin: 0, fontSize: 13, color: '#888', maxWidth: 480, textAlign: 'center' }}
          >
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            data-testid="btn-retry"
            onClick={this.handleRetry}
            style={{
              marginTop: 8,
              padding: '10px 24px',
              background: '#4ade80',
              color: '#0a0a0f',
              border: 'none',
              borderRadius: 6,
              fontFamily: 'monospace',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ↻ Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
