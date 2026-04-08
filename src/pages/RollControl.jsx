/**
 * RollControl.jsx — Roller Configuration Page
 *
 * Section 1: PLC ID
 * Section 2: System Configuration (r1/r2 params)
 * Section 3: Measurement Control (per roll, with rename + status display)
 * Section 4: Schedule Measurement
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import toast from 'react-hot-toast'
import {
  postMeasConfig, postMeasStart, postMeasStop,
  fetchMeasStarted, fetchMeasFinished, toArray,
} from '../services/api'
import { Spinner, ConfirmModal, SectionHead, ErrorBanner } from '../components'
import SysIdSelector, { useSysId } from '../components/SysIdSelector'
import { useRollNames } from '../components/RollNameContext'

// ── Default config ────────────────────────────────────────────
const DEFAULT_CONFIG = {
  r1_min_d: 200, r1_max_d: 500, r1_pos: 50,  r1_n_steps: 500,
  r1_step:  1.5, r1_rad:   900, r1_rpm:  20,
  r2_min_d: 100, r2_max_d: 400, r2_pos: 10,  r2_n_steps: 400,
  r2_step:  2.5, r2_rad:  1000, r2_rpm:  19,
}

const SCHEDULE_KEY = (sysid) => `rollmonitor_schedule_${sysid}`

// ── Helpers ───────────────────────────────────────────────────
function fmtNow() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} ${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`
}

function calcSlots(startTime, count) {
  if (!startTime) return []
  const [h, m] = startTime.split(':').map(Number)
  const interval = 24 / count
  return Array.from({ length: count }, (_, i) => {
    const totalMins = (h * 60 + m + i * interval * 60) % (24 * 60)
    const hh = String(Math.floor(totalMins / 60)).padStart(2, '0')
    const mm = String(Math.round(totalMins % 60)).padStart(2, '0')
    return `${hh}:${mm}`
  })
}

function nextSlotCountdown(slots) {
  if (!slots.length) return null
  const now = new Date()
  const nowMins = now.getHours() * 60 + now.getMinutes()
  for (const slot of slots) {
    const [h, m] = slot.split(':').map(Number)
    const slotMins = h * 60 + m
    if (slotMins > nowMins) {
      const diff = slotMins - nowMins
      return { slot, diffMins: diff, label: `Today at ${slot} (in ${Math.floor(diff/60)}h ${diff%60}m)` }
    }
  }
  // All slots passed today — next is first slot tomorrow
  const [h, m] = slots[0].split(':').map(Number)
  const slotMins = h * 60 + m
  const diff = (24 * 60 - nowMins) + slotMins
  return { slot: slots[0], diffMins: diff, label: `Tomorrow at ${slots[0]} (in ${Math.floor(diff/60)}h ${diff%60}m)` }
}

// ── Config field ──────────────────────────────────────────────
function Field({ label, name, value, unit, step, onChange }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'9px 0', borderBottom:'1px solid #f1f5f9' }}>
      <label style={{ fontSize:'12px', color:'#64748b', width:'180px', flexShrink:0 }}>{label}</label>
      <div style={{ display:'flex', alignItems:'center', gap:'8px', flex:1 }}>
        <input type="number" name={name} value={value} step={step||'any'} onChange={onChange}
          className="input-field"
          style={{ width:'140px', textAlign:'right', fontFamily:'"JetBrains Mono",monospace', fontSize:'13px' }} />
        {unit && <span style={{ fontSize:'12px', color:'#94a3b8', width:'36px' }}>{unit}</span>}
      </div>
    </div>
  )
}

// ── Roll name editor ──────────────────────────────────────────
function RollNameEditor({ value, onChange }) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)

  function save() {
    onChange(draft.trim() || value)
    setEditing(false)
  }

  if (editing) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
        <input value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key==='Enter') save(); if (e.key==='Escape') setEditing(false) }}
          autoFocus
          style={{ fontSize:'14px', fontWeight:'700', color:'#1d6fbd', border:'1.5px solid #bfdbfe',
            borderRadius:'6px', padding:'4px 10px', background:'#f8fafc', outline:'none', width:'180px' }} />
        <button onClick={save} className="btn-primary" style={{ padding:'4px 12px', fontSize:'12px' }}>Save</button>
        <button onClick={() => setEditing(false)} className="btn-secondary" style={{ padding:'4px 10px', fontSize:'12px' }}>Cancel</button>
      </div>
    )
  }
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
      <span style={{ fontSize:'15px', fontWeight:'700', color:'#1e293b' }}>{value}</span>
      <button onClick={() => { setDraft(value); setEditing(true) }}
        style={{ fontSize:'11px', color:'#94a3b8', background:'none', border:'1px solid #e2e8f0',
          cursor:'pointer', padding:'2px 8px', borderRadius:'6px', fontFamily:'inherit' }}>
        ✏️ Rename
      </button>
    </div>
  )
}

// ── Measurement status display ────────────────────────────────
function MeasStatus({ started, stopped }) {
  if (!started && !stopped) return null
  return (
    <div style={{ marginTop:'10px', display:'flex', flexDirection:'column', gap:'6px' }}>
      {started && (
        <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'8px 12px',
          background:'#fff5f5', border:'1px solid #fecaca', borderRadius:'8px' }}>
          <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:'#ef4444',
            display:'inline-block', animation:'pulse 1.5s infinite', flexShrink:0 }} />
          <div>
            <div style={{ fontSize:'12px', fontWeight:'700', color:'#dc2626' }}>Measurement Started</div>
            <div style={{ fontSize:'10px', color:'#94a3b8', fontFamily:'monospace' }}>{started}</div>
          </div>
        </div>
      )}
      {stopped && (
        <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'8px 12px',
          background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:'8px' }}>
          <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:'#64748b',
            display:'inline-block', flexShrink:0 }} />
          <div>
            <div style={{ fontSize:'12px', fontWeight:'600', color:'#64748b' }}>Measurement Stopped / Finished</div>
            <div style={{ fontSize:'10px', color:'#94a3b8', fontFamily:'monospace' }}>{stopped}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Per-roll control card ─────────────────────────────────────
function RollCard({ rollKey, rollid, sysid, names, updateName, onAction }) {
  const [startedAt, setStartedAt] = useState(null)
  const [stoppedAt, setStoppedAt] = useState(null)
  const [polling,   setPolling]   = useState(false)
  const pollRef = useRef(null)

  // Poll for MeasStarted confirmation
  // clickedAt = ISO timestamp of when Start button was pressed
  // Only accept DynamoDB records NEWER than clickedAt to avoid stale data
  async function pollStarted(clickedAt) {
    setPolling(true)
    let attempts = 0
    const check = async () => {
      const { data } = await fetchMeasStarted(sysid)
      const items = toArray(data)
      const match = items.find(i => {
        if (String(i.rollid) !== String(rollid)) return false
        // Parse DynamoDB datetime and compare to click time
        const s = String(i.datetime || '')
        const parts = s.split('-')
        let recDate = null
        if (parts.length >= 4) {
          recDate = new Date(`${parts[0]}-${parts[1]}-${parts[2]}T${parts.slice(3).join('-')}`)
        } else {
          recDate = new Date(s)
        }
        // Record must be from AFTER the button was clicked
        return recDate && !isNaN(recDate) && recDate >= clickedAt
      })
      if (match) {
        setStartedAt(fmtNow())
        setStoppedAt(null)
        setPolling(false)
        clearInterval(pollRef.current)
        // Start polling for finish now that start is confirmed
        pollFinished(clickedAt)
      }
      attempts++
      // Stop polling after 5 minutes (100 attempts × 3s)
      if (attempts > 10) {
        setPolling(false)
        clearInterval(pollRef.current)
        toast.error('Measurement Not Started. Check Internet Connection')
      }
    }
    pollRef.current = setInterval(check, 3000)
    check()
  }

  // Poll for MeasFinished — only accept records newer than clickedAt
  async function pollFinished(clickedAt) {
    let attempts = 0
    const finishRef = setInterval(async () => {
      const { data } = await fetchMeasFinished(sysid)
      const items = toArray(data)
      const match = items.find(i => {
        if (String(i.rollid) !== String(rollid)) return false
        const s = String(i.datetime || '')
        const parts = s.split('-')
        let recDate = null
        if (parts.length >= 4) {
          recDate = new Date(`${parts[0]}-${parts[1]}-${parts[2]}T${parts.slice(3).join('-')}`)
        } else {
          recDate = new Date(s)
        }
        return recDate && !isNaN(recDate) && recDate >= clickedAt
      })
      if (match) {
        setStoppedAt(fmtNow())
        clearInterval(finishRef)
      }
      attempts++
      if (attempts > 360) clearInterval(finishRef) // stop after 30 min
    }, 5000)
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  // Reset status display when device changes
  useEffect(() => {
    setStartedAt(null)
    setStoppedAt(null)
    setPolling(false)
    clearInterval(pollRef.current)
  }, [sysid])

  async function handleStart() {
    const clickedAt = new Date() // capture exact click time BEFORE sending
    const ok = await onAction('start', rollid)
    if (ok) {
      setStartedAt(null)
      setStoppedAt(null)
      // Pass clickedAt so we only accept DynamoDB records newer than this
      pollStarted(clickedAt)
    }
  }

  async function handleStop() {
    const ok = await onAction('stop', rollid)
    if (ok) setStoppedAt(fmtNow())
  }

  const color = rollid === 1 ? '#1d6fbd' : '#0891b2'

  return (
    <div className="card" style={{ borderTop: `3px solid ${color}` }}>
      {/* Roll name + rename */}
      <div style={{ marginBottom:'16px', paddingBottom:'12px', borderBottom:'1px solid #f1f5f9' }}>
        <RollNameEditor value={names[rollKey]} onChange={val => updateName(rollKey, val)} />
        <div style={{ fontSize:'10px', color:'#94a3b8', marginTop:'4px' }}>rollid = {rollid}</div>
      </div>

      {/* Start button */}
      <button className="btn-success" style={{ width:'100%', justifyContent:'center', padding:'12px', marginBottom:'4px' }}
        onClick={handleStart}>
        {polling ? <><Spinner size="sm" /> Waiting for confirmation…</> : '▶ Start Measurement'}
      </button>

      {/* Stop button */}
      <button className="btn-danger" style={{ width:'100%', justifyContent:'center', padding:'12px', marginTop:'8px' }}
        onClick={handleStop}>
        ■ Stop Measurement
      </button>

      {/* Status display */}
      <MeasStatus started={startedAt} stopped={stoppedAt} />
    </div>
  )
}

