import React from 'react'
import { createPortal } from 'react-dom'
import DatePicker from 'react-datepicker'

// ── Spinner ──────────────────────────────────────────────────
export function Spinner({ size = 'md' }) {
  const s = size === 'sm' ? 16 : size === 'lg' ? 36 : 24
  return (
    <div style={{
      width: s, height: s,
      border: `2px solid #bfdbfe`,
      borderTopColor: '#1d6fbd',
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
      display: 'inline-block',
    }} />
  )
}

// ── Empty state ──────────────────────────────────────────────
export function EmptyState({ icon = '📭', title, message, action }) {
  return (
    <div style={{ textAlign:'center', padding:'3rem 1rem' }}>
      <div style={{ fontSize:'2.5rem', marginBottom:'12px' }}>{icon}</div>
      <div style={{ fontSize:'15px', fontWeight:'600', color:'#334155', marginBottom:'6px' }}>{title}</div>
      {message && <div style={{ fontSize:'13px', color:'#94a3b8', maxWidth:'340px', margin:'0 auto 16px', lineHeight:'1.6' }}>{message}</div>}
      {action}
    </div>
  )
}

// ── Error banner ─────────────────────────────────────────────
export function ErrorBanner({ message, onRetry }) {
  if (!message) return null
  return (
    <div style={{
      display:'flex', alignItems:'flex-start', gap:'12px',
      padding:'14px 16px', borderRadius:'10px',
      background:'#fff5f5', border:'1px solid #fecaca',
      color:'#dc2626', fontSize:'13px', marginBottom:'16px',
    }}>
      <span style={{ fontSize:'16px', marginTop:'1px', flexShrink:0 }}>⚠</span>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:'600', marginBottom:'3px' }}>Request failed</div>
        <div style={{ color:'#ef4444', fontSize:'12px', opacity:0.85 }}>{message}</div>
      </div>
      {onRetry && (
        <button onClick={onRetry} style={{ fontSize:'12px', color:'#dc2626', background:'none', border:'none', cursor:'pointer', textDecoration:'underline', whiteSpace:'nowrap' }}>
          Retry
        </button>
      )}
    </div>
  )
}

// ── Confirm modal ────────────────────────────────────────────
export function ConfirmModal({ open, title, message, confirmLabel='Confirm', confirmClass='btn-primary', onConfirm, onCancel, loading }) {
  if (!open) return null
  return createPortal(
    <div onClick={onCancel} style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 99999,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
      background: 'rgba(15,23,42,0.5)',
      backdropFilter: 'blur(4px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: '18px',
        padding: '1.75rem',
        width: '100%',
        maxWidth: '420px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        <div style={{ fontSize:'18px', fontWeight:'700', color:'#1e293b', marginBottom:'10px' }}>{title}</div>
        <div style={{ fontSize:'14px', color:'#64748b', lineHeight:'1.6', marginBottom:'24px' }}>{message}</div>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:'10px' }}>
          <button onClick={onCancel} disabled={loading} className="btn-secondary">Cancel</button>
          <button onClick={onConfirm} disabled={loading} className={confirmClass}>
            {loading ? <Spinner size="sm" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Stat card ────────────────────────────────────────────────
export function StatCard({ label, value, unit, sub, accent }) {
  const accentBorder = {
    ok:   '3px solid #22c55e',
    nok:  '3px solid #ef4444',
    warn: '3px solid #f59e0b',
    info: '3px solid #3b82f6',
    none: '3px solid transparent',
  }
  return (
    <div className="card" style={{ borderLeft: accentBorder[accent || 'none'] }}>
      <div style={{ fontSize:'11px', color:'#94a3b8', fontWeight:'600', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:'8px' }}>{label}</div>
      <div style={{ fontSize:'26px', fontWeight:'700', color:'#1e293b', lineHeight:'1' }}>
        {value ?? '—'}
        {unit && <span style={{ fontSize:'13px', fontWeight:'400', color:'#94a3b8', marginLeft:'5px' }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'6px' }}>{sub}</div>}
    </div>
  )
}

// ── Section heading ──────────────────────────────────────────
export function SectionHead({ title, action }) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'14px' }}>
      <div className="section-head" style={{ margin:0 }}>{title}</div>
      {action}
    </div>
  )
}

// ── Key-value row ────────────────────────────────────────────
export function KVRow({ label, value, mono }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', padding:'9px 0', borderBottom:'1px solid #f1f5f9' }}>
      <span style={{ fontSize:'12px', color:'#94a3b8' }}>{label}</span>
      <span style={{ fontSize:'13px', color:'#334155', fontFamily: mono ? '"JetBrains Mono",monospace' : 'inherit', fontWeight:'500' }}>{value ?? '—'}</span>
    </div>
  )
}

// ── Date range picker ────────────────────────────────────────
export function DateRangePicker({ from, to, onFromChange, onToChange }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:'16px', flexWrap:'wrap' }}>
      <div>
        <div className="label">From</div>
        <DatePicker selected={from} onChange={onFromChange} showTimeSelect dateFormat="yyyy-MM-dd HH:mm" maxDate={to || new Date()} placeholderText="Start date" />
      </div>
      <div style={{ color:'#cbd5e1', paddingBottom:'8px', fontSize:'18px' }}>→</div>
      <div>
        <div className="label">To</div>
        <DatePicker selected={to} onChange={onToChange} showTimeSelect dateFormat="yyyy-MM-dd HH:mm" minDate={from} maxDate={new Date()} placeholderText="End date" />
      </div>
    </div>
  )
}

// inject spin keyframe
if (typeof document !== 'undefined' && !document.getElementById('rm-spin')) {
  const st = document.createElement('style')
  st.id = 'rm-spin'
  st.textContent = '@keyframes spin { to { transform: rotate(360deg); } }'
  document.head.appendChild(st)
}
