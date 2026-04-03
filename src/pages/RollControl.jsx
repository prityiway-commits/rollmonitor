/**
 * RollControl.jsx
 * - Custom roll names (editable, persisted in localStorage)
 * - Start + Stop per roll
 * - sysid from dropdown
 */
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { postMeasConfig, postMeasStart, postMeasStop } from '../services/api'
import { Spinner, ConfirmModal, SectionHead, ErrorBanner } from '../components'
import SysIdSelector, { useSysId } from '../components/SysIdSelector'
import { useRollNames } from '../components/RollNameContext'

const DEFAULT_CONFIG = {
  r1_min_d: 200, r1_max_d: 500, r1_pos: 50,  r1_n_steps: 500, r1_step: 1.5, r1_rad: 900,  r1_rpm: 20,
  r2_min_d: 100, r2_max_d: 400, r2_pos: 10,  r2_n_steps: 400, r2_step: 2.5, r2_rad: 1000, r2_rpm: 19,
}

function Field({ label, name, value, unit, step, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
      <label style={{ fontSize: '12px', color: '#64748b', width: '180px', flexShrink: 0 }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
        <input
          type="number" name={name} value={value} step={step || 'any'} onChange={onChange}
          className="input-field"
          style={{ width: '140px', textAlign: 'right', fontFamily: '"JetBrains Mono",monospace', fontSize: '13px' }}
        />
        {unit && <span style={{ fontSize: '12px', color: '#94a3b8', width: '36px' }}>{unit}</span>}
      </div>
    </div>
  )
}

// ── Roll name editor ──────────────────────────────────────────
function RollNameEditor({ rollKey, value, onChange }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)

  function save() {
    onChange(draft.trim() || value)
    setEditing(false)
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          autoFocus
          style={{
            fontSize: '13px', fontWeight: '700', color: '#1d6fbd',
            border: '1.5px solid #bfdbfe', borderRadius: '6px',
            padding: '4px 10px', background: '#f8fafc', outline: 'none', width: '180px',
          }}
        />
        <button onClick={save} className="btn-primary" style={{ padding: '4px 12px', fontSize: '12px' }}>Save</button>
        <button onClick={() => setEditing(false)} className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }}>Cancel</button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '13px', fontWeight: '700', color: '#1d6fbd', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        {value}
      </span>
      <button
        onClick={() => { setDraft(value); setEditing(true) }}
        title="Rename this roll"
        style={{ fontSize: '11px', color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px' }}
      >
        ✏️ Rename
      </button>
    </div>
  )
}

