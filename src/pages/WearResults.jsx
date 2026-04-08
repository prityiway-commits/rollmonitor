/**
 * WearResults.jsx
 *
 * Section 1: Filters (PLC ID, Roll, Date range, Live/Load)
 * Section 2: Summary cards
 * Section 3A: Roller Surface Heatmap (2D unrolled)
 * Section 3B: Circumferential line chart (always visible, updates on heatmap click)
 * Section 4: Wear Difference (W_test[i] - W_ref[i], reference by date picker)
 */
import React, { useState, useMemo, useEffect, useRef } from 'react'
import { subDays } from 'date-fns'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import axios from 'axios'
import { fetchWearData, fetchDashboard, toArray } from '../services/api'
import { useApi } from '../hooks/useApi'
import { Spinner, ErrorBanner, EmptyState, SectionHead } from '../components'
import DateRangePicker from '../components/DateRangePicker'
import SysIdSelector, { useSysId } from '../components/SysIdSelector'
import { useRollNames } from '../components/RollNameContext'
import { DEFAULT_SETTINGS } from '../services/analytics'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

// ── Helpers ───────────────────────────────────────────────────
function safeFloat(v) { const n = parseFloat(v); return isNaN(n) ? null : n }
function fmt2(v)       { return typeof v === 'number' ? v.toFixed(2) : '—' }
function fmtDt(val) {
  if (!val) return '—'
  const s = String(val).replace('T', ' ')
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[-\s](\d{2}):(\d{2})/)
  if (m) return `${m[4]}:${m[5]} ${m[3]}-${m[2]}-${m[1]}`
  return s.slice(0, 16)
}

function parseWearArr(wear_data) {
  if (!Array.isArray(wear_data)) return []
  return wear_data.map(v =>
    typeof v === 'object' && v?.N !== undefined ? parseFloat(v.N) : parseFloat(v)
  ).filter(v => !isNaN(v))
}

// wear_data IS already W[i] = S[i] - C[i] (pre-computed by PLC)
function computeW(rec) {
  return parseWearArr(rec?.wear_data)
}

