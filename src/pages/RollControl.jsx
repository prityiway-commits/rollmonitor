/**
 * RollControl.jsx — Roller Configuration Page
 *
 * Section 1: PLC ID
 * Section 2: System Configuration (r1/r2 params)
 * Section 3: Measurement Control (per roll, with rename + status display)
 * Section 4: Schedule Measurement
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import {
  postMeasConfig, postMeasStart, postMeasStop,
  fetchMeasStarted, fetchMeasFinished, fetchStatusHistory, toArray,
} from '../services/api'
import { useApi } from '../hooks/useApi'
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

const CONFIG_KEY = sysid => `rollmonitor_measconfig_${sysid}`

function loadSavedConfig(sysid) {
  try {
    const s = localStorage.getItem(CONFIG_KEY(sysid))
    if (s) {
      const saved = JSON.parse(s)
      // Merge with defaults to ensure all keys exist
      return { ...DEFAULT_CONFIG, ...saved }
    }
  } catch {}
  return { ...DEFAULT_CONFIG }
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
function Field({ label, name, value, unit, step, min, max, warn, onChange }) {
  const numVal = parseFloat(value)
  const showWarn = warn && !isNaN(numVal) && (
    (warn.min !== undefined && numVal < warn.min) ||
    (warn.max !== undefined && numVal > warn.max)
  )
  const warnMsg = warn && showWarn
    ? warn.min !== undefined && numVal < warn.min
      ? `⚠ Min ${warn.min} ${unit}`
      : `⚠ Max ${warn.max} ${unit}`
    : null
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'9px 0', borderBottom:'1px solid #f1f5f9' }}>
      <label style={{ fontSize:'12px', color:'#64748b', width:'180px', flexShrink:0 }}>{label}</label>
      <div style={{ display:'flex', alignItems:'center', gap:'8px', flex:1 }}>
        <input type="number" name={name} value={value} step={step||'any'}
          min={min} max={max} onChange={onChange}
          className="input-field"
          style={{ width:'140px', textAlign:'right', fontFamily:'"JetBrains Mono",monospace', fontSize:'13px',
            borderColor: showWarn ? '#f59e0b' : undefined }} />
        {unit && <span style={{ fontSize:'12px', color:'#94a3b8', width:'36px' }}>{unit}</span>}
        {showWarn && warnMsg && (
          <span style={{ fontSize:'11px', color:'#f59e0b', fontWeight:'600' }}>
            {warnMsg}
          </span>
        )}
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
const safeFloat = v => { const n = parseFloat(v); return isNaN(n) ? null : n }

export default function RollControl() {
  const { authCall } = useAuth()
  const [sysid, setSysId]           = useSysId()
  const { names, updateName }       = useRollNames()
  const [config,    setConfig]      = useState(() => loadSavedConfig(sysid))
  const [modal,     setModal]       = useState({ type: null, open: false })
  const [loading,   setLoading]     = useState(false)
  const [lastError, setLastError]   = useState(null)

  // ── Scheduler state ───────────────────────────────────────
  const INTERVALS = [
    { label: 'Every 4 hours',  count: 6  },
    { label: 'Every 6 hours',  count: 4  },
    { label: 'Every 8 hours',  count: 3  },
    { label: 'Every 12 hours', count: 2  },
    { label: 'Every 24 hours', count: 1  },
  ]

  const DEFAULT_SCHED = { enabled: false, intervalCount: 6, startTime: '08:00', slotsUtc: [] }

  // Cache key per sysid — restores schedule instantly on navigation
  const SCHED_CACHE_KEY = `rollmonitor_sched_cache_${sysid}`

  function getCachedSched() {
    try {
      const s = sessionStorage.getItem(SCHED_CACHE_KEY)
      return s ? JSON.parse(s) : DEFAULT_SCHED
    } catch { return DEFAULT_SCHED }
  }

  // applied = what's saved in DB (shown to all users)
  // draft   = what user is editing locally (not yet saved)
  const [applied,      setApplied]      = useState(() => getCachedSched())
  const [draft,        setDraft]        = useState(() => getCachedSched())
  const [schedLoading, setSchedLoading] = useState(false)
  const [schedSaving,  setSchedSaving]  = useState(false)
  const [schedSaved,   setSchedSaved]   = useState(false)

  const isDirty = JSON.stringify(draft) !== JSON.stringify(applied)

  // Convert local HH:MM to UTC HH:MM
  function localToUtc(localHHMM) {
    if (!localHHMM) return '00:00'
    const [h, m] = localHHMM.split(':').map(Number)
    const d = new Date()
    d.setHours(h, m, 0, 0)
    return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`
  }

  // Convert UTC HH:MM to local HH:MM for display
  function utcToLocal(utcHHMM) {
    if (!utcHHMM) return '00:00'
    const [h, m] = utcHHMM.split(':').map(Number)
    const d = new Date()
    d.setUTCHours(h, m, 0, 0)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  }

  // Load schedule from API on sysid change — sets BOTH applied and draft
  useEffect(() => {
    if (!sysid) return
    setSchedLoading(true)
    authCall('get_schedule', { sysid }).then(({ data }) => {
      if (data && data.sysid) {
        const loaded = {
          enabled:       data.enabled || false,
          intervalCount: parseInt(data.intervalCount) || 6,
          startTime:     data.slotsUtc?.length ? utcToLocal(data.slotsUtc[0]) : '08:00',
          slotsUtc:      data.slotsUtc || [],
          updatedBy:     data.updatedBy || '',
        }
        // Cache so navigation doesn't flash defaults
        try { sessionStorage.setItem(SCHED_CACHE_KEY, JSON.stringify(loaded)) } catch {}
        setApplied(loaded)
        setDraft(loaded)
      }
      setSchedLoading(false)
    })
  }, [sysid])

  // Apply button — saves draft to API
  async function applySchedule() {
    if (!sysid) return
    setSchedSaving(true)
    const localSlots = calcSlots(draft.startTime, draft.intervalCount)
    const utcSlots   = localSlots.map(localToUtc)
    const toSave     = { ...draft, slotsUtc: utcSlots }
    const { error: e } = await authCall('save_schedule', {
      sysid,
      enabled:       toSave.enabled,
      intervalCount: toSave.intervalCount,
      startTime:     toSave.startTime,
      slotsUtc:      utcSlots,
    })
    setSchedSaving(false)
    if (e) { toast.error(`Failed to save: ${e}`); return }
    try { sessionStorage.setItem(SCHED_CACHE_KEY, JSON.stringify(toSave)) } catch {}
    setApplied(toSave)
    setDraft(toSave)
    setSchedSaved(true)
    setTimeout(() => setSchedSaved(false), 3000)
    toast.success('Schedule applied — visible to all users')
  }

  const schedSlots = calcSlots(draft.startTime, draft.intervalCount)
  const nextSlot   = nextSlotCountdown(calcSlots(applied.startTime, applied.intervalCount))

  // Fetch latest status for showing current PLC values
  const statusFrom = useMemo(() => {
    const d = new Date(); d.setHours(d.getHours() - 24); return d.toISOString()
  }, [])
  const statusTo = useMemo(() => new Date().toISOString(), [])
  const { data: statusRaw } = useApi(fetchStatusHistory, [sysid, statusFrom, statusTo], { pollMs: 30000 })
  // Fetch latest MeasStarted to show measurement status in scheduler
  const { data: measStartedRaw } = useApi(fetchMeasStarted, [sysid], { pollMs: 30000 })
  const { data: measFinishedRaw } = useApi(fetchMeasFinished, [sysid], { pollMs: 30000 })

  const measIsActive = useMemo(() => {
    const started  = toArray(measStartedRaw).filter(r => r.sysid)
    const finished = toArray(measFinishedRaw).filter(r => r.sysid)
    if (!started.length) return false
    const lastStart  = started.sort((a,b)  => String(b.datetime).localeCompare(String(a.datetime)))[0]
    const lastFinish = finished.sort((a,b) => String(b.datetime).localeCompare(String(a.datetime)))[0]
    if (!lastFinish) return true
    return String(lastStart.datetime) > String(lastFinish.datetime)
  }, [measStartedRaw, measFinishedRaw])

  const lastMeasStart = useMemo(() => {
    const started = toArray(measStartedRaw).filter(r => r.sysid)
    if (!started.length) return null
    return started.sort((a,b) => String(b.datetime).localeCompare(String(a.datetime)))[0]
  }, [measStartedRaw])

  const latestStatus = useMemo(() => {
    const items = toArray(statusRaw).filter(r => r.sysid && r.sysid !== 'unknown')
    if (!items.length) return null
    return items.sort((a,b) => String(b.datetime).localeCompare(String(a.datetime)))[0]
  }, [statusRaw])

  // Save config to localStorage when sysid changes — load saved config
  useEffect(() => {
    setConfig(loadSavedConfig(sysid))
  }, [sysid])

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
    // Validate rpm minimum
    if (parseFloat(config.r1_rpm) < 10 || parseFloat(config.r2_rpm) < 10) {
      alert('Rotation speed must be at least 10 RPM for both rollers.')
      setModal({ type: null, open: false })
      return
    }
    // Validate step size maximum
    if (parseFloat(config.r1_step) > 5 || parseFloat(config.r2_step) > 5) {
      alert('Step size must not exceed 5mm for both rollers.')
      setModal({ type: null, open: false })
      return
    }
    // Validate start position maximum
    if (parseFloat(config.r1_pos) > 500 || parseFloat(config.r2_pos) > 500) {
      alert('Start position must not exceed 500mm for both rollers.')
      setModal({ type: null, open: false })
      return
    }
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

  const rollSection = (prefix, rollKey) => {
    const s = latestStatus
    const pf = v => s?.[`${prefix}_${v}`] != null ? parseFloat(s[`${prefix}_${v}`]).toFixed(1) : '—'
    const pi = v => s?.[`${prefix}_${v}`] != null ? parseInt(s[`${prefix}_${v}`]) : '—'
    const statusStyle = { fontSize:'12px', color:'#22c55e', fontFamily:'"JetBrains Mono",monospace', textAlign:'right', minWidth:'60px' }
    return (
      <div>
        <div style={{ fontSize:'12px', fontWeight:'700', color:'#1d6fbd', textTransform:'uppercase',
          letterSpacing:'0.07em', padding:'10px 0 8px', borderBottom:'2px solid #eff6ff', marginBottom:'4px' }}>
          {names[rollKey]}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:'0' }}>
          {/* Column headers */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 110px 30px 110px', gap:'8px', padding:'4px 0 8px', borderBottom:'1px solid #e2e8f0' }}>
            <span style={{ fontSize:'11px', fontWeight:'600', color:'#475569' }}>Parameter</span>
            <span style={{ fontSize:'11px', fontWeight:'600', color:'#475569', textAlign:'center' }}>Set value</span>
            <span/>
            <span style={{ fontSize:'11px', fontWeight:'600', color:'#475569', textAlign:'center' }}>PLC Status</span>
          </div>
          {/* Rows */}
          {[
            { label:'Min sensor distance',      field:'min_d',   unit:'mm',  type:'real' },
            { label:'Max sensor distance',       field:'max_d',   unit:'mm',  type:'real' },
            { label:'Start position',            field:'pos',     unit:'mm',  type:'real', max:500, hint:'max 500mm' },
            { label:'Number of steps',           field:'n_steps', unit:'',    type:'int'  },
            { label:'Step size',                 field:'step',    unit:'mm',  type:'real', max:5,   hint:'max 5mm'   },
            { label:'Roll radius',               field:'rad',     unit:'mm',  type:'real' },
            { label:'Rotation speed',            field:'rpm',     unit:'rpm', type:'real', min:10,  hint:'min 10rpm' },
          ].map(({ label, field, unit, type, min, max, hint }) => {
            const name   = `${prefix}_${field}`
            const val    = config[name]
            const numVal = parseFloat(val)
            const overMax  = max  && !isNaN(numVal) && numVal > max
            const underMin = min  && !isNaN(numVal) && numVal < min
            const hasWarn  = overMax || underMin
            const plcVal   = type === 'int' ? pi(field) : pf(field)
            return (
              <div key={name} style={{ display:'grid', gridTemplateColumns:'1fr 110px 30px 110px', gap:'8px', alignItems:'center', padding:'8px 0', borderBottom:'1px solid #f1f5f9' }}>
                <div>
                  <span style={{ fontSize:'13px', color:'#334155' }}>{label}</span>
                  {hint && <span style={{ fontSize:'11px', color:'#94a3b8', marginLeft:'6px' }}>({hint})</span>}
                </div>
                {/* Input box — white bg, grey border, clearly editable */}
                <input
                  type="number" name={name} value={val}
                  min={min} max={max} step={type==='int'?1:'any'}
                  onChange={handleChange}
                  style={{
                    width:'100%', textAlign:'right',
                    fontFamily:'"JetBrains Mono",monospace', fontSize:'13px',
                    background:'#ffffff',
                    border: hasWarn ? '1.5px solid #f59e0b' : '1.5px solid #cbd5e1',
                    borderRadius:'6px', padding:'5px 8px',
                    outline:'none', color:'#1e293b',
                    boxShadow:'0 1px 2px rgba(0,0,0,0.04)',
                  }}
                />
                <span style={{ fontSize:'12px', color:'#94a3b8', textAlign:'center' }}>{unit}</span>
                {/* PLC Status box — grey bg, dark border, read-only feel */}
                <div style={{
                  background:'#f1f5f9',
                  border:'1px solid #cbd5e1',
                  borderRadius:'6px', padding:'5px 8px',
                  textAlign:'right',
                  fontFamily:'"JetBrains Mono",monospace', fontSize:'13px',
                  color: plcVal === '—' ? '#94a3b8' : '#15803d',
                  fontWeight: plcVal === '—' ? '400' : '500',
                }}>
                  {plcVal}
                </div>
              </div>
            )
          })}
        </div>
        {/* Warnings */}
        {config[`${prefix}_pos`] > 500 && <div style={{ fontSize:'11px', color:'#f59e0b', marginTop:'4px' }}>⚠ Start position max 500mm</div>}
        {config[`${prefix}_step`] > 5   && <div style={{ fontSize:'11px', color:'#f59e0b', marginTop:'4px' }}>⚠ Step size max 5mm</div>}
        {config[`${prefix}_rpm`] < 10   && <div style={{ fontSize:'11px', color:'#f59e0b', marginTop:'4px' }}>⚠ Rotation speed min 10rpm</div>}
      </div>
    )
  }

  // MQTT status — green if last status < 2 min ago
  const mqttConnected = useMemo(() => {
    if (!latestStatus?.datetime) return false
    try {
      const dt = new Date(latestStatus.datetime.replace(
        /^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2}:\d{2})/, '$1T$2'
      ) + 'Z')
      return (Date.now() - dt.getTime()) < 2 * 60 * 1000
    } catch { return false }
  }, [latestStatus])

  return (
    <div style={{ maxWidth:'1100px', display:'flex', flexDirection:'column', gap:'16px' }}>

      {/* ── Row 1: PLC ID + MQTT Status ── */}
      <div className="card" style={{ padding:'12px 20px', display:'flex', alignItems:'center', gap:'24px', flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <span style={{ fontSize:'12px', fontWeight:'600', color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em' }}>PLC ID</span>
          <SysIdSelector value={sysid} onChange={setSysId} />
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', marginLeft:'auto' }}>
          <span style={{ fontSize:'12px', fontWeight:'600', color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em' }}>MQTT Status</span>
          <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'4px 12px',
            background: mqttConnected ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${mqttConnected ? '#bbf7d0' : '#fecaca'}`,
            borderRadius:'20px' }}>
            <div style={{ width:'7px', height:'7px', borderRadius:'50%',
              background: mqttConnected ? '#22c55e' : '#ef4444' }} />
            <span style={{ fontSize:'12px', fontWeight:'600',
              color: mqttConnected ? '#15803d' : '#dc2626' }}>
              {mqttConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          {latestStatus?.datetime && (
            <span style={{ fontSize:'11px', color:'#94a3b8' }}>
              Last seen: {latestStatus.datetime.replace('T',' ').slice(0,19)}
            </span>
          )}
        </div>
      </div>

      <ErrorBanner message={lastError} />

      {/* ── System Configuration ── */}
      <div className="card">
        <div style={{ fontSize:'14px', fontWeight:'700', color:'#1e293b', marginBottom:'2px' }}>
          System Configuration
        </div>
        <p style={{ fontSize:'12px', color:'#94a3b8', marginBottom:'16px', lineHeight:'1.6' }}>
          Edit parameters and click <strong style={{ color:'#1d4ed8' }}>Apply Configuration</strong> to send MeasConfig to the PLC.
          PLC column shows current values from latest Status message.
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'32px' }}>
          {rollSection('r1', 'r1')}
          {rollSection('r2', 'r2')}
        </div>
        <div style={{ marginTop:'20px', paddingTop:'16px', borderTop:'1px solid #f1f5f9' }}>
          <button className="btn-primary" onClick={() => setModal({ type:'config', open:true })}>
            ✓ Apply Configuration
          </button>
        </div>
      </div>

      {/* ── Section 4: Schedule Measurement ── */}
      <div className="card">
        {/* Active schedule summary — always visible at top */}
        {applied.slotsUtc?.length > 0 && (
          <div style={{ marginBottom:'16px', padding:'12px 16px', borderRadius:'8px',
            background: applied.enabled ? '#f0fdf4' : '#f8fafc',
            border: `1px solid ${applied.enabled ? '#bbf7d0' : '#e2e8f0'}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'6px' }}>
              <div style={{ width:'8px', height:'8px', borderRadius:'50%',
                background: applied.enabled ? '#22c55e' : '#94a3b8' }} />
              <span style={{ fontSize:'13px', fontWeight:'700',
                color: applied.enabled ? '#166534' : '#64748b' }}>
                {applied.enabled ? 'Schedule Active' : 'Schedule Inactive'}
              </span>
            </div>
            <div style={{ display:'flex', gap:'24px', flexWrap:'wrap' }}>
              <div>
                <span style={{ fontSize:'11px', color:'#94a3b8' }}>Frequency</span>
                <div style={{ fontSize:'13px', fontWeight:'600', color:'#1e293b', marginTop:'2px' }}>
                  {INTERVALS.find(i => i.count === applied.intervalCount)?.label || `Every ${applied.intervalCount} slots`}
                </div>
              </div>
              <div>
                <span style={{ fontSize:'11px', color:'#94a3b8' }}>First slot (local time)</span>
                <div style={{ fontSize:'13px', fontWeight:'600', color:'#1e293b', fontFamily:'"JetBrains Mono",monospace', marginTop:'2px' }}>
                  {applied.startTime}
                </div>
              </div>
              <div>
                <span style={{ fontSize:'11px', color:'#94a3b8' }}>All slots today</span>
                <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', marginTop:'2px' }}>
                  {calcSlots(applied.startTime, applied.intervalCount).map(s => (
                    <span key={s} style={{ fontSize:'11px', fontFamily:'"JetBrains Mono",monospace',
                      padding:'3px 8px', borderRadius:'4px', background:'#f1f5f9', color:'#475569',
                      border:'1px solid #e2e8f0', display:'inline-block' }}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              {applied.updatedBy && (
                <div style={{ marginLeft:'auto' }}>
                  <span style={{ fontSize:'11px', color:'#94a3b8' }}>Last set by</span>
                  <div style={{ fontSize:'12px', fontWeight:'600', color:'#64748b', marginTop:'2px' }}>
                    {applied.updatedBy}
                  </div>
                </div>
              )}
            </div>
            {/* Measurement status indicator */}
            <div style={{ marginTop:'10px', paddingTop:'10px', borderTop:'1px solid #e2e8f0',
              display:'flex', alignItems:'center', gap:'10px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'6px',
                padding:'5px 12px', borderRadius:'20px',
                background: measIsActive ? '#f0fdf4' : '#f8fafc',
                border: `1px solid ${measIsActive ? '#bbf7d0' : '#e2e8f0'}` }}>
                <div style={{ width:'7px', height:'7px', borderRadius:'50%',
                  background: measIsActive ? '#22c55e' : '#94a3b8' }} />
                <span style={{ fontSize:'12px', fontWeight:'600',
                  color: measIsActive ? '#166534' : '#64748b' }}>
                  {measIsActive ? 'Measurement Active' : 'No Active Measurement'}
                </span>
              </div>
              {lastMeasStart && (() => {
                // Convert DynamoDB datetime (UTC) to local time for display
                try {
                  const raw = String(lastMeasStart.datetime)
                  // Format: 2026-04-16-12:51:00 or 2026-04-16T12:51:00
                  const iso = raw.replace(/^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})/, '$1T$2') + (raw.includes('Z') ? '' : 'Z')
                  const local = new Date(iso).toLocaleString('en-GB', {
                    day:'2-digit', month:'2-digit', year:'numeric',
                    hour:'2-digit', minute:'2-digit', hour12: false
                  })
                  return <span style={{ fontSize:'11px', color:'#94a3b8' }}>Last started: {local}</span>
                } catch {
                  return <span style={{ fontSize:'11px', color:'#94a3b8' }}>Last started: {String(lastMeasStart.datetime).slice(0,16)}</span>
                }
              })()}
            </div>
          </div>
        )}

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <div style={{ fontSize:'14px', fontWeight:'700', color:'#1e293b' }}>Schedule Measurement</div>
              {schedLoading && <span style={{ fontSize:'11px', color:'#94a3b8' }}>Loading...</span>}
              {schedSaved   && <span style={{ fontSize:'11px', color:'#22c55e', fontWeight:'600' }}>✓ Applied — all users see this</span>}
              {isDirty && !schedSaved && <span style={{ fontSize:'11px', color:'#f59e0b', fontWeight:'600' }}>● Unsaved changes</span>}
            </div>
            <div style={{ fontSize:'12px', color:'#94a3b8', marginTop:'2px' }}>
              Automatically trigger MeasStart on MQTT · Schedule shared with all users
            </div>
          </div>
          {/* Enable/Disable toggle */}
          <label style={{ display:'flex', alignItems:'center', gap:'8px', cursor:'pointer' }}>
            <span style={{ fontSize:'13px', color:'#64748b' }}>{draft.enabled ? 'Enabled' : 'Disabled'}</span>
            <div
              onClick={() => setDraft(d => ({ ...d, enabled: !d.enabled }))}
              style={{
                width:'44px', height:'24px', borderRadius:'12px', cursor:'pointer',
                background: draft.enabled ? '#1d4ed8' : '#e2e8f0',
                position:'relative', transition:'background 0.2s',
              }}
            >
              <div style={{
                position:'absolute', top:'3px',
                left: draft.enabled ? '22px' : '3px',
                width:'18px', height:'18px', borderRadius:'50%',
                background:'#fff', transition:'left 0.2s',
                boxShadow:'0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </div>
          </label>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'20px' }}>
          {/* Interval selector */}
          <div>
            <div style={{ fontSize:'11px', fontWeight:'600', color:'#64748b', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'8px' }}>
              Measurement Interval
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
              {INTERVALS.map(({ label, count }) => (
                <label key={count} style={{ display:'flex', alignItems:'center', gap:'10px', cursor:'pointer',
                  padding:'8px 12px', borderRadius:'8px',
                  background: draft.intervalCount === count ? '#eff6ff' : '#f8fafc',
                  border: `1.5px solid ${draft.intervalCount === count ? '#bfdbfe' : '#e2e8f0'}`,
                }}>
                  <input type="radio" name="interval" value={count}
                    checked={draft.intervalCount === count}
                    onChange={() => setDraft(d => ({ ...d, intervalCount: count }))}
                    style={{ accentColor:'#1d4ed8' }}
                  />
                  <span style={{ fontSize:'13px', color:'#1e293b', fontWeight: draft.intervalCount === count ? '600' : '400' }}>
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Start time + schedule preview */}
          <div>
            <div style={{ fontSize:'11px', fontWeight:'600', color:'#64748b', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'8px' }}>
              First Measurement Time
            </div>
            <input
              type="time"
              value={draft.startTime}
              onChange={e => setDraft(d => ({ ...d, startTime: e.target.value }))}
              style={{
                width:'100%', padding:'8px 12px', fontSize:'14px', fontFamily:'"JetBrains Mono",monospace',
                border:'1.5px solid #e2e8f0', borderRadius:'8px', background:'#fff',
                color:'#1e293b', outline:'none', marginBottom:'16px',
              }}
            />

            {schedSlots.length > 0 && (
              <>
                <div style={{ fontSize:'11px', fontWeight:'600', color:'#64748b', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:'6px' }}>
                  Scheduled Times (Today)
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:'6px', marginBottom:'12px' }}>
                  {schedSlots.map(slot => (
                    <span key={slot} style={{
                      fontSize:'12px', fontFamily:'"JetBrains Mono",monospace',
                      padding:'3px 8px', borderRadius:'6px',
                      background:'#f0fdf4', border:'1px solid #bbf7d0', color:'#166534',
                    }}>
                      {slot}
                    </span>
                  ))}
                </div>

                {nextSlot && applied.enabled && (
                  <div style={{ padding:'10px 12px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:'8px', fontSize:'12px', color:'#1d4ed8' }}>
                    ⏰ Next: {nextSlot.label}
                    <div style={{ fontSize:'11px', color:'#64748b', marginTop:'4px' }}>
                      EventBridge fires MeasStart automatically at each slot
                    </div>
                  </div>
                )}

                {!applied.enabled && (
                  <div style={{ padding:'10px 12px', background:'#fafafa', border:'1px solid #e2e8f0', borderRadius:'8px', fontSize:'12px', color:'#94a3b8' }}>
                    {applied.slotsUtc?.length ? 'Schedule disabled — enable and apply to activate' : 'No schedule set yet — configure and click Apply'}
                  </div>
                )}

                {/* Apply button */}
                <div style={{ marginTop:'16px', paddingTop:'16px', borderTop:'1px solid #f1f5f9', display:'flex', alignItems:'center', gap:'12px' }}>
                  <button
                    className="btn-primary"
                    onClick={applySchedule}
                    disabled={schedSaving || schedLoading || !sysid}
                    style={{ fontSize:'13px', padding:'8px 20px' }}
                  >
                    {schedSaving ? '...' : '✓ Apply Schedule'}
                  </button>
                  {isDirty && (
                    <button
                      onClick={() => setDraft(applied)}
                      style={{ fontSize:'12px', padding:'6px 14px', border:'1px solid #e2e8f0', borderRadius:'8px', background:'#f8fafc', cursor:'pointer', color:'#64748b' }}
                    >
                      Discard changes
                    </button>
                  )}
                  {applied.updatedBy && (
                    <span style={{ fontSize:'11px', color:'#94a3b8', marginLeft:'auto' }}>
                      Last set by: {applied.updatedBy}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Config confirm modal — inline overlay */}
      {modal.open && modal.type === 'config' && (
        <div
          onClick={() => setModal({ type:null, open:false })}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 99999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(15,23,42,0.5)',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '18px', padding: '1.75rem',
              width: '100%', maxWidth: '420px', margin: '1rem',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ fontSize:'18px', fontWeight:'700', color:'#1e293b', marginBottom:'10px' }}>
              Apply System Configuration
            </div>
            <div style={{ fontSize:'14px', color:'#64748b', lineHeight:'1.6', marginBottom:'24px' }}>
              Send MeasConfig to device {sysid}. The PLC will update its measurement parameters immediately.
            </div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:'10px' }}>
              <button
                onClick={() => setModal({ type:null, open:false })}
                disabled={loading}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={executeConfig}
                disabled={loading}
                className="btn-primary"
              >
                {loading ? '...' : 'Apply Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
