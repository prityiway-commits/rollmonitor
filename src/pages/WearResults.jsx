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
import { fetchWearData, toArray } from '../services/api'
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

function loadSettings() {
  try {
    const s = localStorage.getItem('rollmonitor_analytics_settings')
    return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : { ...DEFAULT_SETTINGS }
  } catch { return { ...DEFAULT_SETTINGS } }
}

// Group records by spos rounded to 1 decimal
function groupBySpos(records) {
  const map = {}
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
function avgWatSpos(recs) {
  if (!recs?.length) return []
  const allW = recs.map(r => computeW(r))
  const len  = Math.max(...allW.map(w => w.length))
  if (!len) return []
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
function RollerHeatmap({ sposSorted, onSposClick, selectedSpos }) {
  const canvasRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)

  // Global abs max for colour scale
  const absMax = useMemo(() => {
    let mx = 0
    sposSorted.forEach(({ avgW }) => avgW.forEach(v => { if (Math.abs(v) > mx) mx = Math.abs(v) }))
    return mx || 1
  }, [sposSorted])

  const nPts  = sposSorted[0]?.avgW?.length || 0
  const nRows = sposSorted.length

  // Draw heatmap
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !nPts || !nRows) return
    const ctx = canvas.getContext('2d')
    const W   = canvas.width
    const H   = canvas.height
    const cW  = W / nPts
    const cH  = H / nRows
    ctx.clearRect(0, 0, W, H)

    sposSorted.forEach(({ spos, avgW }, rowIdx) => {
      // spos=0 at bottom → invert: highest spos at top
      const y = (nRows - 1 - rowIdx) * cH
      avgW.forEach((w, col) => {
        ctx.fillStyle = wearColor(w, absMax)
        ctx.fillRect(col * cW, y, Math.ceil(cW) + 1, Math.ceil(cH) + 1)
      })
    })

    // Highlight selected row
    if (selectedSpos !== null) {
      const idx = sposSorted.findIndex(r => r.spos === selectedSpos)
      if (idx >= 0) {
        const y = (nRows - 1 - idx) * cH
        ctx.strokeStyle = '#1d6fbd'
        ctx.lineWidth   = 2
        ctx.strokeRect(1, y + 1, W - 2, cH - 2)
      }
    }
  }, [sposSorted, absMax, selectedSpos, nPts, nRows])

  function getRowFromEvent(e) {
    const canvas = canvasRef.current
    if (!canvas || !nRows) return null
    const rect  = canvas.getBoundingClientRect()
    const scaleY = canvas.height / rect.height
    const y      = (e.clientY - rect.top) * scaleY
    const cH     = canvas.height / nRows
    const rowIdx = nRows - 1 - Math.floor(y / cH)
    return sposSorted[rowIdx] ?? null
  }

  function handleClick(e) {
    const row = getRowFromEvent(e)
    if (row) onSposClick(row.spos)
  }

  function handleMouseMove(e) {
    const canvas = canvasRef.current
    if (!canvas || !nPts) return
    const row = getRowFromEvent(e)
    if (!row) { setTooltip(null); return }
    const rect   = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const col    = Math.floor((e.clientX - rect.left) * scaleX / (canvas.width / nPts))
    const wVal   = row.avgW[col]
    setTooltip({ spos: row.spos, i: col + 1, w: wVal?.toFixed(3), x: e.clientX, y: e.clientY })
  }

  if (!nPts || !nRows) return <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>No data to display</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'stretch' }}>
        {/* Y axis */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8', width: '55px', textAlign: 'right', paddingRight: '6px' }}>
          <span>{fmt2(sposSorted[sposSorted.length - 1]?.spos)}mm</span>
          <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: '10px', color: '#94a3b8', alignSelf: 'center' }}>Axial position spos (mm)</span>
          <span>{fmt2(sposSorted[0]?.spos)}mm</span>
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, position: 'relative' }}>
          <canvas
            ref={canvasRef}
            width={1500} height={400}
            style={{ width: '100%', height: '400px', borderRadius: '8px', border: '1px solid #e2e8f0', cursor: 'crosshair', display: 'block' }}
            onClick={handleClick}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setTooltip(null)}
          />
          {tooltip && (
            <div style={{ position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 30, background: '#1e293b', color: '#f1f5f9', padding: '5px 10px', borderRadius: '6px', fontSize: '11px', pointerEvents: 'none', zIndex: 9999, whiteSpace: 'nowrap' }}>
              spos: {tooltip.spos}mm · i={tooltip.i} · W={tooltip.w}mm
            </div>
          )}
        </div>

        {/* Colour bar */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '44px', gap: '4px' }}>
          <span style={{ fontSize: '10px', color: '#1d4ed8', fontWeight: '700' }}>+{fmt2(absMax)}</span>
          <div style={{ flex: 1, width: '16px', borderRadius: '4px', background: 'linear-gradient(to bottom, rgb(100,100,255), white, rgb(255,100,100))', border: '1px solid #e2e8f0' }} />
          <span style={{ fontSize: '10px', color: '#dc2626', fontWeight: '700' }}>−{fmt2(absMax)}</span>
          <span style={{ fontSize: '9px', color: '#94a3b8' }}>mm</span>
        </div>
      </div>

      {/* X axis label */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8', marginTop: '4px', paddingLeft: '67px', paddingRight: '56px' }}>
        <span>i=1</span>
        <span>← Circumferential position (full rotation) →</span>
        <span>i={nPts}</span>
      </div>
      <div style={{ fontSize: '11px', color: '#1d4ed8', marginTop: '8px', paddingLeft: '67px' }}>
        💡 Click any row to highlight and see its circumferential profile below.
      </div>
    </div>
  )
}