// ── Schedule section ──────────────────────────────────────────
const FREQ_OPTIONS = [
  { label: 'Once everyday',         count: 1,  interval: 24 },
  { label: 'Twice everyday',        count: 2,  interval: 12 },
  { label: 'Three times everyday',  count: 3,  interval: 8  },
  { label: 'Four times everyday',   count: 4,  interval: 6  },
  { label: 'Once a week',           count: 1,  interval: 168, weekly: true },
]

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

function ScheduleSection({ sysid, onScheduledAction }) {
  const [enabled,   setEnabled]   = useState(false)
  const [freqIdx,   setFreqIdx]   = useState(0)
  const [startTime, setStartTime] = useState('08:00')
  const [weekDay,   setWeekDay]   = useState('Monday')
  const [saved,     setSaved]     = useState(false)
  const [nextInfo,  setNextInfo]  = useState(null)
  const timerRef = useRef(null)

  const freq    = FREQ_OPTIONS[freqIdx]
  const slots   = freq.weekly ? [startTime] : calcSlots(startTime, freq.count)

  // Load saved schedule
  useEffect(() => {
    try {
      const s = localStorage.getItem(SCHEDULE_KEY(sysid))
      if (s) {
        const p = JSON.parse(s)
        setEnabled(p.enabled || false)
        setFreqIdx(p.freqIdx ?? 0)
        setStartTime(p.startTime || '08:00')
        setWeekDay(p.weekDay || 'Monday')
        setSaved(true)
      }
    } catch {}
  }, [sysid])

  // Update next slot info
  useEffect(() => {
    if (!enabled || !saved) { setNextInfo(null); return }
    setNextInfo(nextSlotCountdown(slots))
    const t = setInterval(() => setNextInfo(nextSlotCountdown(slots)), 60000)
    return () => clearInterval(t)
  }, [enabled, saved, slots.join(',')])

  // Scheduler timer — checks every minute
  useEffect(() => {
    if (!enabled || !saved) { clearInterval(timerRef.current); return }
    const check = () => {
      const now = new Date()
      const hh  = String(now.getHours()).padStart(2,'0')
      const mm  = String(now.getMinutes()).padStart(2,'0')
      const timeNow = `${hh}:${mm}`
      if (slots.includes(timeNow)) {
        toast(`⏰ Scheduled measurement starting now (${timeNow})`, { icon:'🔔' })
        onScheduledAction()
      }
    }
    timerRef.current = setInterval(check, 60000)
    return () => clearInterval(timerRef.current)
  }, [enabled, saved, slots.join(',')])

  function save() {
    localStorage.setItem(SCHEDULE_KEY(sysid), JSON.stringify({
      enabled, freqIdx, startTime, weekDay,
    }))
    setSaved(true)
    toast.success('Schedule saved')
  }

  function clear() {
    localStorage.removeItem(SCHEDULE_KEY(sysid))
    setEnabled(false); setSaved(false); setNextInfo(null)
    toast('Schedule cleared')
  }

  const selectStyle = {
    padding:'8px 12px', fontSize:'13px', border:'1.5px solid #e2e8f0',
    borderRadius:'8px', background:'#f8fafc', color:'#1e293b',
    outline:'none', fontFamily:'inherit', cursor:'pointer',
  }

  return (
    <div className="card">
      {/* Header with toggle */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
        <div>
          <div style={{ fontSize:'13px', fontWeight:'700', color:'#1e293b' }}>Schedule Measurement</div>
          <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'2px' }}>Auto-start measurements at set times</div>
        </div>
        {/* Toggle switch */}
        <div onClick={() => setEnabled(e => !e)} style={{ cursor:'pointer', position:'relative', width:'44px', height:'24px' }}>
          <div style={{ position:'absolute', inset:0, borderRadius:'12px', background: enabled ? '#1d6fbd' : '#e2e8f0', transition:'background 0.2s' }} />
          <div style={{ position:'absolute', top:'3px', left: enabled ? '23px' : '3px', width:'18px', height:'18px',
            borderRadius:'50%', background:'#fff', transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)' }} />
        </div>
      </div>

      {/* Browser warning */}
      <div style={{ padding:'10px 14px', background:'#fffbeb', border:'1px solid #fde68a',
        borderRadius:'8px', fontSize:'11px', color:'#92400e', marginBottom:'16px' }}>
        ⚠ Schedule runs only while this browser tab is open. For 24/7 reliability, use AWS EventBridge + Lambda.
      </div>

      {/* Frequency */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', marginBottom:'14px' }}>
        <div>
          <div style={{ fontSize:'11px', fontWeight:'700', color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'6px' }}>Frequency</div>
          <select value={freqIdx} onChange={e => setFreqIdx(Number(e.target.value))} style={{ ...selectStyle, width:'100%' }}>
            {FREQ_OPTIONS.map((o,i) => <option key={i} value={i}>{o.label}</option>)}
          </select>
        </div>

        <div>
          <div style={{ fontSize:'11px', fontWeight:'700', color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'6px' }}>
            {freq.weekly ? 'Day of week' : 'Start time'}
          </div>
          {freq.weekly ? (
            <select value={weekDay} onChange={e => setWeekDay(e.target.value)} style={{ ...selectStyle, width:'100%' }}>
              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          ) : (
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
              style={{ ...selectStyle, width:'100%' }} />
          )}
        </div>
      </div>

      {/* If weekly, show time selector too */}
      {freq.weekly && (
        <div style={{ marginBottom:'14px' }}>
          <div style={{ fontSize:'11px', fontWeight:'700', color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'6px' }}>Start time</div>
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
            style={{ ...selectStyle }} />
        </div>
      )}

      {/* Calculated slots */}
      <div style={{ marginBottom:'16px', padding:'12px 14px', background:'#f8fafc', borderRadius:'8px', border:'1px solid #e2e8f0' }}>
        <div style={{ fontSize:'11px', fontWeight:'700', color:'#64748b', marginBottom:'8px', textTransform:'uppercase', letterSpacing:'0.06em' }}>
          Calculated measurement slots
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'8px' }}>
          {slots.map((s,i) => (
            <span key={i} style={{ padding:'4px 12px', background:'#eff6ff', color:'#1e40af',
              borderRadius:'20px', fontSize:'12px', fontWeight:'600', fontFamily:'monospace',
              border:'1px solid #bfdbfe' }}>
              Slot {i+1}: {freq.weekly ? `${weekDay} ${s}` : s}
            </span>
          ))}
        </div>
        {!freq.weekly && (
          <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'8px' }}>
            Interval: every {freq.interval} hours · Both rolls will be started sequentially
          </div>
        )}
      </div>

      {/* Next measurement */}
      {enabled && saved && nextInfo && (
        <div style={{ padding:'12px 14px', background:'#f0fdf4', border:'1px solid #bbf7d0',
          borderRadius:'8px', marginBottom:'14px', fontSize:'12px', color:'#166534', fontWeight:'600' }}>
          ⏰ Next measurement: {nextInfo.label}
        </div>
      )}

      {/* Active status */}
      {enabled && saved && (
        <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'14px' }}>
          <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:'#22c55e',
            animation:'pulse 2s infinite', display:'inline-block' }} />
          <span style={{ fontSize:'12px', color:'#166534', fontWeight:'600' }}>Schedule is active</span>
        </div>
      )}

      {/* Buttons */}
      <div style={{ display:'flex', gap:'10px' }}>
        <button className="btn-primary" style={{ fontSize:'12px' }} onClick={save}>
          💾 Save Schedule
        </button>
        <button className="btn-secondary" style={{ fontSize:'12px' }} onClick={clear}>
          🗑 Clear Schedule
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────
export default function RollControl() {
  const [sysid, setSysId]           = useSysId()
  const { names, updateName }       = useRollNames()
  const [config,    setConfig]      = useState(DEFAULT_CONFIG)
  const [modal,     setModal]       = useState({ type: null, open: false })
  const [loading,   setLoading]     = useState(false)
  const [lastError, setLastError]   = useState(null)

  const handleChange = e => {
    const { name, value } = e.target
    setConfig(prev => ({ ...prev, [name]: name.includes('n_steps') ? parseInt(value,10) : parseFloat(value) }))
  }

  // Shared action handler (used by roll cards and scheduler)
  const handleAction = useCallback(async (type, rollid) => {
    setLastError(null)
    let res
    if (type === 'start') res = await postMeasStart(sysid)
    else                  res = await postMeasStop(sysid)
    if (res?.error) { toast.error(res.error); return false }
    return true
  }, [sysid])

  // Scheduled action — starts both rolls sequentially
  const handleScheduledAction = useCallback(async () => {
    await handleAction('start', 1)
    setTimeout(() => handleAction('start', 2), 3000)
  }, [handleAction])

  async function executeConfig() {
    setLoading(true); setLastError(null)
    const res = await postMeasConfig({ sysid, ...config })
    if (res?.error) {
      setLastError(res.error)
      toast.error(res.error)
    } else {
      toast.success('Configuration applied successfully.')
      // Save config to localStorage so WearResults can read step, rpm, rad
      try {
        localStorage.setItem(
          `rollmonitor_measconfig_${sysid}`,
          JSON.stringify({ ...config, sysid, savedAt: new Date().toISOString() })
        )
      } catch {}
    }
    setLoading(false)
    setModal({ type: null, open: false })
  }

  const rollSection = (prefix, rollKey) => (
    <div>
      <div style={{ fontSize:'12px', fontWeight:'700', color:'#1d6fbd', textTransform:'uppercase',
        letterSpacing:'0.07em', padding:'10px 0 8px', borderBottom:'2px solid #eff6ff', marginBottom:'4px' }}>
        {names[rollKey]}
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

  return (
    <div style={{ maxWidth:'900px', display:'flex', flexDirection:'column', gap:'20px' }}>

      {/* ── Section 1: PLC ID ── */}
      <div className="card" style={{ padding:'14px 20px' }}>
        <div style={{ fontSize:'11px', fontWeight:'700', color:'#64748b', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'10px' }}>
          PLC ID
        </div>
        <SysIdSelector value={sysid} onChange={setSysId} />
      </div>

      <ErrorBanner message={lastError} />

      {/* ── Section 2: Measurement Control ── */}
      <div className="card">
        <div style={{ fontSize:'13px', fontWeight:'700', color:'#1e293b', marginBottom:'4px' }}>
          Measurement Control
        </div>
        <p style={{ fontSize:'13px', color:'#94a3b8', marginBottom:'16px', lineHeight:'1.6' }}>
          Use the buttons below to start or stop measurements per roll.
          The PLC confirms via <code style={{ background:'#f1f5f9', padding:'1px 6px', borderRadius:'4px', fontSize:'12px' }}>RollWearMeasStarted</code> MQTT message.
        </p>
        <div style={{ padding:'10px 14px', background:'#fffbeb', border:'1px solid #fde68a',
          borderRadius:'8px', fontSize:'12px', color:'#92400e', marginBottom:'16px' }}>
          <strong>Safety:</strong> Ensure roll is free of obstructions before starting.
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
          <RollCard rollKey="r1" rollid={1} sysid={sysid} names={names} updateName={updateName} onAction={handleAction} />
          <RollCard rollKey="r2" rollid={2} sysid={sysid} names={names} updateName={updateName} onAction={handleAction} />
        </div>
      </div>

      {/* ── Section 3: Schedule Measurement ── */}
      <ScheduleSection sysid={sysid} onScheduledAction={handleScheduledAction} />

      {/* ── Section 4: System Configuration ── */}
      <div className="card">
        <div style={{ fontSize:'13px', fontWeight:'700', color:'#1e293b', marginBottom:'4px' }}>
          System Configuration
        </div>
        <p style={{ fontSize:'13px', color:'#94a3b8', marginBottom:'16px', lineHeight:'1.6' }}>
          Edit parameters and click <strong style={{ color:'#1d4ed8' }}>Apply Configuration</strong> to send MeasConfig to the PLC.
          When accepted, <code style={{ background:'#f1f5f9', padding:'1px 6px', borderRadius:'4px', fontSize:'12px' }}>conf</code> changes to <strong>1</strong> on the Dashboard.
          This section is needed only during initial setup or when configuration changes.
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'24px' }}>
          {rollSection('r1', 'r1')}
          {rollSection('r2', 'r2')}
        </div>
        <div style={{ marginTop:'20px', paddingTop:'16px', borderTop:'1px solid #f1f5f9' }}>
          <button className="btn-primary" onClick={() => setModal({ type:'config', open:true })}>
            ✓ Apply Configuration
          </button>
        </div>
      </div>

      {/* Config confirm modal */}
      <ConfirmModal
        open={modal.open && modal.type === 'config'}
        title="Apply System Configuration"
        message={`Send MeasConfig to device ${sysid}. The PLC will update its measurement parameters immediately.`}
        confirmLabel="Apply Configuration"
        confirmClass="btn-primary"
        loading={loading}
        onConfirm={executeConfig}
        onCancel={() => setModal({ type:null, open:false })}
      />
    </div>
  )
}
