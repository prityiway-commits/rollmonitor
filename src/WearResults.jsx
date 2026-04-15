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
import zoomPlugin from 'chartjs-plugin-zoom'
import axios from 'axios'
import { fetchWearData, fetchS3Keys, fetchS3Batch, fetchS3Record, fetchMeasStarted, fetchMeasFinished, fetchStatusHistory, postMeasStart, postMeasStop, toArray } from '../services/api'
import { useApi } from '../hooks/useApi'
import { Spinner, ErrorBanner, SectionHead } from '../components'
import SysIdSelector, { useSysId } from '../components/SysIdSelector'
import { useRollNames } from '../components/RollNameContext'
import { loadSettings } from '../services/analytics'
import Plotly from 'plotly.js-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'
const Plot = createPlotlyComponent(Plotly)

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, zoomPlugin)
// Simple error boundary to catch Plotly/Chart crashes without crashing the whole page
class ChartErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null } }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) { console.error('[ChartErrorBoundary]', error, info) }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding:'1rem', background:'#fff5f5', border:'1px solid #fecaca', borderRadius:'8px', fontSize:'12px', color:'#dc2626', marginTop:'16px' }}>
          Chart error: {String(this.state.error?.message || 'Unknown error')}
          <button onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginLeft:'12px', fontSize:'11px', padding:'2px 8px', border:'1px solid #fecaca', borderRadius:'4px', cursor:'pointer', background:'#fff' }}>
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}



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

// Parse stop datetime — handles epoch ms (number from IoT timestamp())
// OR string format from DynamoDB
function parseStopDt(val) {
  if (!val) return 0
  // Epoch ms (from IoT rule timestamp())
  const num = Number(val)
  if (!isNaN(num) && num > 1000000000000) return num
  // String datetime — stored as UTC
  return parseMeasStartDt(String(val))
}

// Parse MeasStart datetime — stored in LOCAL time (IST = UTC+5:30)
// Subtract 5.5 hours to convert to UTC ms for comparison
// Parse MeasStart/MeasStop datetime — stored as UTC string
function parseMeasStartDt(val) {
  if (!val) return 0
  const d = parseDt(String(val))
  return d ? d.getTime() : 0
}