// ── Circumferential line chart ────────────────────────────────
function CircumChart({ sposSorted, selectedSpos }) {
  const row = useMemo(() => {
    if (!sposSorted.length) return sposSorted[0] ?? null
    if (selectedSpos !== null) {
      return sposSorted.find(r => r.spos === selectedSpos) ?? sposSorted[0]
    }
    return sposSorted[0]
  }, [sposSorted, selectedSpos])

  if (!row?.avgW?.length) return null

  const W      = row.avgW
  const labels = W.map((_, i) => (i + 1) % 100 === 0 || i === 0 ? String(i + 1) : '')

  const data = {
    labels,
    datasets: [{
      label: `W[i] at spos = ${row.spos}mm`,
      data:  W,
      borderColor:     '#3b82f6',
      backgroundColor: 'rgba(59,130,246,0.15)',
      borderWidth: 1.5,
      pointRadius: 0,
      fill: true,
      tension: 0,
    }, {
      label: 'Zero (calibration baseline)',
      data:  new Array(W.length).fill(0),
      borderColor: '#64748b',
      backgroundColor: 'transparent',
      borderWidth: 1,
      pointRadius: 0,
      fill: false,
      borderDash: [4, 3],
    }],
  }

  const opts = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
    plugins: {
      legend: { display: true, labels: { color: '#64748b', font: { size: 11 }, boxWidth: 12 } },
      tooltip: {
        backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8',
        borderColor: '#334155', borderWidth: 1,
        callbacks: {
          title: items => `i = ${items[0].dataIndex + 1}`,
          label: item  => ` W[i] = ${Number(item.raw).toFixed(3)}mm`,
        }
      },
    },
    scales: {
      x: {
        ticks:  { color: '#94a3b8', font: { size: 9 }, autoSkip: false },
        grid:   { color: '#f1f5f9' },
        title:  { display: true, text: 'Circumferential index i (full rotation)', color: '#94a3b8', font: { size: 11 } },
      },
      y: {
        ticks:  { color: '#94a3b8', font: { size: 10 } },
        grid:   { color: '#f1f5f9' },
        title:  { display: true, text: 'W[i] = S−C (mm)', color: '#94a3b8', font: { size: 11 } },
      },
    },
  }

  return (
    <div style={{ marginTop: '20px', padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #bfdbfe' }}>
      <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginBottom: '4px' }}>
        Circumferential Profile — spos = {row.spos}mm
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '12px' }}>
        {W.length} data points · full rotation · click heatmap row above to change spos
      </div>
      <div style={{ height: '220px' }}>
        <Line data={data} options={opts} />
      </div>
    </div>
  )
}