export default function RollControl() {
  const [sysid,  setSysId]  = useSysId()
  const { names, updateName } = useRollNames()
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [modal,  setModal]  = useState({ type: null, open: false })
  const [loading,   setLoading]   = useState(false)
  const [lastError, setLastError] = useState(null)

  const handleChange = e => {
    const { name, value } = e.target
    setConfig(prev => ({ ...prev, [name]: name.includes('n_steps') ? parseInt(value, 10) : parseFloat(value) }))
  }

  async function executeAction() {
    setLoading(true); setLastError(null)
    const fullConfig = { sysid, ...config }
    const fns = {
      config:  () => postMeasConfig(fullConfig),
      start_r1: () => postMeasStart(sysid, 1),
      start_r2: () => postMeasStart(sysid, 2),
      stop_r1:  () => postMeasStop(sysid),
      stop_r2:  () => postMeasStop(sysid),
    }
    const labels = {
      config:   'Configuration applied successfully.',
      start_r1: `Measurement started — ${names.r1}.`,
      start_r2: `Measurement started — ${names.r2}.`,
      stop_r1:  `Measurement stopped — ${names.r1}.`,
      stop_r2:  `Measurement stopped — ${names.r2}.`,
    }
    const res = await fns[modal.type]()
    if (res?.error) { setLastError(res.error); toast.error(res.error) }
    else            { toast.success(labels[modal.type]) }
    setLoading(false); setModal({ type: null, open: false })
  }

  const MODALS = {
    config:   { title: 'Apply Configuration',               message: `Send MeasConfig to device ${sysid}. The PLC will update its measurement parameters immediately.`,          confirmLabel: 'Apply Configuration',  confirmClass: 'btn-primary' },
    start_r1: { title: `Start — ${names.r1}`,               message: `Send MeasStart (rollid=1) to device ${sysid}. Ensure ${names.r1} is clear of obstructions.`,              confirmLabel: `Start ${names.r1}`,    confirmClass: 'btn-success' },
    start_r2: { title: `Start — ${names.r2}`,               message: `Send MeasStart (rollid=2) to device ${sysid}. Ensure ${names.r2} is clear of obstructions.`,              confirmLabel: `Start ${names.r2}`,    confirmClass: 'btn-success' },
    stop_r1:  { title: `Stop — ${names.r1}`,                message: `Send MeasStop to device ${sysid} for ${names.r1}. This halts the active measurement immediately.`,         confirmLabel: `Stop ${names.r1}`,     confirmClass: 'btn-danger'  },
    stop_r2:  { title: `Stop — ${names.r2}`,                message: `Send MeasStop to device ${sysid} for ${names.r2}. This halts the active measurement immediately.`,         confirmLabel: `Stop ${names.r2}`,     confirmClass: 'btn-danger'  },
  }
  const cur = modal.type ? MODALS[modal.type] : {}

  const rollSection = (prefix, rollKey) => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0 8px', borderBottom: '2px solid #eff6ff', marginBottom: '4px' }}>
        <RollNameEditor
          rollKey={rollKey}
          value={names[rollKey]}
          onChange={val => updateName(rollKey, val)}
        />
      </div>
      <Field label="Min sensor distance"  name={`${prefix}_min_d`}   value={config[`${prefix}_min_d`]}   unit="mm"  onChange={handleChange} />
      <Field label="Max sensor distance"  name={`${prefix}_max_d`}   value={config[`${prefix}_max_d`]}   unit="mm"  onChange={handleChange} />
      <Field label="Start position"       name={`${prefix}_pos`}     value={config[`${prefix}_pos`]}     unit="mm"  onChange={handleChange} />
      <Field label="Number of steps"      name={`${prefix}_n_steps`} value={config[`${prefix}_n_steps`]} step={1}   onChange={handleChange} />
      <Field label="Step size"            name={`${prefix}_step`}    value={config[`${prefix}_step`]}    unit="mm"  onChange={handleChange} />
      <Field label="Roll radius"          name={`${prefix}_rad`}     value={config[`${prefix}_rad`]}     unit="mm"  onChange={handleChange} />
      <Field label="Rotation speed"       name={`${prefix}_rpm`}     value={config[`${prefix}_rpm`]}     unit="rpm" onChange={handleChange} />
    </div>
  )

  // ── Per-roll control panel ────────────────────────────────
  const rollControl = (rollKey, rollid) => (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', paddingBottom: '10px', borderBottom: '2px solid #eff6ff' }}>
        <div style={{ fontSize: '13px', fontWeight: '700', color: '#1d6fbd', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {names[rollKey]}
        </div>
        <span className="badge-info" style={{ fontSize: '10px' }}>rollid = {rollid}</span>
      </div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          className="btn-success"
          style={{ flex: 1, justifyContent: 'center', padding: '12px' }}
          onClick={() => setModal({ type: `start_${rollKey}`, open: true })}
        >
          ▶ Start Measurement
        </button>
        <button
          className="btn-danger"
          style={{ flex: 1, justifyContent: 'center', padding: '12px' }}
          onClick={() => setModal({ type: `stop_${rollKey}`, open: true })}
        >
          ■ Stop Measurement
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: '900px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Device selector */}
      <div className="card" style={{ padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#334155' }}>Active Device</div>
          <SysIdSelector value={sysid} onChange={setSysId} />
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>All commands sent to this device via MQTT.</div>
        </div>
      </div>

      <ErrorBanner message={lastError} />

      {/* Roll name tip */}
      <div style={{ padding: '10px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', fontSize: '12px', color: '#1e40af' }}>
        💡 Click <strong>✏️ Rename</strong> next to any roll name below to give it a custom name (e.g. "Top Roll", "Bottom Roll"). The name will update across all pages instantly.
      </div>

      {/* Measurement controls — one card per roll */}
      <SectionHead title="Measurement Control" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {rollControl('r1', 1)}
        {rollControl('r2', 2)}
      </div>

      <div style={{ padding: '12px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '12px', color: '#92400e' }}>
        <strong>Safety:</strong> Ensure the roll is free of obstructions before starting. The PLC confirms receipt via a <code style={{ background: '#fef3c7', padding: '1px 5px', borderRadius: '4px' }}>RollWearMeasStarted</code> MQTT message. Both rolls share the same MeasStop command.
      </div>

      {/* Config form */}
      <div className="card">
        <SectionHead title="Measurement Configuration" />
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px', lineHeight: '1.6' }}>
          Edit parameters and click <strong style={{ color: '#1d4ed8' }}>Apply Configuration</strong> to send MeasConfig to the PLC.
          When the PLC accepts it, <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px', fontSize: '12px' }}>conf</code> changes to <strong>1</strong> and the Dashboard shows Configuration Valid.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          {rollSection('r1', 'r1')}
          {rollSection('r2', 'r2')}
        </div>
        <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #f1f5f9' }}>
          <button className="btn-primary" onClick={() => setModal({ type: 'config', open: true })}>
            ✓ Apply Configuration
          </button>
        </div>
      </div>

      <ConfirmModal
        open={modal.open} title={cur.title} message={cur.message}
        confirmLabel={cur.confirmLabel} confirmClass={cur.confirmClass}
        loading={loading} onConfirm={executeAction}
        onCancel={() => setModal({ type: null, open: false })}
      />
    </div>
  )
}