function fmtStopDt(val) {
  if (!val) return '—'
  const ms = parseStopDt(val)
  if (!ms) return '—'
  const d = new Date(ms)
  const hh  = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  const dd  = String(d.getDate()).padStart(2, '0')
  const mm  = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${hh}:${min} ${dd}-${mm}-${yyyy}`
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
// Y axis: top = index 1500, bottom = index 1
// Direct mapping — no bucketing, each pixel row = proportional array index

function buildHeatmapData(sposData) {
  if (!sposData || !sposData.length) return []
  return sposData.map(({ spos, rec }) => {
    const W = parseWearArr(rec.wear_data)
    if (!W.length) return null
    return { spos, W, nPts: W.length }
  }).filter(Boolean)
}

// Orange→DarkRed for W>0, LightBlue→DarkBlue for W<0, White for W=0
function heatColor(w, absMax) {
  if (w === null || w === undefined || Math.abs(w) < 0.1) return [255, 255, 255]
  const mx = absMax || 10
  if (w > 0) {
    // Buildup → blue (light blue to dark blue)
    const t = Math.min(1, w / mx)
    const r = Math.round(173 * (1 - t))
    const g = Math.round(216 * (1 - t))
    const b = Math.round(230 - t * (230 - 139))
    return [r, g, b]
  } else {
    // Wear → red/orange (light orange to dark red)
    const t = Math.min(1, -w / mx)
    return [Math.round(255 - t * (255 - 139)), Math.round(165 * (1 - t)), 0]
  }
}

// ── Heatmap Component ─────────────────────────────────────────
function WearHeatmap({ sposData }) {
  const canvasRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)

  const grid   = useMemo(() => buildHeatmapData(sposData), [sposData])
  const nCols  = grid.length
  const maxPts = grid.reduce((m, r) => Math.max(m, r.nPts), 0) || 1500

  const absMax = useMemo(() => {
    let mx = 0
    grid.forEach(({ W }) => W.forEach(v => { if (Math.abs(v) > mx) mx = Math.abs(v) }))
    return mx || 10
  }, [grid])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !nCols) return
    const CW = canvas.width
    const CH = canvas.height
    if (!CW || !CH) return
    const ctx = canvas.getContext('2d')
    const imgData = ctx.createImageData(CW, CH)
    const data    = imgData.data
    if (!data || !data.length) return
    const colW = CW / nCols

    grid.forEach(({ W, nPts }, ci) => {
      if (!W || !nPts) return
      const x0 = Math.floor(ci * colW)
      const x1 = Math.floor((ci + 1) * colW)
      for (let row = 0; row < CH; row++) {
        const arrIdx = Math.max(0, Math.min(nPts-1, Math.floor(((CH - 1 - row) / CH) * nPts)))
        const w = W[arrIdx] ?? 0
        const [r, g, b] = heatColor(w, absMax)
        for (let x = x0; x < x1; x++) {
          const p = (row * CW + x) * 4
          if (p >= 0 && p + 3 < data.length) {
            data[p] = r; data[p+1] = g; data[p+2] = b; data[p+3] = 255
          }
        }
      }
    })
    ctx.putImageData(imgData, 0, 0)
  }, [grid, absMax, nCols])

  function getCell(e) {
    const canvas = canvasRef.current
    if (!canvas || !nCols) return null
    const rect   = canvas.getBoundingClientRect()
    const px     = (e.clientX - rect.left) * canvas.width  / rect.width
    const py     = (e.clientY - rect.top)  * canvas.height / rect.height
    const ci     = Math.floor(px / (canvas.width / nCols))
    const col    = grid[ci]
    if (!col) return null
    // row 0 = top = index nPts (1500), row CH = bottom = index 1
    // arrIdx 0 = first element = index 1 (bottom)
    // arrIdx nPts-1 = last element = index nPts (top)
    // Canvas: row=0(top) → arrIdx=nPts-1 → element i=nPts (top=1500)
    //         row=CH(bottom) → arrIdx=0 → element i=1 (bottom=1)
    const fraction   = Math.max(0, Math.min(0.9999, py / canvas.height))
    const arrIdx     = Math.floor(((canvas.height - py) / canvas.height) * col.nPts)
    const clampedIdx = Math.max(0, Math.min(col.nPts - 1, arrIdx))
    const idxLabel   = clampedIdx + 1   // 1-based: arrIdx=0→i=1(bottom), arrIdx=nPts-1→i=nPts(top)
    return { spos: col.spos, idxLabel, w: col.W[clampedIdx] }
  }

  // Y axis labels: show index values top→bottom (1500→1)
  // Y axis labels every 100 indices, top=maxPts(1500) → bottom=1
  const yLabels = []
  for (let v = maxPts; v >= 100; v -= 100) yLabels.push(v)
  if (yLabels[yLabels.length - 1] !== 1) yLabels.push(1)

  if (!nCols) return null

  return (
    <div style={{ marginTop: '24px' }}>
      <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginBottom: '4px' }}>
        Wear Heatmap — Surface Map
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '10px' }}>
        X = axial position (spos mm) · Y = array index (top={maxPts} → bottom=1) ·
        <span style={{ color: '#dc2626', fontWeight: '600' }}> Red = wear (W&lt;0)</span> ·
        <span style={{ color: '#1d4ed8', fontWeight: '600' }}> Blue = buildup (W&gt;0)</span>
      </div>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
        {/* Y axis labels */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: '40px', flexShrink: 0 }}>
          {yLabels.map(v => (
            <span key={v} style={{ fontSize: '9px', color: '#94a3b8', textAlign: 'right', paddingRight: '4px' }}>{v}</span>
          ))}
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, position: 'relative' }}>
          <canvas
            ref={canvasRef}
            width={Math.max(nCols * 10, 600)}
            height={400}
            style={{ width: '100%', height: '400px', borderRadius: '8px', border: '1px solid #e2e8f0', cursor: 'crosshair', display: 'block' }}
            onMouseMove={e => {
              const cell = getCell(e)
              if (!cell) { setTooltip(null); return }
              setTooltip({ ...cell, x: e.clientX, y: e.clientY })
            }}
            onMouseLeave={() => setTooltip(null)}
          />
          {tooltip && (
            <div style={{ position: 'fixed', left: tooltip.x+12, top: tooltip.y-30, background: '#1e293b', color: '#f1f5f9', padding: '5px 10px', borderRadius: '6px', fontSize: '11px', pointerEvents: 'none', zIndex: 9999, whiteSpace: 'nowrap' }}>
              spos={tooltip.spos}mm · i={tooltip.idxLabel} · W={tooltip.w !== undefined ? Number(tooltip.w).toFixed(3) : '—'}mm
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

      {/* X axis labels */}
      <div style={{ paddingLeft: '48px', paddingRight: '52px', marginTop: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#94a3b8' }}>
          {grid.filter((_, i) => i === 0 || i === Math.floor(grid.length/2) || i === grid.length-1).map(r => (
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

// ── Plotly Heatmap ───────────────────────────────────────────
function PlotlyHeatmap({ sposData }) {
  const plotData = useMemo(() => {
    try {
      if (!sposData || !sposData.length) return null
      const xLabels = sposData.map(r => r.spos)

      // Use max nPts across all records to avoid out-of-bounds
      const allNpts = sposData.map(r => parseWearArr(r?.rec?.wear_data).length).filter(n => n > 0)
      if (!allNpts.length) return null
      const maxNpts = Math.max(...allNpts)
      const yLabels = Array.from({ length: maxNpts }, (_, i) => i + 1)

      // Build Z matrix: rows=index(1..maxNpts), cols=spos
      const Z = Array.from({ length: maxNpts }, () => new Array(sposData.length).fill(null))
      sposData.forEach((r, ci) => {
        const W = parseWearArr(r?.rec?.wear_data)
        W.forEach((w, i) => {
          if (i < maxNpts && Z[i]) Z[i][ci] = w
        })
      })

      return { xLabels, yLabels, Z }
    } catch(e) {
      console.error('[PlotlyHeatmap] error building plotData:', e)
      return null
    }
  }, [sposData])

  if (!plotData) return null

  // Colorscale mapped to W range [-20, 20]:
  // W=-20 → darkest red, W=-1 → light orange, W=0 → white
  // W=1 → light blue, W=4+ → dark blue
  // Normalized: 0=W=-20, 0.475=W=-1, 0.5=W=0, 0.525=W=+1, 0.6=W=+4, 1=W=+20
  const colorscale = [
    [0,     'rgb(139,0,0)'],      // darkest red — max wear (-20mm)
    [0.3,   'rgb(255,100,0)'],    // orange
    [0.45,  'rgb(255,200,150)'],  // light orange (-1mm)
    [0.5,   'rgb(255,255,255)'],  // white (0mm)
    [0.55,  'rgb(173,216,230)'],  // light blue (+1mm)
    [0.7,   'rgb(100,149,237)'],  // medium blue (+4mm)
    [1,     'rgb(0,0,139)'],      // darkest blue — max buildup (+20mm)
  ]

  return (
    <div style={{ marginTop: '24px' }}>
      <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginBottom: '4px' }}>
        Wear Heatmap — Plotly (Interactive)
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>
        X = spos (mm) · Y = array index (1→{plotData.yLabels.length}) · Colour = W[i] (mm) · Scroll to zoom · Drag to pan
      </div>
      <Plot
        data={[{
          type:        'heatmap',
          x:           plotData.xLabels,
          y:           plotData.yLabels,
          z:           plotData.Z,
          colorscale,
          zmin:        -20,
          zmax:        20,
          zmid:        0,
          colorbar: {
            title: { text: 'W (mm)', side: 'right' },
            thickness: 15, len: 0.9,
            tickvals: [-20, -10, -1, 0, 1, 4, 10, 20],
            ticktext: ['-20 (wear)', '-10', '-1', '0', '+1', '+4', '+10', '+20 (buildup)'],
          },
          hoverongaps: false,
          hovertemplate: 'spos=%{x}mm<br>i=%{y}<br>W=%{z:.3f}mm<extra></extra>',
        }]}
        layout={{
          margin: { l: 60, r: 80, t: 20, b: 80 },
          xaxis: {
            title: { text: 'Axial position (spos mm)' },
            color: '#64748b',
            rangeslider: { visible: true, thickness: 0.05 },
          },
          yaxis: {
            title: { text: 'Array index i' },
            color: '#64748b',
            autorange: true,
            fixedrange: false,
          },
          paper_bgcolor: 'transparent',
          plot_bgcolor:  '#fafafa',
          height:        500,
        }}
        config={{
          responsive: true,
          displayModeBar: true,
          displaylogo: false,
          scrollZoom: true,
          modeBarButtonsToAdd: ['zoom2d', 'pan2d', 'resetScale2d'],
        }}
        style={{ width: '100%' }}
      />
      <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'4px' }}>
        Scroll over Y axis to zoom array index range · Scroll over X axis to zoom spos range · Drag to pan
      </div>
    </div>
  )
}

// ── Plotly Polar Plot ─────────────────────────────────────────
function PlotlyPolarPlot({ sposData, rollid, sysid, liveMode }) {
  const [selectedSpos, setSelectedSpos] = useState(null)
  const [radius,       setRadius]       = useState(null)

  // Fetch radius from latest status record (last 24hrs)
  const statusFrom = useMemo(() => {
    const d = new Date(); d.setHours(d.getHours() - 24); return d.toISOString()
  }, [])
  const statusTo = useMemo(() => new Date().toISOString(), [])
  const { data: statusRaw } = useApi(fetchStatusHistory, [sysid, statusFrom, statusTo], { pollMs: 60000 })
  useEffect(() => {
    const items = toArray(statusRaw).filter(r => r.sysid && r.sysid !== 'unknown')
    if (!items.length) return
    const latest = items.sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)))[0]
    const r = rollid === 1 ? safeFloat(latest?.r1_rad) : safeFloat(latest?.r2_rad)
    console.log('[PolarPlot] radius from status:', r, 'rollid:', rollid, 'latest:', latest)
    if (r && r > 0) setRadius(r)
  }, [statusRaw, rollid])

  // Auto-select latest spos in live mode, first spos in historical
  const sposList = useMemo(() => sposData.map(r => r.spos), [sposData])

  useEffect(() => {
    if (!sposList.length) return
    if (liveMode) {
      setSelectedSpos(sposList[sposList.length - 1]) // latest = highest spos
    } else {
      setSelectedSpos(prev => prev && sposList.includes(prev) ? prev : sposList[0])
    }
  }, [sposList, liveMode])

  const currentIdx = sposList.indexOf(selectedSpos)

  function goPrev() {
    if (currentIdx > 0) setSelectedSpos(sposList[currentIdx - 1])
  }
  function goNext() {
    if (currentIdx < sposList.length - 1) setSelectedSpos(sposList[currentIdx + 1])
  }

  // Build polar trace for selected spos
  const plotData = useMemo(() => {
    if (!selectedSpos || !radius) return null
    const row = sposData.find(r => r.spos === selectedSpos)
    if (!row) return null

    const W    = parseWearArr(row.rec.wear_data)
    const C    = computeC(row.rec)
    const nPts = W.length
    if (!nPts || !C.length) return null

    // S[i] = C[i] + W[i], r[i] = radius - S[i]
    const rVals     = []
    const thetaVals = []
    for (let i = 0; i < nPts; i++) {
      const S = (C[i] || 0) + W[i]
      rVals.push(Math.max(0, radius - S))
      thetaVals.push((i / nPts) * 360)
    }
    // Close the loop
    rVals.push(rVals[0])
    thetaVals.push(360)

    // Baseline: r = radius - avg(S)
    const avgS      = rVals.reduce((s, v) => s + v, 0) / rVals.length
    const baseR     = Array(37).fill(avgS)
    const baseTheta = Array.from({ length: 37 }, (_, i) => i * 10)

    return { rVals, thetaVals, baseR, baseTheta, avgS: avgS.toFixed(1) }
  }, [selectedSpos, radius, sposData])

  if (!sposData.length) return null

  return (
    <div style={{ marginTop: '24px' }}>
      <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginBottom: '8px' }}>
        Polar Cross-Section — r = r1_rad − S[i]
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '12px' }}>
        Radius from Status message: <strong>{radius ? `${radius}mm` : 'loading...'}</strong> ·
        r[i] = {radius}mm − S[i] · Worn area → r smaller (inside) · Buildup → r larger (outside)
      </div>

      {/* Spos selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <button onClick={goPrev} disabled={currentIdx <= 0}
          style={{ padding: '6px 12px', fontSize: '13px', border: '1px solid #e2e8f0', borderRadius: '6px', background: currentIdx <= 0 ? '#f1f5f9' : '#fff', cursor: currentIdx <= 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          ◀
        </button>
        <select value={selectedSpos ?? ''} onChange={e => setSelectedSpos(parseFloat(e.target.value))}
          style={{ padding: '6px 12px', fontSize: '13px', border: '1px solid #e2e8f0', borderRadius: '6px', background: '#fff', fontFamily: 'inherit' }}>
          {sposList.map(s => (
            <option key={s} value={s}>spos = {s}mm</option>
          ))}
        </select>
        <button onClick={goNext} disabled={currentIdx >= sposList.length - 1}
          style={{ padding: '6px 12px', fontSize: '13px', border: '1px solid #e2e8f0', borderRadius: '6px', background: currentIdx >= sposList.length - 1 ? '#f1f5f9' : '#fff', cursor: currentIdx >= sposList.length - 1 ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          ▶
        </button>
        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
          {currentIdx + 1} of {sposList.length} positions
        </span>
        {liveMode && (
          <span style={{ fontSize: '11px', color: '#22c55e', fontWeight: '600' }}>● Auto-tracking latest spos</span>
        )}
      </div>

      {plotData && radius ? (
        <Plot
          data={[
            {
              type: 'scatterpolar',
              r:     plotData.baseR,
              theta: plotData.baseTheta,
              mode:  'lines',
              name:  `Baseline (avg r=${plotData.avgS}mm)`,
              line:  { color: '#94a3b8', width: 1.5, dash: 'dash' },
              hovertemplate: 'Baseline<br>r=%{r:.2f}mm<extra></extra>',
            },
            {
              type: 'scatterpolar',
              r:     plotData.rVals,
              theta: plotData.thetaVals,
              mode:  'lines',
              name:  `spos=${selectedSpos}mm`,
              line:  { color: '#1d4ed8', width: 2 },
              fill:  'toself',
              fillcolor: 'rgba(29,78,216,0.08)',
              hovertemplate: 'θ=%{theta:.1f}°<br>r=%{r:.3f}mm<br>W=%{customdata:.3f}mm<extra></extra>',
            customdata: plotData.wVals,
            },
          ]}
          layout={{
            polar: {
              radialaxis: {
                visible: true,
                range:   [plotData.rMin, plotData.rMax],
                title:   { text: 'r (mm)' },
                color:   '#64748b',
                tickfont: { size: 10 },
                tickvals: plotData ? [plotData.rMin, radius] : [],
                ticktext: plotData ? [Math.round(plotData.rMin) + 'mm', (radius || '') + 'mm (baseline)'] : [],
                gridcount: 2,
              },
              angularaxis: {
                direction: 'clockwise',
                rotation:  90,
                color:     '#64748b',
                tickfont:  { size: 10 },
                dtick:     45,
              },
            },
            showlegend:    true,
            legend:        { x: 1.05, y: 1 },
            margin:        { l: 40, r: 120, t: 20, b: 40 },
            paper_bgcolor: 'transparent',
            height:        500,
          }}
          config={{ responsive: true, displayModeBar: true, displaylogo: false }}
          style={{ width: '100%' }}
        />
      ) : (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
          {!radius ? 'Fetching radius from Status table...' : 'Select a spos position to view polar plot'}
        </div>
      )}
    </div>
  )
}

// ── Wear Polar Plot — r = r1_rad + W[i] ─────────────────────
// Grey circle = r1_rad (baseline, fixed)
// Blue circle = r1_rad + W[i] for i=1..nPts across 0°→360°
// W>0 (buildup) → outside grey circle
// W<0 (wear)    → inside grey circle

function smoothArr(arr, half=2) {
  return arr.map((_, i) => {
    const s = arr.slice(Math.max(0,i-half), Math.min(arr.length,i+half+1))
    return s.reduce((a,v)=>a+v,0)/s.length
  })
}

function WearPolarPlot({ sposData, rollid, sysid, liveMode }) {
  const [selectedSpos, setSelectedSpos] = useState(null)

  // Get radius — try localStorage MeasConfig first (instant), then Status table
  const radius = useMemo(() => {
    try {
      const saved = localStorage.getItem(`rollmonitor_measconfig_${sysid}`)
      if (saved) {
        const cfg = JSON.parse(saved)
        const r = rollid === 1 ? safeFloat(cfg.r1_rad) : safeFloat(cfg.r2_rad)
        if (r && r > 0) return r
      }
    } catch {}
    return null
  }, [sysid, rollid])

  // Also try from sposData records directly (aParam/bParam/cParam won't have r1_rad)
  // If no radius from config, try from the record's status fields if available
  const [statusRadius, setStatusRadius] = useState(null)
  const statusFrom = useMemo(() => {
    const d = new Date(); d.setHours(d.getHours() - 24); return d.toISOString()
  }, [])
  const statusTo = useMemo(() => new Date().toISOString(), [])
  const { data: statusRaw } = useApi(fetchStatusHistory, [sysid, statusFrom, statusTo], { pollMs: 60000 })

  useEffect(() => {
    const items = toArray(statusRaw).filter(r => r.sysid && r.sysid !== 'unknown')
    if (!items.length) return
    const latest = items.sort((a,b) => String(b.datetime).localeCompare(String(a.datetime)))[0]
    const r = rollid === 1 ? safeFloat(latest?.r1_rad) : safeFloat(latest?.r2_rad)
    if (r && r > 0) setStatusRadius(r)
  }, [statusRaw, rollid])

  // Use localStorage radius first, fall back to status table
  const effectiveRadius = radius || statusRadius

  const sposList = useMemo(() => sposData.map(r => r.spos), [sposData])

  useEffect(() => {
    if (!sposList.length) return
    if (liveMode) setSelectedSpos(sposList[sposList.length - 1])
    else setSelectedSpos(prev => prev && sposList.includes(prev) ? prev : sposList[0])
  }, [sposList, liveMode])

  const currentIdx = sposList.indexOf(selectedSpos)

  const plotData = useMemo(() => {
    if (!selectedSpos || !effectiveRadius) return null
    const row = sposData.find(r => r.spos === selectedSpos)
    if (!row) return null
    const Wraw = parseWearArr(row.rec.wear_data)
    if (!Wraw.length) return null

    // 5-point smoothing
    const W    = smoothArr(Wraw)
    const nPts = W.length

    // r = r1_rad + W[i], theta = ((i)/nPts) * 360 for i=0..nPts-1 (i=1..nPts in PLC)
    const rVals     = []
    const thetaVals = []
    const wVals     = []

    for (let i = 0; i < nPts; i++) {
      rVals.push(effectiveRadius + W[i])
      thetaVals.push((i / nPts) * 360)
      wVals.push(W[i])
    }

    // Fix wrap-around spike at 0°/360° only
    if (rVals.length > 1 && Math.abs(rVals[0] - rVals[rVals.length-1]) > 50) {
      const avg = (rVals[rVals.length-1] + (rVals[1] || rVals[0])) / 2
      rVals.splice(0, 1, avg)
      wVals.splice(0, 1, avg - radius)
    }

    // Close the loop
    rVals.push(rVals[0])
    thetaVals.push(360)
    wVals.push(wVals[0])

    return { rVals, thetaVals, wVals }
  }, [selectedSpos, effectiveRadius, sposData])

  if (!sposData.length) return null

  return (
    <div style={{ marginTop: '24px', paddingTop: '20px', borderTop: '2px solid #e2e8f0' }}>
      <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b', marginBottom: '4px' }}>
        Polar Cross-Section — Wear Profile (r = r1_rad + W[i])
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '12px' }}>
        <span style={{ color: '#94a3b8', fontWeight: '600' }}>Grey dashed = baseline r1_rad ({radius ?? '...'}mm)</span> ·
        <span style={{ color: '#1d4ed8', fontWeight: '600' }}> Blue = r1_rad + W[i]</span> ·
        W &gt; 0 (buildup) → outside · W &lt; 0 (wear) → inside · 5-pt smoothing
      </div>

      {/* Spos selector */}
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'12px', flexWrap:'wrap' }}>
        <button onClick={() => currentIdx > 0 && setSelectedSpos(sposList[currentIdx-1])}
          disabled={currentIdx <= 0}
          style={{ padding:'6px 12px', fontSize:'13px', border:'1px solid #e2e8f0', borderRadius:'6px', background: currentIdx<=0?'#f1f5f9':'#fff', cursor: currentIdx<=0?'default':'pointer', fontFamily:'inherit' }}>
          ◀
        </button>
        <select value={selectedSpos ?? ''} onChange={e => setSelectedSpos(parseFloat(e.target.value))}
          style={{ padding:'6px 12px', fontSize:'13px', border:'1px solid #e2e8f0', borderRadius:'6px', background:'#fff', fontFamily:'inherit' }}>
          {sposList.map(s => <option key={s} value={s}>spos = {s}mm</option>)}
        </select>
        <button onClick={() => currentIdx < sposList.length-1 && setSelectedSpos(sposList[currentIdx+1])}
          disabled={currentIdx >= sposList.length-1}
          style={{ padding:'6px 12px', fontSize:'13px', border:'1px solid #e2e8f0', borderRadius:'6px', background: currentIdx>=sposList.length-1?'#f1f5f9':'#fff', cursor: currentIdx>=sposList.length-1?'default':'pointer', fontFamily:'inherit' }}>
          ▶
        </button>
        <span style={{ fontSize:'11px', color:'#94a3b8' }}>{currentIdx+1} of {sposList.length}</span>
        {liveMode && <span style={{ fontSize:'11px', color:'#22c55e', fontWeight:'600' }}>● Auto-tracking latest</span>}
      </div>

      {plotData && effectiveRadius ? (
        <Plot
          data={[
            // Grey dashed baseline circle at r1_rad
            {
              type: 'scatterpolar',
              mode: 'lines',
              r:     Array(37).fill(radius),
              theta: Array.from({length:37}, (_,i) => i*10),
              name:  `Radius ${effectiveRadius}mm`,
              line:  { color: '#94a3b8', width: 1.5, dash: 'dash' },
              hoverinfo: 'skip',
            },
            // Blue profile: r = r1_rad + W[i]
            {
              type: 'scatterpolar',
              mode: 'lines+markers',
              r:     plotData.rVals,
              theta: plotData.thetaVals,
              name:  'Wear profile',
              line:  { color: '#1d4ed8', width: 2 },
              marker: { size: 3, color: '#1d4ed8', opacity: 0 },
              fill:  'toself',
              fillcolor: 'rgba(29,78,216,0.06)',
              customdata: plotData.wVals,
              hovertemplate: 'spos=' + String(selectedSpos) + 'mm<br>θ=%{theta:.1f}°<br>W=%{customdata:.3f}mm<extra></extra>',
              hoveron: 'points+fills',
            },
          ]}
          layout={{
            hovermode: 'closest',
            polar: {
              radialaxis: {
                visible: true,
                range:   [(effectiveRadius || 850) - 100, (effectiveRadius || 850) + 35],
                title:   '',
                tickvals: [(effectiveRadius || 850)],
                ticktext: [(effectiveRadius || 850) + 'mm'],
                tickfont: { size: 10, color: '#64748b' },
                gridcount: 1,
                gridcolor: 'rgba(148,163,184,0.3)',
              },
              angularaxis: {
                direction: 'clockwise',
                rotation:  90,
                color:     '#64748b',
                tickfont:  { size: 10 },
                dtick:     45,
                showline:  false,
                showgrid:  false,
              },
            },
            showlegend:    true,
            legend:        { orientation:'h', y:-0.15, font:{ size:11 } },
            margin:        { l:60, r:60, t:30, b:80 },
            paper_bgcolor: 'transparent',
            height:        500,
          }}
          config={{ responsive:true, displayModeBar:true, displaylogo:false }}
          style={{ width:'100%' }}
        />
      ) : (
        <div style={{ padding:'2rem', textAlign:'center', color:'#94a3b8', fontSize:'13px' }}>
          {!effectiveRadius ? 'Fetching radius from Status table...' : 'Select a spos position'}
        </div>
      )}
    </div>
  )
}


// ── 3D Wear Evolution Surface — Historical Mode Only ─────────
// X = spos positions, Y = sweep (by MeasStart session), Z = avgW
// Groups records into sweeps using 2hr gap detection between records

function WearEvolution3D({ records }) {
  const plotData = useMemo(() => {
    console.log('[WearEvolution3D] records:', records?.length)
    if (!records || records.length < 1) return null
    try {
      // Sort records by datetime
      const sorted = [...records].sort((a, b) =>
        String(a.datetime).localeCompare(String(b.datetime))
      )

      // Group into sweeps: new sweep if gap > 30 minutes between consecutive records
      const sweeps = []
      let current = [sorted[0]]
      for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(String(sorted[i-1].datetime).replace(
          /^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})/, '$1T$2'
        ))
        const curr = new Date(String(sorted[i].datetime).replace(
          /^(\d{4}-\d{2}-\d{2})-(\d{2}:\d{2})/, '$1T$2'
        ))
        const gapMin = (curr - prev) / 60000
        if (gapMin > 30) {
          if (current.length >= 3) sweeps.push(current)
          current = [sorted[i]]
        } else {
          current.push(sorted[i])
        }
      }
      if (current.length >= 3) sweeps.push(current)

      console.log('[WearEvolution3D] sweeps:', sweeps.length)
      if (sweeps.length < 1) return null

      // Get all unique spos values across all sweeps
      const sposSet = new Set()
      sweeps.forEach(sweep => {
        sweep.forEach(r => {
          const spos = Math.round((parseFloat(r.spos) || 0) * 10) / 10
          sposSet.add(spos)
        })
      })
      const allSpos = [...sposSet].sort((a, b) => a - b)

      // Build Z matrix: rows = sweeps, cols = spos
      // Y labels = sweep start time
      const Z = []
      const yLabels = []

      sweeps.forEach((sweep, si) => {
        // avgW per spos for this sweep
        const sposByPos = {}
        sweep.forEach(r => {
          const spos = Math.round((parseFloat(r.spos) || 0) * 10) / 10
          const W = parseWearArr(r.wear_data)
          if (W.length > 0 && Math.max(...W) <= 100) {
            if (!sposByPos[spos]) sposByPos[spos] = []
            sposByPos[spos].push(arrAvg(W))
          }
        })

        const row = allSpos.map(spos =>
          sposByPos[spos] !== undefined
            ? parseFloat(arrAvg(sposByPos[spos]).toFixed(3))
            : null
        )
        Z.push(row)

        // Format sweep label from first record datetime
        const dt = String(sweep[0].datetime)
        const label = dt.slice(0, 16).replace('T', ' ').replace(/-/g, '/')
        yLabels.push(`Sweep ${si+1} (${label})`)
      })

      return { x: allSpos, y: yLabels, z: Z, nSweeps: sweeps.length }
    } catch(e) {
      console.error('[WearEvolution3D]', e)
      return null
    }
  }, [records])

  if (!plotData) return (
    <div style={{ padding:'1rem', color:'#94a3b8', fontSize:'13px', textAlign:'center' }}>
      {`Grouping sweeps... (${records.length} records found, need ≥2 sweeps with 30min gap)`}
    </div>
  )

  // Colorscale matching heatmap: red=wear, white=0, blue=buildup
  const colorscale = [
    [0,    'rgb(139,0,0)'],
    [0.3,  'rgb(255,100,0)'],
    [0.45, 'rgb(255,200,150)'],
    [0.5,  'rgb(255,255,255)'],
    [0.55, 'rgb(173,216,230)'],
    [0.7,  'rgb(100,149,237)'],
    [1,    'rgb(0,0,139)'],
  ]

  return (
    <div style={{ marginTop:'24px', paddingTop:'20px', borderTop:'2px solid #e2e8f0' }}>
      <div style={{ fontSize:'14px', fontWeight:'700', color:'#1e293b', marginBottom:'4px' }}>
        Wear Evolution — 3D Surface
      </div>
      <div style={{ fontSize:'11px', color:'#94a3b8', marginBottom:'8px' }}>
        X = axial position (spos mm) · Y = measurement sweep · Z = avg W[i] (mm) ·
        <span style={{ color:'#dc2626' }}> Red = wear</span> ·
        <span style={{ color:'#1d4ed8' }}> Blue = buildup</span> ·
        {plotData.nSweeps} sweeps detected · Drag to rotate · Scroll to zoom
      </div>
      <ChartErrorBoundary>
        <Plot
          data={[{
            type: 'surface',
            x: plotData.x,
            y: plotData.y,
            z: plotData.z,
            colorscale,
            cmid: 0,
            cmin: -20,
            cmax: 20,
            colorbar: {
              title: { text: 'W (mm)', side: 'right' },
              thickness: 15,
              tickvals: [-20, -10, 0, 10, 20],
              ticktext: ['-20 (wear)', '-10', '0', '+10', '+20 (buildup)'],
            },
            hovertemplate: 'spos=%{x}mm<br>%{y}<br>W=%{z:.3f}mm<extra></extra>',
            contours: {
              z: { show: true, usecolormap: true, highlightcolor: '#42f462', project: { z: true } }
            },
          }]}
          layout={{
            scene: {
              xaxis: { title: { text: 'Axial position (spos mm)' }, color: '#64748b' },
              yaxis: { title: { text: 'Sweep' }, color: '#64748b' },
              zaxis: { title: { text: 'W (mm)' }, color: '#64748b', range: [-20, 20] },
              camera: { eye: { x: 1.5, y: -1.5, z: 1.2 } },
            },
            margin: { l: 0, r: 0, t: 20, b: 0 },
            paper_bgcolor: 'transparent',
            height: 500,
          }}
          config={{ responsive: true, displayModeBar: true, displaylogo: false }}
          style={{ width: '100%' }}
        />
      </ChartErrorBoundary>
    </div>
  )
}

// ── Stat Card ─────────────────────────────────────────────────
// ── 3D Wear Evolution Surface — Historical Mode Only ─────────
// X = spos positions, Y = sweep (by MeasStart session), Z = avgW
// Groups records into sweeps using 2hr gap detection between records


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

  // Load sensor range from saved MeasConfig for Y axis scaling
  const sensorRange = useMemo(() => {
    try {
      const saved = localStorage.getItem(`rollmonitor_measconfig_${sysid}`)
      if (saved) {
        const cfg = JSON.parse(saved)
        const minD = rollid === 1 ? parseFloat(cfg.r1_min_d) : parseFloat(cfg.r2_min_d)
        const maxD = rollid === 1 ? parseFloat(cfg.r1_max_d) : parseFloat(cfg.r2_max_d)
        if (!isNaN(minD) && !isNaN(maxD)) return { min: minD, max: maxD }
      }
    } catch {}
    return { min: 250, max: 350 }  // sensible default
  }, [sysid, rollid])

  // Start / Stop measurement
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMsg,     setActionMsg]     = useState(null)

  async function handleStart() {
    setActionLoading(true); setActionMsg(null)
    const res = await postMeasStart(sysid)
    if (res?.error) {
      setActionMsg({ type: 'error', text: res.error })
      setActionLoading(false)
    } else {
      setActionMsg({ type: 'success', text: 'MeasStart sent — waiting for PLC confirmation...' })
      setActionLoading(false)
      // Wait 8s for PLC to react and write to DynamoDB before refreshing
      setTimeout(() => {
        refreshStarted()
        refreshFinished()
        setActionMsg(null)
      }, 8000)
    }
  }

  async function handleStop() {
    setActionLoading(true); setActionMsg(null)
    const res = await postMeasStop(sysid)
    if (res?.error) {
      setActionMsg({ type: 'error', text: res.error })
      setActionLoading(false)
    } else {
      setActionMsg({ type: 'success', text: 'MeasStop sent — waiting for PLC confirmation...' })
      setActionLoading(false)
      // Wait 8s for PLC to react and write to DynamoDB before refreshing
      setTimeout(() => {
        refreshStarted()
        refreshFinished()
        setActionMsg(null)
      }, 8000)
    }
  }

  // ── Mode: live or historical ──────────────────────────────
  const [mode, setMode]     = useState('live') // 'live' | 'historical'
  // Helper: format Date as local datetime-local string (YYYY-MM-DDTHH:mm)
  function toLocalDTStr(d) {
    const pad = n => String(n).padStart(2,'0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const [histFrom, setHistFrom] = useState(() => {
    const d = new Date(); d.setHours(d.getHours() - 2); return toLocalDTStr(d)
  })
  const [histTo, setHistTo] = useState(() => toLocalDTStr(new Date()))

  // Committed range — only updates when user clicks Load
  const [committedFrom, setCommittedFrom] = useState(null)
  const [committedTo,   setCommittedTo]   = useState(null)

  // ── Fetch MeasStarted & MeasFinished ─────────────────────
  const { data: startedRaw, refresh: refreshStarted } = useApi(fetchMeasStarted, [sysid], { pollMs: 30000 })
  const { data: finishedRaw, refresh: refreshFinished } = useApi(fetchMeasFinished, [sysid], { pollMs: 30000 })

  const latestStart = useMemo(() => {
    const items = toArray(startedRaw).filter(r => r.sysid && r.sysid !== 'unknown')
    console.log('[MeasStart] items:', items.length, items[0])
    if (!items.length) return null
    // Sort by parseMeasStartDt ms (IST→UTC corrected)
    return items.sort((a, b) => {
      const da = parseMeasStartDt(a.datetime)
      const db = parseMeasStartDt(b.datetime)
      return db - da
    })[0]
  }, [startedRaw])

  const latestStop = useMemo(() => {
    const items = toArray(finishedRaw).filter(r => r.sysid && r.sysid !== 'unknown')
    console.log('[MeasStop] items:', items.length, items[0])
    if (!items.length) return null
    return items.sort((a, b) => {
      const da = parseStopDt(a.datetime)
      const db = parseStopDt(b.datetime)
      return db - da
    })[0]
  }, [finishedRaw])

  // Measurement is active if latest start is after latest stop
  const isActive = useMemo(() => {
    const startMs = latestStart ? parseMeasStartDt(latestStart.datetime) : 0
    const stopMs  = latestStop  ? parseStopDt(latestStop.datetime) : 0
    console.log('[isActive] startMs:', startMs, 'stopMs:', stopMs, 'active:', startMs > stopMs)
    if (!latestStart) return false
    if (!latestStop)  return true
    return startMs > stopMs
  }, [latestStart, latestStop])

  // ── Fetch wear data ───────────────────────────────────────
  const liveFromStr = useMemo(() => {
    if (!latestStart) return null
    // MeasStart datetime is IST — convert to UTC for API query
    const ms = parseMeasStartDt(latestStart.datetime)
    return ms ? new Date(ms).toISOString() : null
  }, [latestStart])

  // For live mode: only fetch if we have a MeasStart datetime
  // Never send null from date — would fetch entire table
  const liveEnabled = mode === 'live' && !!liveFromStr

  // Stable 'to' date — always now+24hrs, updated when liveFromStr changes
  // Must always be AFTER liveFromStr to avoid inverted date range → 500 error
  const liveToRef = useRef(null)
  useEffect(() => {
    if (liveEnabled && liveFromStr) {
      const future = new Date()
      future.setHours(future.getHours() + 24)
      liveToRef.current = future.toISOString()
    }
  }, [liveFromStr, liveEnabled])

  const { data: rawData, loading, error, refresh } = useApi(
    fetchWearData,
    mode === 'live'
      ? [sysid, rollid, liveFromStr, liveToRef.current]
      : [sysid, rollid,
          committedFrom ? new Date(committedFrom).toISOString() : new Date(histFrom).toISOString(),
          committedTo   ? new Date(committedTo).toISOString()   : new Date(histTo).toISOString(),
        ],
    {
      pollMs: liveEnabled ? 30000 : null,
      enabled: mode === 'historical' ? (committedFrom !== null) : liveEnabled,
    }
  )

  // ── S3 full records for heatmap/polar ─────────────────────
  const [s3Records, setS3Records] = useState([])
  const [s3Loading, setS3Loading] = useState(false)

  useEffect(() => {
    const meta = toArray(rawData).filter(r => r.sysid && r.sysid !== 'unknown')
    if (!meta.length) { setS3Records([]); return }

    const newFmt = meta.filter(r => r.s3_key)
    const oldFmt = meta.filter(r => r.wear_data)

    // Old format already has wear_data — use directly
    if (!newFmt.length) { setS3Records(oldFmt); return }

    // New format — batch fetch from S3
    setS3Loading(true)
    const BATCH = 50
    const keys = newFmt.map(r => r.s3_key)
    const batches = []
    for (let i = 0; i < keys.length; i += BATCH)
      batches.push(keys.slice(i, i + BATCH))

    Promise.all(batches.map(b => fetchS3Batch(b)))
      .then(results => {
        const all = []
        results.forEach(r => { if (r.data?.records) all.push(...r.data.records) })
        setS3Records([...oldFmt, ...all])
        setS3Loading(false)
      })
      .catch(() => { setS3Records(oldFmt); setS3Loading(false) })
  }, [rawData])

  // Meta records — used for line charts (avgW, avgS, avgC per spos)
  const records = useMemo(() =>
    toArray(rawData).filter(r => r.sysid && r.sysid !== 'unknown'),
    [rawData]
  )

  // Full records from S3 — used for heatmap and polar (need wear_data[])
  const fullRecords = useMemo(() =>
    s3Records.filter(r => r.sysid && r.sysid !== 'unknown' && Array.isArray(r.wear_data)),
    [s3Records]
  )

  // ── Build chart data ──────────────────────────────────────
  // sposData for line charts uses meta records (has avgW/avgS/avgC)
  const sposData = useMemo(() => buildSpossData(records), [records])
  // sposDataFull for heatmap/polar uses S3 full records (has wear_data[])
  const sposDataFull = useMemo(() => buildSpossData(fullRecords.length ? fullRecords : records), [fullRecords, records])

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
      zoom: {
        pan: {
          enabled: true,
          mode: 'xy',
        },
        zoom: {
          wheel:  { enabled: true, modifierKey: 'ctrl' },  // Ctrl+scroll to zoom
          pinch:  { enabled: true },
          mode:   'xy',
        },
        limits: {
          y: { min: 'original', max: 'original' },
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

  // No device assigned to this user
  if (!sysid) return (
    <div style={{ padding:'3rem', textAlign:'center', background:'#fff', borderRadius:'12px', border:'1px solid #e2e8f0' }}>
      <div style={{ fontSize:'40px', marginBottom:'12px' }}>🔌</div>
      <div style={{ fontSize:'16px', fontWeight:'600', color:'#1e293b', marginBottom:'8px' }}>No Device Assigned</div>
      <div style={{ fontSize:'13px', color:'#94a3b8' }}>Your account has no devices assigned. Please contact your administrator.</div>
    </div>
  )

  return (
    <div style={{ maxWidth: '1100px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Section 1: Controls ── */}
      <div className="card">
        <SectionHead title="Wear Results" />

        {/* Row 1: PLC ID | Roll | Live/Historical */}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '14px' }}>
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
          {/* Live / Historical toggle */}
          <div style={{ display: 'flex', gap: '0', border: '1.5px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
            {['live', 'historical'].map(m => (
              <button key={m} onClick={() => {
                setMode(m)
                if (m === 'historical') {
                  const now = new Date()
                  setHistTo(toLocalDTStr(now))
                  const from = new Date(now); from.setHours(from.getHours() - 2)
                  setHistFrom(toLocalDTStr(from))
                  // Reset committed — user must press Load
                  setCommittedFrom(null)
                  setCommittedTo(null)
                }
              }}
                style={{
                  padding: '8px 20px', fontSize: '13px', fontWeight: mode === m ? '700' : '400',
                  background: mode === m ? '#1d4ed8' : '#fff',
                  color: mode === m ? '#fff' : '#64748b',
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {m === 'live' ? '🔴 Live' : '📅 Historical'}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Start/Stop + Status */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
          <button
            onClick={handleStart}
            disabled={actionLoading || isActive}
            style={{
              padding: '8px 20px', fontSize: '13px', fontWeight: '600',
              background: isActive ? '#dcfce7' : '#22c55e',
              color: isActive ? '#166534' : '#fff',
              border: `1px solid ${isActive ? '#bbf7d0' : '#16a34a'}`,
              borderRadius: '8px', cursor: isActive ? 'default' : 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '6px',
            }}>
            {actionLoading ? <Spinner size="sm" /> : '▶'} Start
          </button>
          <button
            onClick={handleStop}
            disabled={actionLoading || !isActive}
            style={{
              padding: '8px 20px', fontSize: '13px', fontWeight: '600',
              background: !isActive ? '#f1f5f9' : '#ef4444',
              color: !isActive ? '#94a3b8' : '#fff',
              border: `1px solid ${!isActive ? '#e2e8f0' : '#dc2626'}`,
              borderRadius: '8px', cursor: !isActive ? 'default' : 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '6px',
            }}>
            {actionLoading ? <Spinner size="sm" /> : '⏹'} Stop
          </button>

          {/* Status badge */}
          {isActive ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '12px', color: '#166534', fontWeight: '600' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
              Measurement active · Started: {fmtDt(latestStart?.datetime)}
            </div>
          ) : (
            <div style={{ padding: '8px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', color: '#64748b' }}>
              ⚪ No active measurement
              {lastRecordDt && <span> · Last data: {fmtDt(lastRecordDt)}</span>}
            </div>
          )}

          {/* Refresh */}
          <button className="btn-secondary"
            onClick={() => { refreshStarted(); refreshFinished(); refresh() }}
            style={{ fontSize: '12px', padding: '7px 14px', marginLeft: 'auto' }}>
            ↻ Refresh
          </button>
        </div>

        {/* Action feedback */}
        {actionMsg && (
          <div style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', marginBottom: '8px',
            background: actionMsg.type === 'success' ? '#f0fdf4' : '#fff5f5',
            color: actionMsg.type === 'success' ? '#166534' : '#dc2626',
            border: `1px solid ${actionMsg.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
          }}>
            {actionMsg.type === 'success' ? '✓' : '✗'} {actionMsg.text}
          </div>
        )}

        {/* Historical date pickers */}
        {mode === 'historical' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '4px' }}>
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
              <button className="btn-primary" onClick={() => {
                setCommittedFrom(histFrom)
                setCommittedTo(histTo)
                setTimeout(refresh, 50)
              }} style={{ fontSize: '12px', padding: '8px 16px' }}>
                {loading ? <Spinner size="sm" /> : '↻ Load'}
              </button>
            </div>
          </div>
        )}

        {/* MeasStop banner */}
        {mode === 'live' && !isActive && records.length > 0 && (
          <div style={{ marginTop: '10px', padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '12px', color: '#92400e' }}>
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
          <ChartErrorBoundary>
            <div style={{ height: '280px', marginBottom: '8px' }}>
              <Line data={scData} options={commonOpts('Distance (mm)', sensorRange.min, sensorRange.max)} />
            </div>
          </ChartErrorBoundary>

          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '20px', marginBottom: '8px', lineHeight: '1.6' }}>
            <span style={{ color: '#1d6fbd', fontWeight: '600' }}>Blue = W[i] = S[i] − C[i]</span> ·
            Positive = wear (surface moved away) · Negative = buildup
          </div>

          {/* Chart 2: W[i] */}
          <ChartErrorBoundary>
            <div style={{ height: '220px' }}>
              <Line data={wData} options={commonOpts('Wear W[i] (mm)')} />
            </div>
          </ChartErrorBoundary>

          {/* 1. Plotly Heatmap — uses full S3 records */}
          <ChartErrorBoundary>
            {s3Loading && <div style={{ padding:'1rem', color:'#94a3b8', fontSize:'12px' }}>⏳ Loading full data from S3 for heatmap...</div>}
            <PlotlyHeatmap sposData={sposDataFull} />
          </ChartErrorBoundary>

          {/* 2. Wear Polar — uses full S3 records */}
          <ChartErrorBoundary>
            <WearPolarPlot
              sposData={sposDataFull}
              rollid={rollid}
              sysid={sysid}
              liveMode={mode === 'live'}
            />
          </ChartErrorBoundary>



          {/* 3D Surface — historical mode only */}
          {mode === 'historical' && (fullRecords.length > 0 || records.length > 0) && (
            <ChartErrorBoundary>
              <WearEvolution3D records={fullRecords.length ? fullRecords : records} />
            </ChartErrorBoundary>
          )}

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