// ── Wear Difference chart ─────────────────────────────────────
// Independent test + reference date ranges
// Wear Diff = avg(W_test[i]) - avg(W_ref[i]) per spos
function WearDiffChart({ rollid, sysid, threshold, rollName }) {

  // Test date range
  const [testFrom,    setTestFrom]    = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0,10)
  })
  const [testTo,      setTestTo]      = useState(() => new Date().toISOString().slice(0,10))
  const [testRecords, setTestRecords] = useState([])
  const [testLoading, setTestLoading] = useState(false)
  const [testError,   setTestError]   = useState(null)

  // Reference date range
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
    const { default: axios } = await import('axios')
    const res = await axios.get(GET_BASE, {
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

  // Compute diff: avg(W_test) - avg(W_ref) per spos
  const diffPoints = useMemo(() => {
    if (!testRecords.length || !refRecords.length) return []
    const testBySpos = groupBySpos(testRecords)
    const refBySpos  = groupBySpos(refRecords)

    const matchingSpos = Object.keys(testBySpos)
      .map(Number)
      .filter(s => {
        const key = Math.round(s * 10) / 10
        return refBySpos[key]
      })
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
        borderColor:     '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.08)',
        borderWidth: 2, pointRadius: 3, fill: true, tension: 0.3,
      },
      {
        label: `Threshold (${threshold}mm)`,
        data:  diffLabels.map(() => threshold),
        borderColor:     '#ef4444',
        backgroundColor: 'transparent',
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
      x: {
        ticks:  { color: '#94a3b8', font: { size: 10 }, maxRotation: 45 },
        grid:   { color: '#f1f5f9' },
        title:  { display: true, text: 'Axial position (spos mm)', color: '#94a3b8', font: { size: 11 } },
      },
      y: {
        ticks:  { color: '#94a3b8', font: { size: 10 } },
        grid:   { color: '#f1f5f9' },
        title:  { display: true, text: 'Wear difference (mm)', color: '#94a3b8', font: { size: 11 } },
      },
    },
  }

  const dateInput = (label, value, onChange) => (
    <input type="date" value={value} onChange={e => onChange(e.target.value)}
      style={{ padding: '8px 12px', fontSize: '13px', border: '1.5px solid #e2e8f0',
        borderRadius: '8px', background: '#fff', color: '#1e293b',
        outline: 'none', fontFamily: 'inherit' }} />
  )

  return (
    <div className="card">
      <SectionHead title={`Wear Difference — ${rollName}`} />
      <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '16px', lineHeight: '1.6' }}>
        <strong>Wear Diff = avg(W_test[i]) − avg(W_ref[i])</strong> per spos.
        Load test and reference data independently using their own date ranges.
        Negative values = wear has increased since reference.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>

        {/* Test date range */}
        <div style={{ padding: '14px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
            Test date range
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '11px', color: '#64748b', width: '36px' }}>From</div>
              {dateInput('from', testFrom, setTestFrom)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '11px', color: '#64748b', width: '36px' }}>To</div>
              {dateInput('to', testTo, setTestTo)}
            </div>
            <button className="btn-primary" style={{ fontSize: '12px', padding: '8px 14px', marginTop: '4px' }}
              onClick={loadTest} disabled={!testFrom || !testTo || testLoading}>
              {testLoading ? <Spinner size="sm" /> : '↻ Load Test Data'}
            </button>
            {testRecords.length > 0 && (
              <div style={{ fontSize: '11px', color: '#1e40af', fontWeight: '600' }}>
                ✓ {testRecords.length} records · {Object.keys(groupBySpos(testRecords)).length} spos positions
              </div>
            )}
            {testError && <div style={{ fontSize: '11px', color: '#dc2626' }}>{testError}</div>}
          </div>
        </div>

        {/* Reference date range */}
        <div style={{ padding: '14px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#166534', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
            Reference date range
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '11px', color: '#64748b', width: '36px' }}>From</div>
              {dateInput('refFrom', refFrom, setRefFrom)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '11px', color: '#64748b', width: '36px' }}>To</div>
              {dateInput('refTo', refTo, setRefTo)}
            </div>
            <button className="btn-success" style={{ fontSize: '12px', padding: '8px 14px', marginTop: '4px' }}
              onClick={loadRef} disabled={!refFrom || !refTo || refLoading}>
              {refLoading ? <Spinner size="sm" /> : '↻ Load Reference Data'}
            </button>
            {refRecords.length > 0 && (
              <div style={{ fontSize: '11px', color: '#166534', fontWeight: '600' }}>
                ✓ {refRecords.length} records · {Object.keys(groupBySpos(refRecords)).length} spos positions
              </div>
            )}
            {refError && <div style={{ fontSize: '11px', color: '#dc2626' }}>{refError}</div>}
          </div>
        </div>
      </div>

      {/* Chart */}
      {diffPoints.length > 0 ? (
        <>
          <div style={{ height: '280px' }}>
            <Line data={chartData} options={opts} />
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
            {diffPoints.length} matching spos positions ·
            Max wear diff: {fmt2(Math.min(...diffY))}mm ·
            Negative = wear increased since reference
          </div>
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '2.5rem', background: '#f8fafc', borderRadius: '10px', fontSize: '13px', color: '#94a3b8' }}>
          {!testRecords.length && !refRecords.length
            ? 'Load both test and reference data to show wear difference.'
            : !testRecords.length
            ? 'Load test data above.'
            : !refRecords.length
            ? 'Load reference data above.'
            : 'No matching spos positions — try overlapping date ranges with similar measurement conditions.'}
        </div>
      )}
    </div>
  )
}