function avg(arr) {
  if (!arr.length) return null
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

// Load last applied MeasConfig from localStorage (saved by RollControl on Apply)
function loadMeasConfig(sysid) {
  try {
    const s = localStorage.getItem(`rollmonitor_measconfig_${sysid}`)
    return s ? JSON.parse(s) : null
  } catch { return null }
}

function loadSettings() {
  try {
    const s = localStorage.getItem('rollmonitor_analytics_settings')
    return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : { ...DEFAULT_SETTINGS }
  } catch { return { ...DEFAULT_SETTINGS } }
}

// Group records by spos rounded to 1 decimal
function groupBySpos(records) {
  const map = {}
  if (!records || !Array.isArray(records)) return map
  records.forEach(rec => {
    const spos = safeFloat(rec.spos)
    if (spos === null) return
    const key = Math.round(spos * 10) / 10
    if (!map[key]) map[key] = []
    map[key].push(rec)
  })
  return map
}

// Average W arrays across multiple records at same spos
// ptsPerRot: trim to one full rotation if provided
function avgWatSpos(recs, ptsPerRot) {
  if (!recs || !Array.isArray(recs) || !recs.length) return []
  const allW = recs.map(r => computeW(r))
  const rawLen = Math.max(...allW.map(w => w.length))
  if (!rawLen) return []
  // Use ptsPerRot if valid, otherwise use full array
  const len = (ptsPerRot && ptsPerRot > 0 && ptsPerRot < rawLen)
    ? ptsPerRot
    : rawLen
  return Array.from({ length: len }, (_, i) =>
    avg(allW.map(w => w[i]).filter(v => v !== undefined && !isNaN(v)))
  )
}

// Colour: blue(positive) → white(0) → red(negative) — matching reference image
function wearColor(w, absMax) {
  const range = Math.max(absMax, 0.001)
  const t = Math.max(-1, Math.min(1, w / range))
  if (t >= 0) {
    // positive → blue
    const f = t
    const r = Math.round(255 * (1 - f * 0.7))
    const g = Math.round(255 * (1 - f * 0.7))
    const b = 255
    return `rgb(${r},${g},${b})`
  } else {
    // negative → red
    const f = -t
    const r = 255
    const g = Math.round(255 * (1 - f * 0.7))
    const bl = Math.round(255 * (1 - f * 0.7))
    return `rgb(${r},${g},${bl})`
  }
}

// ── Physics helpers ──────────────────────────────────────────
// Parse DynamoDB datetime (UTC) to JS Date
function parseDt(val) {
  if (!val) return null
  const s = String(val)
  const parts = s.split('-')
  if (parts.length >= 4) {
    // PLC sends UTC time — append Z to parse as UTC
    const iso = `${parts[0]}-${parts[1]}-${parts[2]}T${parts.slice(3).join('-')}Z`
    const d = new Date(iso)
    if (!isNaN(d)) return d
  }
  return null
}

// Derive sampling rate from sweep records (Hz)
// = total array points / total time span of sweep
// Falls back to 311Hz (empirically measured from your data: 1500pts/4.82s)
function deriveSamplingRate(records) {
  const FALLBACK_HZ = 311
  if (!records || !Array.isArray(records) || records.length < 2) return FALLBACK_HZ
  const dts = records
    .map(r => parseDt(r.datetime))
    .filter(Boolean)
    .sort((a, b) => a - b)
  if (dts.length < 2) return FALLBACK_HZ
  const totalSecs = (dts[dts.length-1] - dts[0]) / 1000
  if (totalSecs < 1) return FALLBACK_HZ // too few records to measure accurately
  const totalPts = records.reduce((s, r) => s + (parseInt(r.wear_data_array_size) || 1500), 0)
  const derived = totalPts / totalSecs
  // Sanity check: sampling rate should be between 100-1000 Hz
  if (derived < 100 || derived > 1000) return FALLBACK_HZ
  return Math.round(derived)
}

// Points per one full rotation given RPM and sampling rate
function pointsPerRotation(rpm, samplingRate) {
  if (!rpm || rpm <= 0) return 933 // fallback
  const secsPerRotation = 60 / rpm
  return Math.round(secsPerRotation * samplingRate)
}

// Circumference in mm
function calcCircumference(radius) {
  return 2 * Math.PI * (radius || 900)
}

// ── Stat card ─────────────────────────────────────────────────
function StatCard({ label, value, unit, color, sub }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '12px', padding: '16px 18px',
      border: '1px solid #e2e8f0', borderLeft: `4px solid ${color || '#3b82f6'}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)', flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: '10px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: '700', color: color || '#1e293b', lineHeight: 1.1 }}>
        {value ?? '—'}
        {unit && <span style={{ fontSize: '13px', fontWeight: '400', color: '#94a3b8', marginLeft: '4px' }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>{sub}</div>}
    </div>
  )
}

function LastReceived({ dt }) {
  if (!dt) return null
  return (
    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px', textAlign: 'right' }}>
      Last data received: {fmtDt(dt)}
    </div>
  )
}

// ── Roller Surface Heatmap ────────────────────────────────────
// X = spos (mm along roller length)
// Y = 37 angle buckets: 0°, 10°, 20°... 360°
// Colour = avg W at that (spos, angle) cell
// Blue = W>0 (buildup), Red = W<0 (wear), Light grey = W=0

const ANGLE_BUCKETS = Array.from({ length: 37 }, (_, i) => i * 10) // 0,10,20...360

// ── Filter & select best record per spos ─────────────────────
// Skip records where any W[i] > 100mm (bad/corrupt)
// From valid records at each spos → use latest by datetime
function selectBestRecords(records) {
  if (!records || !Array.isArray(records)) return []

  // Group by spos (rounded to 1 decimal)
  const bySpos = {}
  records.forEach(rec => {
    const spos = Math.round((safeFloat(rec.spos) || 0) * 10) / 10
    if (!bySpos[spos]) bySpos[spos] = []
    bySpos[spos].push(rec)
  })

  const result = []
  Object.entries(bySpos).forEach(([sposStr, recs]) => {
    // Filter out bad records (any W[i] > 100mm)
    const valid = recs.filter(rec => {
      const W = parseWearArr(rec.wear_data)
      if (!W.length) return false
      return Math.max(...W) <= 100
    })
    if (!valid.length) return

    // Take latest valid record by datetime
    const latest = valid.sort((a, b) =>
      String(b.datetime).localeCompare(String(a.datetime))
    )[0]

    result.push({ spos: parseFloat(sposStr), rec: latest })
  })

  return result.sort((a, b) => a.spos - b.spos)
}

// ── Build heatmap grid from best records ──────────────────────
// Step 1: Map each record's W[i] to 37 angle buckets
// Step 2: Spike filter — for each (spos, angle) cell with suspicious value,
//         check W at same angle in spos±2 positions
//         If |W[spos][angle] - W[spos±2][angle]| < 20mm → REAL → keep
//         Otherwise → isolated spike → discard (null)
function buildHeatmapGrid(bestRecords) {
  if (!bestRecords || !bestRecords.length) return []

  // Step 1: Build raw grid
  const rawGrid = bestRecords.map(({ spos, rec }) => {
    const W    = parseWearArr(rec.wear_data)
    if (!W.length) return { spos, bucketW: {} }
    const nPts = W.length

    const bucketW = {}
    ANGLE_BUCKETS.forEach(b => { bucketW[b] = null })

    for (let i = 0; i < nPts; i++) {
      const theta  = (i / nPts) * 360
      const bucket = Math.round(theta / 10) * 10
      const snap   = bucket >= 360 ? 0 : bucket
      bucketW[snap] = W[i]
    }
    return { spos, bucketW, nPts }
  })

  // Step 2: Spike filter across spos positions
  // For each (spos, angle) cell with |W| > 30mm:
  //   Find records within ±2 spos POSITIONS (by array index, not mm distance)
  //   but skip the immediate neighbours (idx±1) — look at idx±2
  //   If |W[this] - W[neighbour]| < 20mm → REAL → keep
  //   If both ±2 neighbours differ by ≥ 20mm → isolated spike → discard
  const filtered = rawGrid.map((cell, idx) => {
    const filteredBucketW = {}

    ANGLE_BUCKETS.forEach(angle => {
      const w = cell.bucketW[angle]
      if (w === null || w === undefined) {
        filteredBucketW[angle] = null
        return
      }

      // Only filter suspicious high values (> 30mm absolute)
      if (Math.abs(w) <= 30) {
        filteredBucketW[angle] = w
        return
      }

      // Collect W values at same angle from ±1 to ±5 spos positions
      const neighbours = []
      for (let d = 1; d <= 5; d++) {
        const p = rawGrid[idx - d]?.bucketW?.[angle]
        const n = rawGrid[idx + d]?.bucketW?.[angle]
        if (p !== null && p !== undefined) neighbours.push(p)
        if (n !== null && n !== undefined) neighbours.push(n)
      }

      if (!neighbours.length) {
        filteredBucketW[angle] = w // no neighbours to compare → keep
        return
      }

      // Compute median of neighbours
      const sorted = [...neighbours].sort((a, b) => a - b)
      const mid    = Math.floor(sorted.length / 2)
      const median = sorted.length % 2 === 0
        ? (sorted[mid-1] + sorted[mid]) / 2
        : sorted[mid]

      // If this value is far from median of neighbours → isolated spike → discard
      if (Math.abs(w - median) >= 20) {
        filteredBucketW[angle] = null
        return
      }

      filteredBucketW[angle] = w
    })

    return { ...cell, bucketW: filteredBucketW }
  })

  return filtered
}

// ── Colour functions ──────────────────────────────────────────
// W > 0 → Red (wear):    light red → dark red at threshold
// W < 0 → Blue (buildup):light blue → dark blue at -30mm
// W = 0 → Light grey
function wearColorAngle(w, threshold) {
  if (w === null || w === undefined) return '#f1f5f9'
  if (Math.abs(w) < 0.1) return '#e2e8f0' // grey at zero

  const thresh = Math.abs(threshold) || 20
  if (w > 0) {
    // Wear → red shading, darkest at threshold
    const intensity = Math.min(1, w / thresh)
    const lightness = Math.round(255 * (1 - intensity * 0.85))
    return `rgb(255,${lightness},${lightness})`
  } else {
    // Buildup → blue shading, darkest at -30mm
    const intensity = Math.min(1, -w / 30)
    const lightness = Math.round(255 * (1 - intensity * 0.85))
    return `rgb(${lightness},${lightness},255)`
  }
}

// ── Roller Surface Heatmap ────────────────────────────────────
function RollerHeatmap({ bestRecords, onSposClick, selectedSpos, threshold, stepSize }) {
  const canvasRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)

  const grid = useMemo(() => buildHeatmapGrid(bestRecords), [bestRecords])

  const nCols = grid.length
  const nRows = ANGLE_BUCKETS.length // 37

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !nCols || !nRows || !grid.length) return
    const ctx = canvas.getContext('2d')
    const W   = canvas.width
    const H   = canvas.height
    const cW  = W / nCols
    const cH  = H / nRows
    ctx.clearRect(0, 0, W, H)

    grid.forEach(({ spos, bucketW }, ci) => {
      ANGLE_BUCKETS.forEach((bucket, ri) => {
        ctx.fillStyle = wearColorAngle(bucketW[bucket], threshold)
        ctx.fillRect(ci * cW, ri * cH, Math.ceil(cW) + 1, Math.ceil(cH) + 1)
      })
    })

    // Highlight selected spos
    if (selectedSpos !== null) {
      const ci = grid.findIndex(r => r.spos === selectedSpos)
      if (ci >= 0) {
        ctx.strokeStyle = '#1d6fbd'
        ctx.lineWidth   = 2
        ctx.strokeRect(ci * cW + 1, 1, cW - 2, H - 2)
      }
    }
  }, [grid, selectedSpos, nCols, nRows, threshold])

  function getColFromEvent(e) {
    const canvas = canvasRef.current
    if (!canvas || !nCols) return null
    const rect   = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const ci     = Math.floor((e.clientX - rect.left) * scaleX / (canvas.width / nCols))
    return grid[ci] ?? null
  }

  function getRowFromEvent(e) {
    const canvas = canvasRef.current
    if (!canvas || !nRows) return null
    const rect   = canvas.getBoundingClientRect()
    const scaleY = canvas.height / rect.height
    const ri     = Math.floor((e.clientY - rect.top) * scaleY / (canvas.height / nRows))
    return ANGLE_BUCKETS[ri] ?? null
  }

  function handleClick(e) {
    const col = getColFromEvent(e)
    if (col) onSposClick(col.spos)
  }

  function handleMouseMove(e) {
    const col   = getColFromEvent(e)
    const angle = getRowFromEvent(e)
    if (!col) { setTooltip(null); return }
    const w = col.bucketW?.[angle]
    setTooltip({ spos: col.spos, angle, w: w !== null && w !== undefined ? w.toFixed(3) : 'no data', x: e.clientX, y: e.clientY })
  }

  if (!nCols) return (
    <div style={{ padding:'2rem', textAlign:'center', color:'#94a3b8', fontSize:'13px' }}>
      No valid wear data to display
    </div>
  )

  // Compute abs max for legend
  let maxAbsW = 0
  grid.forEach(({ bucketW }) => {
    Object.values(bucketW).forEach(v => { if (v !== null && Math.abs(v) > maxAbsW) maxAbsW = Math.abs(v) })
  })

  return (
    <div>
      <div style={{ display:'flex', gap:'8px', alignItems:'stretch' }}>
        {/* Y axis labels */}
        <div style={{ display:'flex', flexDirection:'column', justifyContent:'space-between', width:'44px', flexShrink:0, paddingRight:'4px' }}>
          {ANGLE_BUCKETS.filter((_, i) => i % 6 === 0).map(a => (
            <span key={a} style={{ fontSize:'9px', color:'#94a3b8', textAlign:'right' }}>{a}°</span>
          ))}
        </div>

        {/* Canvas */}
        <div style={{ flex:1, position:'relative' }}>
          <canvas
            ref={canvasRef}
            width={Math.max(nCols * 12, 600)} height={370}
            style={{ width:'100%', height:'370px', borderRadius:'8px', border:'1px solid #e2e8f0', cursor:'crosshair', display:'block' }}
            onClick={handleClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setTooltip(null)}
          />
          {tooltip && (
            <div style={{ position:'fixed', left:tooltip.x+12, top:tooltip.y-30, background:'#1e293b', color:'#f1f5f9', padding:'5px 10px', borderRadius:'6px', fontSize:'11px', pointerEvents:'none', zIndex:9999, whiteSpace:'nowrap' }}>
              spos={tooltip.spos}mm · {tooltip.angle}° · W={tooltip.w}mm
            </div>
          )}
        </div>

        {/* Colour legend */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', width:'52px', gap:'2px', flexShrink:0 }}>
          <span style={{ fontSize:'9px', color:'#dc2626', fontWeight:'700' }}>Wear</span>
          <div style={{ flex:1, width:'14px', borderRadius:'4px', background:'linear-gradient(to bottom, rgb(255,40,40), rgb(255,220,220), #e2e8f0, rgb(220,220,255), rgb(40,40,255))', border:'1px solid #e2e8f0' }} />
          <span style={{ fontSize:'9px', color:'#1d4ed8', fontWeight:'700' }}>Build</span>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'1px', marginTop:'2px' }}>
            <span style={{ fontSize:'8px', color:'#dc2626' }}>+{fmt2(threshold)}</span>
            <span style={{ fontSize:'8px', color:'#94a3b8' }}>0</span>
            <span style={{ fontSize:'8px', color:'#1d4ed8' }}>-30</span>
          </div>
          <span style={{ fontSize:'8px', color:'#94a3b8', marginTop:'2px' }}>mm</span>
        </div>
      </div>

      {/* X axis */}
      <div style={{ paddingLeft:'52px', paddingRight:'60px', marginTop:'4px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'9px', color:'#94a3b8' }}>
          {grid.filter((_, i) => i === 0 || i === Math.floor(grid.length/2) || i === grid.length-1).map(r => (
            <span key={r.spos}>{r.spos}mm</span>
          ))}
        </div>
        <div style={{ textAlign:'center', fontSize:'10px', color:'#94a3b8', marginTop:'2px' }}>
          ← Axial position along roller (spos mm) →
        </div>
      </div>

      <div style={{ fontSize:'11px', color:'#1d4ed8', marginTop:'6px', paddingLeft:'52px', display:'flex', gap:'16px', flexWrap:'wrap' }}>
        <span>💡 Click column to update polar plot</span>
        {stepSize && <span style={{ color:'#94a3b8' }}>Step: {stepSize}mm</span>}
        <span style={{ color:'#94a3b8' }}>{nCols} spos positions</span>
      </div>
    </div>
  )
}

// ── Wear Band Chart ───────────────────────────────────────────
// X = spos, Y = W value
// Shows min/avg/max across all angle buckets per spos
function WearBandChart({ bestRecords, threshold, rollName, liveMode, lastDt }) {
  const grid = useMemo(() => buildHeatmapGrid(bestRecords), [bestRecords])

  if (!grid || !grid.length) return null

  const labels  = grid.map(r => `${r.spos}mm`)

  const minW    = grid.map(r => {
    const vals = Object.values(r.bucketW).filter(v => v !== null)
    return vals.length ? parseFloat(Math.min(...vals).toFixed(3)) : null
  })
  const maxW    = grid.map(r => {
    const vals = Object.values(r.bucketW).filter(v => v !== null)
    return vals.length ? parseFloat(Math.max(...vals).toFixed(3)) : null
  })
  const avgWArr = grid.map(r => {
    const vals = Object.values(r.bucketW).filter(v => v !== null)
    if (!vals.length) return null
    return parseFloat((vals.reduce((s,v)=>s+v,0)/vals.length).toFixed(3))
  })

  const data = {
    labels,
    datasets: [
      {
        label: 'Max W — highest wear (mm)',
        data:  maxW,
        borderColor:     'rgba(239,68,68,0.9)',
        backgroundColor: 'rgba(239,68,68,0.08)',
        borderWidth: 1.5, pointRadius: 2,
        fill: '-1', tension: 0.3, order: 2,
      },
      {
        label: 'Avg W (mm)',
        data:  avgWArr,
        borderColor:     '#1d6fbd',
        backgroundColor: 'rgba(29,111,189,0.1)',
        borderWidth: 2.5, pointRadius: 3,
        fill: false, tension: 0.3, order: 0,
      },
      {
        label: 'Min W — buildup (mm)',
        data:  minW,
        borderColor:     'rgba(59,130,246,0.9)',
        backgroundColor: 'rgba(59,130,246,0.08)',
        borderWidth: 1.5, pointRadius: 2,
        fill: '+1', tension: 0.3, order: 1,
      },
      {
        label: `Threshold (${threshold}mm)`,
        data:  labels.map(() => threshold),
        borderColor: '#ef4444', backgroundColor: 'transparent',
        borderWidth: 1.5, pointRadius: 0, fill: false, borderDash: [4,3], order: 3,
      },
    ],
  }

  const opts = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: {
      legend: { display: true, labels: { color:'#64748b', font:{ size:11 }, boxWidth:12 } },
      tooltip: {
        backgroundColor:'#1e293b', titleColor:'#f1f5f9', bodyColor:'#94a3b8',
        borderColor:'#334155', borderWidth:1,
        callbacks: {
          title: items => `spos: ${labels[items[0].dataIndex]}`,
          label: item  => ` ${item.dataset.label}: ${Number(item.raw).toFixed(3)}mm`,
        }
      },
    },
    scales: {
      x: { ticks:{ color:'#94a3b8', font:{size:10}, maxRotation:45 }, grid:{ color:'#f1f5f9' },
           title:{ display:true, text:'Axial position (spos mm)', color:'#94a3b8', font:{size:11} } },
      y: { ticks:{ color:'#94a3b8', font:{size:10} }, grid:{ color:'#f1f5f9' },
           title:{ display:true, text:'W value (mm)', color:'#94a3b8', font:{size:11} } },
    },
  }

  return (
    <div style={{ marginTop:'20px', padding:'16px', background:'#f8fafc', borderRadius:'12px', border:'1px solid #e2e8f0' }}>
      <div style={{ fontSize:'13px', fontWeight:'700', color:'#1e293b', marginBottom:'4px' }}>
        Wear Profile — {rollName}{liveMode ? ' · Live' : ''}
      </div>
      <div style={{ fontSize:'11px', color:'#94a3b8', marginBottom:'12px' }}>
        X = axial position (spos mm) · Y = W value ·
        <span style={{ color:'#dc2626' }}> Red = max wear</span> ·
        <span style={{ color:'#1d6fbd' }}> Dark blue = avg</span> ·
        <span style={{ color:'#3b82f6' }}> Blue = min (buildup)</span>
      </div>
      <div style={{ height:'260px' }}>
        <Line data={data} options={opts} />
      </div>
      <LastReceived dt={lastDt} />
    </div>
  )
}

// ── Wear Difference chart ─────────────────────────────────────
function WearDiffChart({ rollid, sysid, threshold, rollName }) {
  const [testFrom,    setTestFrom]    = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0,10)
  })
  const [testTo,      setTestTo]      = useState(() => new Date().toISOString().slice(0,10))
  const [testRecords, setTestRecords] = useState([])
  const [testLoading, setTestLoading] = useState(false)
  const [testError,   setTestError]   = useState(null)

  const [refFrom,    setRefFrom]    = useState('')
  const [refTo,      setRefTo]      = useState('')
  const [refRecords, setRefRecords] = useState([])
  const [refLoading, setRefLoading] = useState(false)
  const [refError,   setRefError]   = useState(null)

  const GET_BASE = 'https://yf8rql6c0c.execute-api.ap-south-1.amazonaws.com/dashboard'

  async function fetchRange(fromDate, toDate) {
    const from  = new Date(fromDate + 'T00:00:00.000Z').toISOString()
    const to    = new Date(toDate   + 'T23:59:59.999Z').toISOString()
    const token = localStorage.getItem('rollmonitor_session_token')
    const res   = await axios.get(GET_BASE, {
      params:  { sysid, rollid, table: 'RollWearDataTable', from, to },
      headers: token ? { 'X-Session-Token': token } : {},
    })
    return toArray(res.data).filter(r => r.sysid && r.sysid !== 'unknown')
  }

  async function loadTest() {
    if (!testFrom || !testTo) return
    setTestLoading(true); setTestError(null)
    try {
      const data = await fetchRange(testFrom, testTo)
      setTestRecords(data)
      if (!data.length) setTestError('No records found in test date range')
    } catch { setTestError('Failed to load test data') }
    setTestLoading(false)
  }

  async function loadRef() {
    if (!refFrom || !refTo) return
    setRefLoading(true); setRefError(null)
    try {
      const data = await fetchRange(refFrom, refTo)
      setRefRecords(data)
      if (!data.length) setRefError('No records found in reference date range')
    } catch { setRefError('Failed to load reference data') }
    setRefLoading(false)
  }

  const diffPoints = useMemo(() => {
    if (!testRecords.length || !refRecords.length) return []
    const testBySpos = groupBySpos(testRecords)
    const refBySpos  = groupBySpos(refRecords)
    const matchingSpos = Object.keys(testBySpos).map(Number)
      .filter(s => refBySpos[Math.round(s * 10) / 10])
      .sort((a, b) => a - b)
    return matchingSpos.map(spos => {
      const key      = Math.round(spos * 10) / 10
      const testRecs = testBySpos[key]
      const refRecs  = refBySpos[key]
      if (!testRecs?.length || !refRecs?.length) return null
      const avgWTest = avgWatSpos(testRecs)
      const avgWRef  = avgWatSpos(refRecs)
      const len      = Math.min(avgWTest.length, avgWRef.length)
      if (!len) return null
      const diffArr  = Array.from({ length: len }, (_, i) => avgWTest[i] - avgWRef[i])
      return { spos, avgDiff: avg(diffArr) }
    }).filter(Boolean)
  }, [testRecords, refRecords])

  const diffLabels = diffPoints.map(p => `${p.spos}mm`)
  const diffY      = diffPoints.map(p => parseFloat(p.avgDiff.toFixed(3)))

  const chartData = {
    labels: diffLabels,
    datasets: [
      {
        label: 'Wear diff: avg(W_test) − avg(W_ref) (mm)',
        data:  diffY,
        borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)',
        borderWidth: 2, pointRadius: 3, fill: true, tension: 0.3,
      },
      {
        label: `Threshold (${threshold}mm)`,
        data:  diffLabels.map(() => threshold),
        borderColor: '#ef4444', backgroundColor: 'transparent',
        borderWidth: 1.5, pointRadius: 0, fill: false, borderDash: [4, 3],
      },
    ],
  }

  const opts = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: {
      legend: { display: true, labels: { color: '#64748b', font: { size: 11 }, boxWidth: 12 } },
      tooltip: {
        backgroundColor: '#1e293b', titleColor: '#f1f5f9',
        bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1,
        callbacks: {
          title: items => `spos: ${diffLabels[items[0].dataIndex]}`,
          label: item  => ` ${item.dataset.label}: ${Number(item.raw).toFixed(3)}mm`,
        }
      },
    },
    scales: {
      x: { ticks: { color: '#94a3b8', font: { size: 10 }, maxRotation: 45 }, grid: { color: '#f1f5f9' },
           title: { display: true, text: 'Axial position (spos mm)', color: '#94a3b8', font: { size: 11 } } },
      y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#f1f5f9' },
           title: { display: true, text: 'Wear difference (mm)', color: '#94a3b8', font: { size: 11 } } },
    },
  }

  const dateInput = (value, onChange) => (
    <input type="date" value={value} onChange={e => onChange(e.target.value)}
      style={{ padding: '8px 12px', fontSize: '13px', border: '1.5px solid #e2e8f0',
        borderRadius: '8px', background: '#fff', color: '#1e293b', outline: 'none', fontFamily: 'inherit' }} />
  )

  return (
    <div className="card">
      <SectionHead title={`Wear Difference — ${rollName}`} />
      <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px', lineHeight: '1.6' }}>
        <strong>Wear Diff = avg(W_test[i]) − avg(W_ref[i])</strong> per spos.
        Load test and reference data independently. Negative = wear has increased.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        {/* Test */}
        <div style={{ padding: '14px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>Test date range</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '11px', color: '#64748b', width: '36px' }}>From</span>{dateInput(testFrom, setTestFrom)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '11px', color: '#64748b', width: '36px' }}>To</span>{dateInput(testTo, setTestTo)}</div>
            <button className="btn-primary" style={{ fontSize: '12px', padding: '8px 14px', marginTop: '4px' }} onClick={loadTest} disabled={testLoading}>
              {testLoading ? <Spinner size="sm" /> : '↻ Load Test Data'}
            </button>
            {testRecords.length > 0 && <div style={{ fontSize: '11px', color: '#1e40af', fontWeight: '600' }}>✓ {testRecords.length} records · {Object.keys(groupBySpos(testRecords)).length} spos</div>}
            {testError && <div style={{ fontSize: '11px', color: '#dc2626' }}>{testError}</div>}
          </div>
        </div>

        {/* Reference */}
        <div style={{ padding: '14px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#166534', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>Reference date range</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '11px', color: '#64748b', width: '36px' }}>From</span>{dateInput(refFrom, setRefFrom)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ fontSize: '11px', color: '#64748b', width: '36px' }}>To</span>{dateInput(refTo, setRefTo)}</div>
            <button className="btn-success" style={{ fontSize: '12px', padding: '8px 14px', marginTop: '4px' }} onClick={loadRef} disabled={refLoading}>
              {refLoading ? <Spinner size="sm" /> : '↻ Load Reference Data'}
            </button>
            {refRecords.length > 0 && <div style={{ fontSize: '11px', color: '#166534', fontWeight: '600' }}>✓ {refRecords.length} records · {Object.keys(groupBySpos(refRecords)).length} spos</div>}
            {refError && <div style={{ fontSize: '11px', color: '#dc2626' }}>{refError}</div>}
          </div>
        </div>
      </div>

      {diffPoints.length > 0 ? (
        <>
          <div style={{ height: '280px' }}><Line data={chartData} options={opts} /></div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
            {diffPoints.length} matching spos · Max wear diff: {fmt2(Math.min(...diffY))}mm
          </div>
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '2.5rem', background: '#f8fafc', borderRadius: '10px', fontSize: '13px', color: '#94a3b8' }}>
          {!testRecords.length && !refRecords.length ? 'Load both test and reference data to show wear difference.'
            : !testRecords.length ? 'Load test data above.'
            : !refRecords.length ? 'Load reference data above.'
            : 'No matching spos positions.'}
        </div>
      )}
    </div>
  )
}

// ── Polar Plot ────────────────────────────────────────────────
// radius - W[i] because:
//   W > 0 (wear)    → surface moved away from centre → drawn INSIDE baseline
//   W < 0 (buildup) → material added to surface     → drawn OUTSIDE baseline
function PolarPlot({ bestRecords, selectedSpos, radius, rollName, threshold }) {
  const canvasRef = useRef(null)

  const row = useMemo(() => {
    if (!bestRecords || !bestRecords.length) return null
    if (selectedSpos !== null) {
      return bestRecords.find(r => r.spos === selectedSpos) ?? bestRecords[0]
    }
    return bestRecords[0]
  }, [bestRecords, selectedSpos])

  const safeR   = (radius && radius > 0) ? radius : 300
  const thresh  = Math.abs(threshold) || 20
  const BUCKETS = Array.from({ length: 37 }, (_, i) => i * 10)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!row || !row.rec) {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '13px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('No data — click a column on the heatmap', canvas.width/2, canvas.height/2)
      return
    }

    try {
      const W    = parseWearArr(row.rec.wear_data)
      const nPts = W.length
      if (!nPts) return

      const CW   = canvas.width
      const CH   = canvas.height
      const cx   = CW / 2
      const cy   = CH / 2
      const scale = Math.min(cx, cy) * 0.72 / safeR

      // Build angle → W mapping (last point in bucket wins)
      const bucketW = {}
      BUCKETS.forEach(b => { bucketW[b] = 0 })
      for (let i = 0; i < nPts; i++) {
        const theta  = (i / nPts) * 360
        const bucket = Math.round(theta / 10) * 10
        const snap   = bucket >= 360 ? 0 : bucket
        bucketW[snap] = W[i]
      }

      // Helper: get canvas point for angle + radius
      const pt = (angleDeg, r) => {
        const rad = (angleDeg - 90) * Math.PI / 180 // 0° at top
        return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
      }

      // Draw reference circles (25%, 50%, 75%, 100% of radius)
      ;[0.25, 0.5, 0.75, 1.0].forEach(f => {
        ctx.beginPath()
        ctx.arc(cx, cy, safeR * scale * f, 0, 2 * Math.PI)
        ctx.strokeStyle = f === 1.0 ? '#94a3b8' : '#e2e8f0'
        ctx.lineWidth   = f === 1.0 ? 1.5 : 0.5
        ctx.setLineDash(f === 1.0 ? [6, 4] : [2, 3])
        ctx.stroke()
        ctx.setLineDash([])
      })

      // Draw angle spokes every 30°
      for (let a = 0; a < 360; a += 30) {
        const [x1, y1] = pt(a, safeR * scale * 0.25)
        const [x2, y2] = pt(a, safeR * scale * 1.0)
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.strokeStyle = '#f1f5f9'
        ctx.lineWidth   = 0.5
        ctx.stroke()
      }

      // Draw wear profile (red filled, INSIDE baseline for W>0)
      ctx.beginPath()
      let first = true
      BUCKETS.forEach(angle => {
        const w = bucketW[angle] ?? 0
        const r = Math.max(safeR * scale * 0.1, (safeR - w) * scale) // radius - W
        const [x, y] = pt(angle, r)
        if (first) { ctx.moveTo(x, y); first = false }
        else ctx.lineTo(x, y)
      })
      ctx.closePath()
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth   = 1.5
      ctx.stroke()
      ctx.fillStyle   = 'rgba(59,130,246,0.06)'
      ctx.fill()

      // Shade wear zones (W>0) in red — inside baseline
      BUCKETS.forEach((angle, idx) => {
        const w = bucketW[angle] ?? 0
        if (w <= 0) return
        const nextAngle = BUCKETS[(idx + 1) % BUCKETS.length]
        const rWorn = Math.max(0, (safeR - w) * scale)
        const rBase = safeR * scale
        const intensity = Math.min(1, w / thresh)
        const alpha = 0.15 + intensity * 0.55

        ctx.beginPath()
        const [x1, y1] = pt(angle, rWorn)
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, rBase, (angle - 90) * Math.PI / 180, (nextAngle - 90) * Math.PI / 180)
        ctx.arc(cx, cy, rWorn, (nextAngle - 90) * Math.PI / 180, (angle - 90) * Math.PI / 180, true)
        ctx.closePath()
        ctx.fillStyle = `rgba(239,68,68,${alpha})`
        ctx.fill()
      })

      // Shade buildup zones (W<0) in blue — outside baseline
      BUCKETS.forEach((angle, idx) => {
        const w = bucketW[angle] ?? 0
        if (w >= 0) return
        const nextAngle = BUCKETS[(idx + 1) % BUCKETS.length]
        const rBuildup = Math.max(0, (safeR - w) * scale) // safeR - negative = larger
        const rBase    = safeR * scale
        const intensity = Math.min(1, -w / 30)
        const alpha = 0.15 + intensity * 0.55

        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, rBuildup, (angle - 90) * Math.PI / 180, (nextAngle - 90) * Math.PI / 180)
        ctx.arc(cx, cy, rBase, (nextAngle - 90) * Math.PI / 180, (angle - 90) * Math.PI / 180, true)
        ctx.closePath()
        ctx.fillStyle = `rgba(59,130,246,${alpha})`
        ctx.fill()
      })

      // Redraw baseline on top (clean grey circle)
      ctx.beginPath()
      ctx.arc(cx, cy, safeR * scale, 0, 2 * Math.PI)
      ctx.strokeStyle = '#94a3b8'
      ctx.lineWidth   = 1.5
      ctx.setLineDash([6, 4])
      ctx.stroke()
      ctx.setLineDash([])

      // Centre dot
      ctx.beginPath()
      ctx.arc(cx, cy, 3, 0, 2 * Math.PI)
      ctx.fillStyle = '#1e293b'
      ctx.fill()

      // Angle labels
      ctx.font      = '10px monospace'
      ctx.fillStyle = '#64748b'
      ctx.textAlign = 'center'
      const labelR  = safeR * scale + 16
      ;[[0,'0°'],[90,'90°'],[180,'180°'],[270,'270°']].forEach(([deg, lbl]) => {
        const [x, y] = pt(deg, labelR)
        ctx.fillText(lbl, x, y + 4)
      })

      // Radius label
      ctx.fillStyle = '#94a3b8'
      ctx.font      = '9px monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`r=${safeR}mm`, cx + 4, cy - safeR * scale - 4)

    } catch(e) { console.error('PolarPlot error:', e) }
  }, [row, safeR, thresh])

  return (
    <div style={{ marginTop:'20px', padding:'16px', background:'#f8fafc', borderRadius:'12px', border:'1px solid #bfdbfe' }}>
      <div style={{ fontSize:'13px', fontWeight:'700', color:'#1e293b', marginBottom:'4px' }}>
        Polar Cross-Section — {rollName}{row ? ` · spos=${row.spos}mm` : ''}
      </div>
      <div style={{ fontSize:'11px', color:'#94a3b8', marginBottom:'10px', lineHeight:'1.6' }}>
        Grey dashed = baseline (r={safeR}mm) ·
        <span style={{ color:'#dc2626' }}> Red = wear (W&gt;0, inside baseline)</span> ·
        <span style={{ color:'#3b82f6' }}> Blue = buildup (W&lt;0, outside baseline)</span>
      </div>
      <div style={{ display:'flex', justifyContent:'center' }}>
        <canvas ref={canvasRef} width={420} height={420}
          style={{ maxWidth:'100%', borderRadius:'8px', border:'1px solid #e2e8f0', background:'#fff' }} />
      </div>
      <div style={{ display:'flex', justifyContent:'center', gap:'20px', marginTop:'8px', fontSize:'11px' }}>
        <span style={{ color:'#94a3b8' }}>── Baseline</span>
        <span style={{ color:'#dc2626' }}>■ Wear (inside)</span>
        <span style={{ color:'#3b82f6' }}>■ Buildup (outside)</span>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function WearResults() {
  const [sysid,    setSysId]    = useSysId()
  const { names }               = useRollNames()
  const [rollid,   setRollid]   = useState(1)
  const [from,     setFrom]     = useState(subDays(new Date(), 7))
  const [to,       setTo]       = useState(new Date())
  const [liveMode, setLiveMode] = useState(false)
  const [selectedSpos, setSelectedSpos] = useState(null)

  const settings     = loadSettings()
  const threshold    = rollid === 1 ? (settings.thresholdR1 || settings.threshold || -50)
                                    : (settings.thresholdR2 || settings.threshold || -50)
  const rollerLength = rollid === 1 ? (settings.rollerLengthR1 || 1000)
                                    : (settings.rollerLengthR2 || 1000)
  const rollName     = names['r' + rollid]

  // In live mode: fetch last 4 hours — use ref to avoid recalculation causing flicker
  const liveFromRef = useRef(null)
  useEffect(() => {
    if (liveMode) {
      const d = new Date()
      d.setHours(d.getHours() - 4)
      liveFromRef.current = d.toISOString()
    }
  }, [liveMode])

  // Stable date strings — only recompute when liveMode/from/to actually changes
  const fromStr = useMemo(() => from?.toISOString(), [from])
  const toStr   = useMemo(() => to?.toISOString(),   [to])

  const { data: rawData, loading, error, refresh } = useApi(
    fetchWearData,
    liveMode
      ? [sysid, rollid, liveFromRef.current ?? fromStr, null]
      : [sysid, rollid, fromStr, toStr],
    { pollMs: liveMode ? 120000 : null }
  )

  // Fetch StatusTable to get RPM and radius from latest conf=1 record
  const { data: dashRaw } = useApi(fetchDashboard, [sysid], { pollMs: 60000 })
  const confRecord = useMemo(() => {
    const statusList = toArray(dashRaw?.status || dashRaw).filter(r => r.conf == 1)
    return statusList[0] ?? null
  }, [dashRaw])

  // Read config: MeasConfig localStorage (from Roller Configuration page) takes priority
  // Falls back to StatusTable conf=1, then defaults
  const measConfig = useMemo(() => loadMeasConfig(sysid), [sysid])
  const radius = safeFloat(rollid === 1
    ? (measConfig?.r1_rad ?? confRecord?.r1_rad)
    : (measConfig?.r2_rad ?? confRecord?.r2_rad)) || 900
  const rpm    = safeFloat(rollid === 1
    ? (measConfig?.r1_rpm ?? confRecord?.r1_rpm)
    : (measConfig?.r2_rpm ?? confRecord?.r2_rpm)) || 20
  const stepSize = safeFloat(rollid === 1
    ? (measConfig?.r1_step ?? confRecord?.r1_step)
    : (measConfig?.r2_step ?? confRecord?.r2_step)) || 1.5
  const circumference = calcCircumference(radius)

  const records = (toArray(rawData) || []).filter(r => r?.sysid && r.sysid !== 'unknown')
  const lastDt  = records.length ? records[0]?.datetime : null

  useEffect(() => { setSelectedSpos(null) }, [sysid, rollid])

  // Select best record per spos (filter bad records, take latest valid)
  const bestRecords = useMemo(() => selectBestRecords(records), [records])

  // Auto-select first spos if none selected
  useEffect(() => {
    if (bestRecords.length > 0 && selectedSpos === null) {
      setSelectedSpos(bestRecords[0].spos)
    }
  }, [bestRecords])

  // Summary stats from bestRecords
  const maxWear = useMemo(() => {
    if (!bestRecords.length) return null
    const allW = []
    bestRecords.forEach(({ rec }) => {
      const W = parseWearArr(rec.wear_data)
      allW.push(...W.filter(v => !isNaN(v)))
    })
    return allW.length ? Math.max(...allW) : null
  }, [bestRecords])

  // Latest spos = spos from the most recently received record by datetime
  const latestSpos = useMemo(() => {
    if (!records.length) return null
    const sorted = [...records].sort((a, b) => {
      const da = parseDt(a.datetime), db = parseDt(b.datetime)
      if (!da || !db) return 0
      return db - da
    })
    return safeFloat(sorted[0]?.spos)
  }, [records])

  const warnLevel  = threshold * 0.9
  const alarmColor = maxWear === null ? '#94a3b8'
    : maxWear >= threshold  ? '#ef4444'
    : maxWear >= warnLevel  ? '#f59e0b' : '#22c55e'
  const alarmLabel = maxWear === null ? '—'
    : maxWear >= threshold  ? '🔴 CRITICAL'
    : maxWear >= warnLevel  ? '🟡 WARNING' : '🟢 Normal'

  return (
    <div style={{ maxWidth: '1100px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Section 1: Filters ── */}
      <div className="card">
        <SectionHead title="Filters" action={
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setLiveMode(l => !l)}
              className={liveMode ? 'btn-danger' : 'btn-success'}
              style={{ fontSize: '12px', padding: '7px 14px' }}>
              {liveMode ? '⏹ Stop Live' : '▶ Go Live'}
            </button>
            <button className="btn-primary" style={{ fontSize: '12px', padding: '7px 14px' }} onClick={refresh}>
              {loading ? <Spinner size="sm" /> : '↻ Refresh'}
            </button>
          </div>
        } />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '20px' }}>
          {/* PLC ID */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>PLC ID</div>
            <SysIdSelector value={sysid} onChange={setSysId} />
          </div>
          {/* Roll */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Roll</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[1, 2].map(r => (
                <button key={r} onClick={() => setRollid(r)}
                  className={rollid === r ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '8px 16px', fontSize: '13px' }}>
                  {names['r' + r]}
                </button>
              ))}
            </div>
          </div>
          {!liveMode
            ? <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
            : <div style={{ padding: '8px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '12px', color: '#166534', fontWeight: '600' }}>
                🟢 Live — polling every 2 minutes
              </div>
          }
        </div>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '10px' }}>
          Roller length: <strong>{rollerLength}mm</strong> · Threshold: <strong>{threshold}mm</strong> · Change in Analytics → Settings
        </div>
      </div>

      {error && <ErrorBanner message="No Internet Connection — cannot reach server" />}
      {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Spinner size="lg" /></div>}

      {!loading && records.length === 0 && (
        <EmptyState icon="📊" title="No wear data"
          message={`No RollWearData records for ${rollName} in the selected date range.`} />
      )}

      {!loading && records.length > 0 && bestRecords.length === 0 && (
        <EmptyState icon="⚠️" title="All records filtered out"
          message="All records for this range contain invalid data (W > 100mm). Try a different date range." />
      )}

      {!loading && bestRecords.length > 0 && (
        <>
          {/* ── Section 2: Summary cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '14px' }}>
            <StatCard label="Latest spos"   value={latestSpos !== null ? fmt2(latestSpos) : '—'} unit="mm"  color="#3b82f6" sub="Most recently received spos" />
            <StatCard label="Max wear (highest W)"      value={maxWear !== null ? fmt2(maxWear) : '—'}        unit="mm"  color={alarmColor} sub="Min avg(W) across all spos" />
            <StatCard label="Threshold set" value={threshold}                                     unit="mm"  color="#ef4444" sub={`Warning at ${fmt2(threshold * 0.9)}mm`} />
            <StatCard label="Wear status"   value={alarmLabel}                                    color={alarmColor} sub={`${records.length} records · ${bestRecords.length} spos positions`} />
          </div>

          {/* Physics parameters info strip */}
          <div style={{ padding: '10px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '12px', color: '#64748b', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <span>📐 Radius: <strong style={{ fontFamily: 'monospace', color: '#1e293b' }}>{radius}mm</strong> {!confRecord && !measConfig && <span style={{ color: '#f59e0b' }}>(default — apply config first)</span>}</span>
            <span>📏 Step: <strong style={{ fontFamily: 'monospace', color: '#1e293b' }}>{stepSize}mm</strong></span>
            <span>📊 Valid records: <strong style={{ fontFamily: 'monospace', color: '#1e293b' }}>{bestRecords.length}</strong> spos positions</span>
            <span>🚫 Filtered: <strong style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{records.length - bestRecords.length}</strong> bad records</span>
          </div>

          {/* ── Section 3: Roller Surface Map + Line chart ── */}
          <div className="card">
            <SectionHead title={`Roller Surface Map — ${rollName}${liveMode ? ' · Live' : ''}`} />
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '14px', lineHeight: '1.6' }}>
              2D unrolled roller surface. X = circumferential index i (full rotation) · Y = axial spos (mm).
              <span style={{ color: '#dc2626', fontWeight: '600' }}> Red = wear (W&gt;0, surface moved away)</span> ·
              <span style={{ color: '#1d4ed8', fontWeight: '600' }}> Blue = buildup (W&lt;0)</span> ·
              White = at calibration. Scale is dynamic.
            </div>

            <RollerHeatmap
              bestRecords={bestRecords}
              onSposClick={setSelectedSpos}
              selectedSpos={selectedSpos}
              threshold={threshold}
              stepSize={stepSize}
            />

            {/* Polar Plot */}
            <PolarPlot
              bestRecords={bestRecords}
              selectedSpos={selectedSpos}
              radius={radius}
              threshold={threshold}
              rollName={rollName}
            />

            {/* Wear band chart — min/avg/max across circumference per spos */}
            <WearBandChart
              bestRecords={bestRecords}
              threshold={threshold}
              rollName={rollName}
              liveMode={liveMode}
              lastDt={lastDt}
            />

            <LastReceived dt={lastDt} />
          </div>

          {/* ── Section 4: Wear Difference ── */}
          <WearDiffChart
            rollid={rollid}
            sysid={sysid}
            threshold={threshold}
            rollName={rollName}
          />
        </>
      )}
    </div>
  )
}
