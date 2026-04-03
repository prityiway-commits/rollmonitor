/**
 * components/index.jsx
 * Shared UI components used across all pages.
 */
import React from 'react'

// ── Loading spinner ──────────────────────────────────────────
export function Spinner({ size = 'md' }) {
  const s = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-8 h-8' : 'w-6 h-6'
  return (
    <div className={`${s} border-2 border-surface-border border-t-brand-500 rounded-full animate-spin`} />
  )
}

// ── Empty / error state ──────────────────────────────────────
export function EmptyState({ icon = '📭', title, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-4xl mb-3">{icon}</div>
      <div className="text-sm font-medium text-slate-300 mb-1">{title}</div>
      {message && <div className="text-xs text-slate-500 max-w-xs mb-4">{message}</div>}
      {action}
    </div>
  )
}

// ── Error banner ─────────────────────────────────────────────
export function ErrorBanner({ message, onRetry }) {
  if (!message) return null
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg bg-red-900/30 border border-red-700/50 text-red-300 text-sm mb-4">
      <span className="mt-0.5 text-base">⚠</span>
      <div className="flex-1">
        <div className="font-medium mb-0.5">Request failed</div>
        <div className="text-red-400/80 text-xs">{message}</div>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="text-xs text-red-300 hover:text-red-100 underline whitespace-nowrap">
          Retry
        </button>
      )}
    </div>
  )
}

// ── Confirmation modal ───────────────────────────────────────
export function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', confirmClass = 'btn-primary', onConfirm, onCancel, loading }) {
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-100 mb-2">{title}</h2>
        <p className="text-sm text-slate-400 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} disabled={loading} className="btn-secondary">Cancel</button>
          <button onClick={onConfirm} disabled={loading} className={confirmClass}>
            {loading ? <Spinner size="sm" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Stat card ────────────────────────────────────────────────
export function StatCard({ label, value, unit, sub, accent }) {
  const accents = {
    ok:   'border-l-4 border-l-emerald-500',
    nok:  'border-l-4 border-l-red-500',
    warn: 'border-l-4 border-l-amber-500',
    info: 'border-l-4 border-l-brand-500',
    none: '',
  }
  return (
    <div className={`card ${accents[accent || 'none']}`}>
      <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-2xl font-semibold text-slate-100 leading-none">
        {value ?? '—'}
        {unit && <span className="text-sm font-normal text-slate-500 ml-1">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-1.5">{sub}</div>}
    </div>
  )
}

// ── Section heading ──────────────────────────────────────────
export function SectionHead({ title, action }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">{title}</h2>
      {action}
    </div>
  )
}

// ── Key-value row ────────────────────────────────────────────
export function KVRow({ label, value, mono }) {
  return (
    <div className="flex justify-between items-baseline py-2.5 border-b border-surface-border/50 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm text-slate-200 ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</span>
    </div>
  )
}

// ── Date range picker row ────────────────────────────────────
import DatePicker from 'react-datepicker'

export function DateRangePicker({ from, to, onFromChange, onToChange }) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div>
        <div className="label">From</div>
        <DatePicker
          selected={from}
          onChange={onFromChange}
          showTimeSelect
          dateFormat="yyyy-MM-dd HH:mm"
          maxDate={to || new Date()}
          placeholderText="Start date"
        />
      </div>
      <div className="text-slate-600 mt-5">→</div>
      <div>
        <div className="label">To</div>
        <DatePicker
          selected={to}
          onChange={onToChange}
          showTimeSelect
          dateFormat="yyyy-MM-dd HH:mm"
          minDate={from}
          maxDate={new Date()}
          placeholderText="End date"
        />
      </div>
    </div>
  )
}
