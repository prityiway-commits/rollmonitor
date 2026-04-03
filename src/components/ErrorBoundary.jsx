/**
 * components/ErrorBoundary.jsx
 *
 * Catches any JavaScript errors in child components and shows
 * a friendly error screen instead of a white blank page.
 *
 * Wraps the entire app in main.jsx so no crash ever shows
 * a blank page to the user.
 */
import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // Log to console for debugging
    console.error('RollMonitor crashed:', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const msg = this.state.error?.message || 'Unknown error'

    return (
      <div style={{
        minHeight: '100vh',
        background: '#f0f4f8',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        fontFamily: '"DM Sans", sans-serif',
      }}>
        <div style={{
          background: '#fff',
          borderRadius: '16px',
          padding: '40px',
          maxWidth: '520px',
          width: '100%',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#1e293b', marginBottom: '8px' }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '20px', lineHeight: '1.6' }}>
            The application encountered an unexpected error. This is usually caused by
            unexpected data from the API. Please refresh the page to try again.
          </p>

          <div style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '24px',
            textAlign: 'left',
          }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>
              Error details
            </div>
            <div style={{ fontSize: '12px', color: '#dc2626', fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {msg}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 24px',
                background: '#1d6fbd',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Refresh Page
            </button>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                padding: '10px 24px',
                background: '#f8fafc',
                color: '#334155',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }
}