// ── Wear Band Chart (Option C) ────────────────────────────────
// X = spos (axial), Y = W value (mm)
// Shows min/avg/max across circumference at each spos
function WearBandChart({ sposSorted, threshold, rollName, liveMode, lastDt }) {
  if (!sposSorted.length) return null

  const labels = sposSorted.map(r => `${r.spos}mm`)

  const minW = sposSorted.map(r => parseFloat(Math.min(...r.avgW).toFixed(3)))
  const maxW = sposSorted.map(r => parseFloat(Math.max(...r.avgW).toFixed(3)))
  const avgWArr = sposSorted.map(r => {
    const a = avg(r.avgW)
    return a !== null ? parseFloat(a.toFixed(3)) : null
  })

  const data = {
    labels,
    datasets: [
      {
        label: 'Max W (mm)',
        data:  maxW,
        borderColor:     'rgba(59,130,246,0.8)',
        backgroundColor: 'rgba(59,130,246,0.08)',
        borderWidth: 1.5,
        pointRadius: 2,
        fill: '+1', // fill to avg
        tension: 0.3,
        order: 1,
      },
      {
        label: 'Avg W (mm)',
        data:  avgWArr,
        borderColor:     '#1d6fbd',
        backgroundColor: 'rgba(29,111,189,0.15)',
        borderWidth: 2.5,
        pointRadius: 3,
        fill: false,
        tension: 0.3,
        order: 0,
      },
      {
        label: 'Min W — worst wear (mm)',
        data:  minW,
        borderColor:     'rgba(239,68,68,0.8)',
        backgroundColor: 'rgba(239,68,68,0.08)',
        borderWidth: 1.5,
        pointRadius: 2,
        fill: '-1', // fill to avg
        tension: 0.3,
        order: 2,
      },
      {
        label: `Threshold (${threshold}mm)`,
        data:  labels.map(() => threshold),
        borderColor:     '#ef4444',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        borderDash: [4, 3],
        order: 3,
      },
    ],
  }

  const opts = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: {
      legend: {
        display: true,
        labels: { color: '#64748b', font: { size: 11 }, boxWidth: 12 },
      },
      tooltip: {
        backgroundColor: '#1e293b', titleColor: '#f1f5f9',
        bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1,
        callbacks: {
          title: items => `spos: ${labels[items[0].dataIndex]}`,
          label: item  => ` ${item.dataset.label}: ${Number(item.raw).toFixed(3)}mm`,
        }
      },
    },
    scales: {
      x: {
        ticks:  { color: '#94a3b8', font: { size: 10 }, maxRotation: 45 },
        grid:   { color: '#f1f5f9' },
        title:  { display: true, text: 'Axial position (spos mm)', color: '#94a3b8', font: { size: 11 } },
      },
      y: {
        ticks:  { color: '#94a3b8', font: { size: 10 } },
        grid:   { color: '#f1f5f9' },
        title:  { display: true, text: 'W[i] value (mm)', color: '#94a3b8', font: { size: 11 } },
      },
    },
  }

  return (
    <div style={{ marginTop: '20px', padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginBottom: '4px' }}>
        Wear Band — {rollName}{liveMode ? ' · Live' : ''}
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '12px', lineHeight: '1.6' }}>
        X = axial position (spos mm) · Y = W value across circumference ·
        <span style={{ color: '#1d4ed8', fontWeight: '600' }}> Blue = max W</span> ·
        <span style={{ color: '#1d6fbd', fontWeight: '600' }}> Dark blue = avg W</span> ·
        <span style={{ color: '#dc2626', fontWeight: '600' }}> Red = min W (worst wear)</span> ·
        Shaded area = circumferential spread
      </div>
      <div style={{ height: '260px' }}>
        <Line data={data} options={opts} />
      </div>
      <LastReceived dt={lastDt} />
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

  const { data: rawData, loading, error, refresh } = useApi(
    fetchWearData,
    liveMode
      ? [sysid, rollid, null, null]
      : [sysid, rollid, from?.toISOString(), to?.toISOString()],
    { pollMs: liveMode ? 120000 : null }
  )

  const records = toArray(rawData).filter(r => r.sysid && r.sysid !== 'unknown')
  const lastDt  = records.length ? records[0]?.datetime : null

  useEffect(() => { setSelectedSpos(null) }, [sysid, rollid])

  // Build sorted spos → avgW array (spos ascending)
  const sposSorted = useMemo(() => {
    const byKey = groupBySpos(records)
    return Object.entries(byKey)
      .map(([spos, recs]) => ({
        spos:  parseFloat(spos),
        avgW:  avgWatSpos(recs),
        nRecs: recs.length,
      }))
      .filter(r => r.avgW.length > 0)
      .sort((a, b) => a.spos - b.spos)
  }, [records])

  // Auto-select first spos if none selected
  useEffect(() => {
    if (sposSorted.length > 0 && selectedSpos === null) {
      setSelectedSpos(sposSorted[0].spos)
    }
  }, [sposSorted])

  // Summary stats
  const maxWear    = sposSorted.length
    ? Math.min(...sposSorted.map(r => avg(r.avgW)).filter(v => v !== null))
    : null
  const latestSpos = sposSorted.length
    ? Math.max(...sposSorted.map(r => r.spos))
    : null

  const warnLevel  = threshold * 0.9
  const alarmColor = maxWear === null ? '#94a3b8'
    : maxWear <= threshold  ? '#ef4444'
    : maxWear <= warnLevel  ? '#f59e0b' : '#22c55e'
  const alarmLabel = maxWear === null ? '—'
    : maxWear <= threshold  ? '🔴 CRITICAL'
    : maxWear <= warnLevel  ? '🟡 WARNING' : '🟢 Normal'

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
            {!liveMode && (
              <button className="btn-primary" style={{ fontSize: '12px', padding: '7px 14px' }} onClick={refresh}>
                {loading ? <Spinner size="sm" /> : '↻ Load Data'}
              </button>
            )}
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

      {!loading && records.length > 0 && (
        <>
          {/* ── Section 2: Summary cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '14px' }}>
            <StatCard label="Latest spos"   value={latestSpos !== null ? fmt2(latestSpos) : '—'} unit="mm"  color="#3b82f6" sub="Furthest axial position reached" />
            <StatCard label="Max wear"      value={maxWear !== null ? fmt2(maxWear) : '—'}        unit="mm"  color={alarmColor} sub="Min avg(W) across all spos" />
            <StatCard label="Threshold set" value={threshold}                                     unit="mm"  color="#ef4444" sub={`Warning at ${fmt2(threshold * 0.9)}mm`} />
            <StatCard label="Wear status"   value={alarmLabel}                                    color={alarmColor} sub={`${records.length} records · ${sposSorted.length} spos positions`} />
          </div>

          {/* ── Section 3: Roller Surface Map + Line chart ── */}
          <div className="card">
            <SectionHead title={`Roller Surface Map — ${rollName}${liveMode ? ' · Live' : ''}`} />
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '14px', lineHeight: '1.6' }}>
              2D unrolled roller surface. X = circumferential index i (full rotation) · Y = axial spos (mm).
              <span style={{ color: '#1d4ed8', fontWeight: '600' }}> Blue = above calibration</span> ·
              <span style={{ color: '#dc2626', fontWeight: '600' }}> Red = below calibration (wear)</span> ·
              White = at calibration. Scale is dynamic.
            </div>

            <RollerHeatmap
              sposSorted={sposSorted}
              onSposClick={setSelectedSpos}
              selectedSpos={selectedSpos}
            />

            {/* Wear band chart — min/avg/max across circumference per spos */}
            <WearBandChart
              sposSorted={sposSorted}
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
