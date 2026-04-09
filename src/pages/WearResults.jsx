/**
 * WearResults.jsx — Fresh rewrite
 *
 * Section 1: Live / Historical toggle
 *   Live:       Data from latest MeasStart until MeasStop
 *   Historical: User picks date+time range
 *
 * Section 2: Current SPOS card
 *   Shows live spos. Resets to 0 if >5min since last record or measurement stopped.
 *
 * Section 3: Charts
 *   Chart 1 (top):   S[i] and C[i] averaged per spos — X=spos, Y=distance mm
 *   Chart 2 (bottom): W[i] averaged per spos — X=spos, Y=wear mm
 *
 * Formulas (i = 1,2,...,array_size):
 *   C[i] = aParam×i² + bParam×i + cParam
 *   W[i] = wear_data[i]  (from PLC)
 *   S[i] = C[i] + W[i]
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import axios from 'axios'
import { fetchWearData, fetchMeasStarted, fetchMeasFinished, toArray } from '../services/api'
import { useApi } from '../hooks/useApi'
import { Spinner, ErrorBanner, SectionHead } from '../components'
import SysIdSelector, { useSysId } from '../components/SysIdSelector'
import { useRollNames } from '../components/RollNameContext'
import { loadSettings } from '../services/analytics'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const GET_BASE = 'https://yf8rql6c0c.execute-api.ap-south-1.amazonaws.com/dashboard'

// ── Helpers ───────────────────────────────────────────────────
function safeFloat(v) { const n = parseFloat(v); return isNaN(n) ? null : n }
function fmt2(v)       { return typeof v === 'number' ? v.toFixed(2) : '—' }

function parseDt(val) {
  if (!val) return null
  const s = String(val)
  const parts = s.split('-')
  if (parts.length >= 4) {
    const iso = `${parts[0]}-${parts[1]}-${parts[2]}T${parts.slice(3).join('-')}Z`
    const d = new Date(iso)
    if (!isNaN(d)) return d
  }
  return null
}

function fmtDt(val) {
  if (!val) return '—'
  const d = parseDt(val)
  if (!d) return String(val).slice(0, 16)
  const hh  = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  const dd  = String(d.getDate()).padStart(2, '0')
  const mm  = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${hh}:${min} ${dd}-${mm}-${yyyy}`
}

// Strip leading apostrophe from bParam (PLC bug)
function cleanParam(v) {
  if (v === null || v === undefined) return 0
  return parseFloat(String(v).replace(/^'+/, '')) || 0
}

function parseWearArr(wear_data) {
  if (!Array.isArray(wear_data)) return []
  return wear_data.map(v =>
    typeof v === 'object' && v?.N !== undefined ? parseFloat(v.N) : parseFloat(v)
  ).filter(v => !isNaN(v))
}

// C[i] — i starts from 1
function computeC(rec) {
  const W = parseWearArr(rec?.wear_data)
  if (!W.length) return []
  const a = cleanParam(rec?.aParam)
  const b = cleanParam(rec?.bParam)
  const c = cleanParam(rec?.cParam)
  return Array.from({ length: W.length }, (_, idx) => {
    const i = idx + 1  // i = 1,2,...,n
    return a*i*i + b*i + c
  })
}

// S[i] = C[i] + W[i]
function computeS(rec) {
  const W = parseWearArr(rec?.wear_data)
  const C = computeC(rec)
  if (!W.length || !C.length) return []
  return W.map((w, idx) => (C[idx] || 0) + w)
}

// Average an array
function arrAvg(arr) {
  if (!arr.length) return null
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

// Group records by spos (rounded to 1 decimal), sorted ascending
function buildSpossData(records) {
  if (!records || !records.length) return []
  const bySpos = {}
  records.forEach(rec => {
    const spos = Math.round((safeFloat(rec.spos) || 0) * 10) / 10
    if (!bySpos[spos]) bySpos[spos] = []
    bySpos[spos].push(rec)
  })
  return Object.entries(bySpos)
    .map(([sposStr, recs]) => {
      // Use latest valid record at this spos (max W[i] <= 100)
      const valid = recs.filter(r => {
        const W = parseWearArr(r.wear_data)
        return W.length > 0 && Math.max(...W) <= 100
      })
      if (!valid.length) return null
      const rec = valid.sort((a, b) =>
        String(b.datetime).localeCompare(String(a.datetime)))[0]
      const W = parseWearArr(rec.wear_data)
      const C = computeC(rec)
      const S = computeS(rec)
      return {
        spos: parseFloat(sposStr),
        avgW: arrAvg(W),
        avgC: arrAvg(C),
        avgS: arrAvg(S),
        rec,
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.spos - b.spos)
}

// ── Heatmap helpers ──────────────────────────────────────────
const ANGLE_BUCKETS = Array.from({ length: 37 }, (_, i) => i * 10) // 0,10...360

// Build heatmap grid: for each spos record, map W[i] to angle buckets
// i = 1..array_size → angle = ((i-1)/array_size) × 360°
function buildHeatmapData(sposData) {
  if (!sposData || !sposData.length) return []
  return sposData.map(({ spos, rec }) => {
    const W    = parseWearArr(rec.wear_data)
    const nPts = W.length
    if (!nPts) return { spos, bucketW: {} }

    const bucketW = {}
    ANGLE_BUCKETS.forEach(b => { bucketW[b] = null })

    for (let i = 1; i <= nPts; i++) {
      const angle  = ((i - 1) / nPts) * 360
      const bucket = Math.round(angle / 10) * 10
      const snap   = bucket >= 360 ? 350 : bucket
      bucketW[snap] = W[i - 1]
    }
    return { spos, bucketW }
  })
}

// Colour scale:
// W > 0 (wear):    orange → dark red   (light orange at small W, dark red at max)
// W < 0 (buildup): blue   → dark blue  (light blue at small W, dark blue at max)
// W = 0:           white
function heatColor(w, absMax) {
  if (w === null || w === undefined) return '#ffffff'
  if (Math.abs(w) < 0.1) return '#ffffff'
  const mx = absMax || 10
  if (w > 0) {
    // orange (255,165,0) → dark red (139,0,0)
    const t = Math.min(1, w / mx)
    const r = Math.round(255 - t * (255 - 139))   // 255 → 139
    const g = Math.round(165 * (1 - t))            // 165 → 0
    const b = 0
    return `rgb(${r},${g},${b})`
  } else {
    // light blue (173,216,230) → dark blue (0,0,139)
    const t = Math.min(1, -w / mx)
    const r = Math.round(173 * (1 - t))            // 173 → 0
    const g = Math.round(216 * (1 - t))            // 216 → 0
    const b = Math.round(230 - t * (230 - 139))    // 230 → 139
    return `rgb(${r},${g},${b})`
  }
}

// ── Heatmap Component ─────────────────────────────────────────
function WearHeatmap({ sposData }) {
  const canvasRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)

  const grid = useMemo(() => buildHeatmapData(sposData), [sposData])

  const absMax = useMemo(() => {
    let mx = 0
    grid.forEach(({ bucketW }) => {
      Object.values(bucketW).forEach(v => {
        if (v !== null && Math.abs(v) > mx) mx = Math.abs(v)
      })
    })
    return mx || 10
  }, [grid])

  const nCols = grid.length
  const nRows = ANGLE_BUCKETS.length // 37

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !nCols || !nRows) return
    const ctx = canvas.getContext('2d')
    const W   = canvas.width
    const H   = canvas.height
    const cW  = W / nCols
    const cH  = H / nRows
    ctx.clearRect(0, 0, W, H)

    grid.forEach(({ bucketW }, ci) => {
      ANGLE_BUCKETS.forEach((bucket, ri) => {
        ctx.fillStyle = heatColor(bucketW[bucket], absMax)
        ctx.fillRect(
          Math.floor(ci * cW), Math.floor(ri * cH),
          Math.ceil(cW) + 1, Math.ceil(cH) + 1
        )
      })
    })
  }, [grid, absMax, nCols, nRows])

  function getCell(e) {
    const canvas = canvasRef.current
    if (!canvas || !nCols) return [null, null]
    const rect  = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const ci = Math.floor((e.clientX - rect.left) * scaleX / (canvas.width / nCols))
    const ri = Math.floor((e.clientY - rect.top)  * scaleY / (canvas.height / nRows))
    return [grid[ci] ?? null, ANGLE_BUCKETS[ri] ?? null]
  }

  if (!nCols) return null

  return (
    <div style={{ marginTop: '24px' }}>
      <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginBottom: '4px' }}>
        Wear Heatmap — Surface Map
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '10px', lineHeight: '1.6' }}>
        X = axial position (spos mm) · Y = angle 0°→360° (i=1→{grid[0] ? Object.keys(grid[0].bucketW).length * 10 : 1500} mapped linearly) ·
        <span style={{ color: '#b45309', fontWeight: '600' }}> Orange→DarkRed = wear (W&gt;0)</span> ·
        <span style={{ color: '#1d4ed8', fontWeight: '600' }}> Blue→DarkBlue = buildup (W&lt;0)</span>
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
        {/* Y axis labels */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '36px', flexShrink: 0 }}>
          {ANGLE_BUCKETS.filter((_, i) => i % 6 === 0).map(a => (
            <span key={a} style={{ fontSize: '9px', color: '#94a3b8', textAlign: 'right', paddingRight: '4px' }}>{a}°</span>
          ))}
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, position: 'relative' }}>
          <canvas
            ref={canvasRef}
            width={Math.max(nCols * 10, 600)}
            height={370}
            style={{ width: '100%', height: '370px', borderRadius: '8px', border: '1px solid #e2e8f0', cursor: 'crosshair', display: 'block' }}
            onMouseMove={e => {
              const [col, angle] = getCell(e)
              if (!col) { setTooltip(null); return }
              const w = col.bucketW?.[angle]
              setTooltip({ spos: col.spos, angle, w: w !== null && w !== undefined ? w.toFixed(3) : '—', x: e.clientX, y: e.clientY })
            }}
            onMouseLeave={() => setTooltip(null)}
          />
          {tooltip && (
            <div style={{ position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 30, background: '#1e293b', color: '#f1f5f9', padding: '5px 10px', borderRadius: '6px', fontSize: '11px', pointerEvents: 'none', zIndex: 9999, whiteSpace: 'nowrap' }}>
              spos={tooltip.spos}mm · {tooltip.angle}° · W={tooltip.w}mm
            </div>
          )}
        </div>

        {/* Colour legend */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '44px', gap: '3px', flexShrink: 0 }}>
          <span style={{ fontSize: '9px', color: '#8b0000', fontWeight: '700' }}>+{absMax.toFixed(1)}</span>
          <div style={{ flex: 1, width: '14px', borderRadius: '4px', background: 'linear-gradient(to bottom, rgb(139,0,0), rgb(255,165,0), #ffffff, rgb(173,216,230), rgb(0,0,139))', border: '1px solid #e2e8f0' }} />
          <span style={{ fontSize: '9px', color: '#00008b', fontWeight: '700' }}>-{absMax.toFixed(1)}</span>
          <span style={{ fontSize: '8px', color: '#94a3b8' }}>mm</span>
        </div>
      </div>

      {/* X axis labels — sync with chart above */}
      <div style={{ paddingLeft: '44px', paddingRight: '52px', marginTop: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#94a3b8' }}>
          {grid.filter((_, i) => i === 0 || i === Math.floor(grid.length / 2) || i === grid.length - 1).map(r => (
            <span key={r.spos}>{r.spos}mm</span>
          ))}
        </div>
        <div style={{ textAlign: 'center', fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
          ← Axial position (spos mm) →
        </div>
      </div>
    </div>
  )
}

// ── Stat Card ─────────────────────────────────────────────────
function StatCard({ label, value, unit, sub, color }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '12px', padding: '16px 20px',
      border: '1px solid #e2e8f0', borderLeft: `4px solid ${color || '#3b82f6'}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    }}>
      <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '26px', fontWeight: '700', color: color || '#1e293b', lineHeight: 1.1 }}>
        {value ?? '—'}
        {unit && <span style={{ fontSize: '14px', fontWeight: '400', color: '#94a3b8', marginLeft: '4px' }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>{sub}</div>}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────
export default function WearResults() {
  const [sysid, setSysId]   = useSysId()
  const { names }           = useRollNames()
  const [rollid, setRollid] = useState(1)
  const rollName            = names['r' + rollid]

  const settings     = loadSettings()
  const rollerLength = rollid === 1 ? (settings.rollerLengthR1 || 1000) : (settings.rollerLengthR2 || 1000)

  // ── Mode: live or historical ──────────────────────────────
  const [mode, setMode]     = useState('live') // 'live' | 'historical'
  const [histFrom, setHistFrom] = useState(() => {
    const d = new Date(); d.setHours(d.getHours() - 4); return d.toISOString().slice(0, 16)
  })
  const [histTo, setHistTo] = useState(() => new Date().toISOString().slice(0, 16))

  // ── Fetch MeasStarted & MeasFinished ─────────────────────
  const { data: startedRaw, refresh: refreshStarted } = useApi(fetchMeasStarted, [sysid], { pollMs: 30000 })
  const { data: finishedRaw, refresh: refreshFinished } = useApi(fetchMeasFinished, [sysid], { pollMs: 30000 })

  const latestStart = useMemo(() => {
    const items = toArray(startedRaw).filter(r => r.sysid && r.sysid !== 'unknown')
    if (!items.length) return null
    return items.sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)))[0]
  }, [startedRaw])

  const latestStop = useMemo(() => {
    const items = toArray(finishedRaw).filter(r => r.sysid && r.sysid !== 'unknown')
    if (!items.length) return null
    return items.sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)))[0]
  }, [finishedRaw])

  // Measurement is active if latest start is after latest stop
  const isActive = useMemo(() => {
    if (!latestStart) return false
    if (!latestStop) return true
    return String(latestStart.datetime) > String(latestStop.datetime)
  }, [latestStart, latestStop])

  // ── Fetch wear data ───────────────────────────────────────
  const liveFromStr = useMemo(() => {
    if (!latestStart) return null
    return latestStart.datetime
      ? (() => {
          const d = parseDt(latestStart.datetime)
          return d ? d.toISOString() : null
        })()
      : null
  }, [latestStart])

  // For live mode: only fetch if we have a MeasStart datetime
  // Never send null from date — would fetch entire table
  const liveEnabled = mode === 'live' && !!liveFromStr

  const { data: rawData, loading, error, refresh } = useApi(
    fetchWearData,
    mode === 'live'
      ? [sysid, rollid, liveFromStr, new Date().toISOString()]
      : [sysid, rollid, new Date(histFrom).toISOString(), new Date(histTo).toISOString()],
    {
      pollMs: liveEnabled ? 30000 : null,
      enabled: mode === 'historical' || liveEnabled,
    }
  )

  const records = useMemo(() =>
    toArray(rawData).filter(r => r.sysid && r.sysid !== 'unknown'),
    [rawData]
  )

  // ── Build chart data ──────────────────────────────────────
  const sposData = useMemo(() => buildSpossData(records), [records])

  // ── Current SPOS card ─────────────────────────────────────
  const currentSpos = useMemo(() => {
    if (!records.length) return 0
    const sorted = [...records].sort((a, b) =>
      String(b.datetime).localeCompare(String(a.datetime)))
    const latest  = sorted[0]
    const latestDt = parseDt(latest.datetime)
    if (!latestDt) return 0
    const minsAgo = (Date.now() - latestDt.getTime()) / 60000
    if (minsAgo > 5) return 0
    return safeFloat(latest.spos) || 0
  }, [records])

  const lastRecordDt = useMemo(() => {
    if (!records.length) return null
    return records.sort((a, b) =>
      String(b.datetime).localeCompare(String(a.datetime)))[0]?.datetime
  }, [records])

  // ── Chart data ────────────────────────────────────────────
  const chartLabels = sposData.map(r => `${r.spos}mm`)

  const scData = {
    labels: chartLabels,
    datasets: [
      {
        label: 'S[i] — Sensor reading (mm)',
        data: sposData.map(r => r.avgS !== null ? parseFloat(r.avgS.toFixed(3)) : null),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.25)',
        borderWidth: 1.5,
        pointRadius: 2,
        fill: 'origin',
        tension: 0.3,
      },
      {
        label: 'C[i] — Calibration curve (mm)',
        data: sposData.map(r => r.avgC !== null ? parseFloat(r.avgC.toFixed(3)) : null),
        borderColor: '#ef4444',
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
      },
    ],
  }

  const wData = {
    labels: chartLabels,
    datasets: [
      {
        label: 'W[i] — Wear data (mm)',
        data: sposData.map(r => r.avgW !== null ? parseFloat(r.avgW.toFixed(3)) : null),
        borderColor: '#1d6fbd',
        backgroundColor: 'rgba(29,111,189,0.15)',
        borderWidth: 1.5,
        pointRadius: 2,
        fill: true,
        tension: 0.3,
      },
      {
        label: 'Zero baseline',
        data: sposData.map(() => 0),
        borderColor: '#94a3b8',
        backgroundColor: 'transparent',
        borderWidth: 1,
        pointRadius: 0,
        fill: false,
        borderDash: [3, 3],
      },
    ],
  }

  const commonOpts = (yLabel, yMin, yMax) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: {
      legend: {
        display: true,
        labels: { color: '#64748b', font: { size: 11 }, boxWidth: 12 },
      },
      tooltip: {
        backgroundColor: '#1e293b',
        titleColor: '#f1f5f9',
        bodyColor: '#94a3b8',
        borderColor: '#334155',
        borderWidth: 1,
        callbacks: {
          title: items => `spos: ${chartLabels[items[0].dataIndex]}`,
          label: item  => ` ${item.dataset.label}: ${Number(item.raw).toFixed(3)}mm`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#94a3b8', font: { size: 10 }, maxRotation: 45, maxTicksLimit: 20 },
        grid:  { color: '#f1f5f9' },
        title: { display: true, text: 'Axial position (spos mm)', color: '#94a3b8', font: { size: 11 } },
      },
      y: {
        ticks: { color: '#94a3b8', font: { size: 10 } },
        grid:  { color: '#f1f5f9' },
        title: { display: true, text: yLabel, color: '#94a3b8', font: { size: 11 } },
        ...(yMin !== undefined ? { min: yMin } : {}),
        ...(yMax !== undefined ? { max: yMax } : {}),
      },
    },
  })

  const inputStyle = {
    padding: '8px 12px', fontSize: '13px',
    border: '1.5px solid #e2e8f0', borderRadius: '8px',
    background: '#fff', color: '#1e293b',
    outline: 'none', fontFamily: 'inherit',
  }

  return (
    <div style={{ maxWidth: '1100px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Section 1: Mode selector ── */}
      <div className="card">
        <SectionHead title="Wear Results" />

        {/* Roll selector */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>PLC ID</div>
            <SysIdSelector value={sysid} onChange={setSysId} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Roll</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[1, 2].map(r => (
                <button key={r} onClick={() => setRollid(r)}
                  className={rollid === r ? 'btn-primary' : 'btn-secondary'}
                  style={{ fontSize: '13px', padding: '8px 16px' }}>
                  {names['r' + r]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live / Historical toggle */}
        <div style={{ display: 'flex', gap: '0', marginBottom: '16px', border: '1.5px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', width: 'fit-content' }}>
          {['live', 'historical'].map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{
                padding: '9px 24px', fontSize: '13px', fontWeight: mode === m ? '700' : '400',
                background: mode === m ? '#1d4ed8' : '#fff',
                color: mode === m ? '#fff' : '#64748b',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                textTransform: 'capitalize',
              }}>
              {m === 'live' ? '🔴 Live' : '📅 Historical'}
            </button>
          ))}
        </div>

        {/* Historical date pickers */}
        {mode === 'historical' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', marginBottom: '4px' }}>From</div>
              <input type="datetime-local" value={histFrom}
                onChange={e => setHistFrom(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ color: '#94a3b8', marginTop: '18px' }}>→</div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', marginBottom: '4px' }}>To</div>
              <input type="datetime-local" value={histTo}
                onChange={e => setHistTo(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ marginTop: '18px' }}>
              <button className="btn-primary" onClick={refresh} style={{ fontSize: '12px', padding: '8px 16px' }}>
                {loading ? <Spinner size="sm" /> : '↻ Load'}
              </button>
            </div>
          </div>
        )}

        {/* Live mode status */}
        {mode === 'live' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {isActive ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '12px', color: '#166534', fontWeight: '600' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
                Measurement active · Started: {fmtDt(latestStart?.datetime)}
              </div>
            ) : (
              <div style={{ padding: '8px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', color: '#64748b' }}>
                ⚪ No active measurement
                {lastRecordDt && <span> · Last data: {fmtDt(lastRecordDt)}</span>}
              </div>
            )}
            <button className="btn-secondary" onClick={() => { refreshStarted(); refreshFinished(); refresh() }}
              style={{ fontSize: '12px', padding: '7px 14px' }}>
              {loading ? <Spinner size="sm" /> : '↻ Refresh'}
            </button>
          </div>
        )}

        {/* MeasStop banner */}
        {mode === 'live' && !isActive && records.length > 0 && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '12px', color: '#92400e' }}>
            ⏹ Measurement stopped · Showing last captured data · Last data from: <strong>{fmtDt(lastRecordDt)}</strong>
          </div>
        )}

        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '10px' }}>
          Roller length: <strong>{rollerLength}mm</strong> · Polling every 30s in live mode
        </div>
      </div>

      {error && <ErrorBanner message="Cannot reach server — check connection" />}

      {loading && !records.length && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <Spinner size="lg" />
        </div>
      )}

      {/* ── Section 2: SPOS card ── */}
      {(records.length > 0 || mode === 'live') && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
          <StatCard
            label="Current SPOS"
            value={fmt2(currentSpos)}
            unit="mm"
            color="#3b82f6"
            sub={currentSpos === 0 ? 'No active reading (>5 min)' : 'Most recent sensor position'}
          />
          <StatCard
            label="Records loaded"
            value={records.length}
            color="#8b5cf6"
            sub={`${sposData.length} unique spos positions`}
          />
          <StatCard
            label="Spos range"
            value={sposData.length ? `${fmt2(sposData[0].spos)} → ${fmt2(sposData[sposData.length-1].spos)}` : '—'}
            unit="mm"
            color="#10b981"
            sub="Along roller length"
          />
        </div>
      )}

      {/* ── Section 3: Charts ── */}
      {sposData.length > 0 && (
        <div className="card">
          <SectionHead title={`Sensor Profile — ${rollName}`} />
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px', lineHeight: '1.6' }}>
            X axis = axial position (spos mm) · Each point = avg across one full revolution ·
            <span style={{ color: '#3b82f6', fontWeight: '600' }}> Blue = S[i] sensor reading</span> ·
            <span style={{ color: '#ef4444', fontWeight: '600' }}> Red = C[i] calibration curve</span>
          </div>

          {/* Chart 1: S[i] and C[i] */}
          <div style={{ height: '280px', marginBottom: '8px' }}>
            <Line data={scData} options={commonOpts('Distance (mm)')} />
          </div>

          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '20px', marginBottom: '8px', lineHeight: '1.6' }}>
            <span style={{ color: '#1d6fbd', fontWeight: '600' }}>Blue = W[i] = S[i] − C[i]</span> ·
            Positive = wear (surface moved away) · Negative = buildup
          </div>

          {/* Chart 2: W[i] */}
          <div style={{ height: '220px' }}>
            <Line data={wData} options={commonOpts('Wear W[i] (mm)')} />
          </div>

          {/* Heatmap — below W[i] chart, same X axis */}
          <WearHeatmap sposData={sposData} />

          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px', textAlign: 'right' }}>
            Last data: {fmtDt(lastRecordDt)} · {records.length} records · {sposData.length} spos positions
          </div>
        </div>
      )}

      {!loading && mode === 'live' && !isActive && records.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📡</div>
          <div style={{ fontSize: '15px', fontWeight: '600', color: '#1e293b', marginBottom: '8px' }}>No Active Measurement</div>
          <div style={{ fontSize: '13px', color: '#94a3b8' }}>
            Start a measurement from the Roller Configuration page.<br/>
            Data will appear here automatically once measurement begins.
          </div>
        </div>
      )}

      {!loading && mode === 'historical' && records.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
          <div style={{ fontSize: '15px', fontWeight: '600', color: '#1e293b', marginBottom: '8px' }}>No Data Found</div>
          <div style={{ fontSize: '13px', color: '#94a3b8' }}>No wear records found in the selected date/time range.</div>
        </div>
      )}

    </div>
  )
}
