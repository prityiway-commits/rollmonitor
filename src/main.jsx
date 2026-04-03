import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './styles/index.css'
import 'react-datepicker/dist/react-datepicker.css'

// ── Global safety patches ─────────────────────────────────────
window.safeJSON = (str) => {
  try { return JSON.parse(str) } catch { return null }
}

// Catch unhandled promise rejections silently
window.addEventListener('unhandledrejection', (event) => {
  console.warn('Unhandled promise rejection:', event.reason)
  event.preventDefault()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#fff',
            color: '#1e293b',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            fontSize: '13px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          },
          success: { iconTheme: { primary: '#22c55e', secondary: '#fff' } },
          error:   { iconTheme: { primary: '#ef4444', secondary: '#fff' } },
        }}
      />
    </ErrorBoundary>
  </React.StrictMode>
)
