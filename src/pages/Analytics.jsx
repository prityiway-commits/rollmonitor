/**
 * Analytics.jsx — Predictive wear analytics
 *
 * Wear model (Option C):
 *   Each day → avg(W[i]) across ALL records and ALL spos positions that day
 *   = one scalar wear value per day
 *   Linear regression on daily values → wear rate + time to threshold
 *
 * wear_data[] is already W[i] = S[i] - C[i] (pre-computed by PLC)
 */
import React, { useState, useMemo } from 'react'
import { subDays } from 'date-fns'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import { Line } from 'react-chartjs-2'

import { fetchWearData, toArray } from '../services/api'
import { useApi } from '../hooks/useApi'
import { useRollNames } from '../components/RollNameContext'
import SysIdSelector, { useSysId } from '../components/SysIdSelector'
import { Spinner, ErrorBanner, SectionHead, EmptyState } from '../components'
import DateRangePicker from '../components/DateRangePicker'
import OverhaulLogSection from '../components/OverhaulLogSection'

import {
  loadSettings, saveSettings, DEFAULT_SETTINGS,
  getReference, saveReference,
  loadOverhaulLog, addOverhaul, updateOverhaul, deleteOverhaul,
  parseDynamoDate,
  buildDailyAvgWearSeries, predictWear,
  analyseOverhaulIntervals,
  computeMeasPositions, computeConcavity,
} from '../services/analytics'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

// ── Helpers ───────────────────────────────────────────────────
function fmt2(v)   { return typeof v === 'number' ? v.toFixed(2) : '—' }
function fmt1(v)   { return typeof v === 'number' ? v.toFixed(1) : '—' }
function fmtDate(d){ return d ? new Date(d).toLocaleDateString('en-GB') : '—' }

// ── KPI card ──────────────────────────────────────────────────
function KpiCard({ label, value, unit, sub, color, icon }) {
  return (
    <div className="card" style={{ borderLeft: `4px solid ${color || '#3b82f6'}` }}>
      <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>
        {icon && <span style={{ marginRight: '5px' }}>{icon}</span>}{label}
      </div>
      <div style={{ fontSize: '24px', fontWeight: '700', color: color || '#1e293b', lineHeight: 1 }}>
        {value ?? '—'}
        {unit && <span style={{ fontSize: '13px', fontWeight: '400', color: '#94a3b8', marginLeft: '4px' }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>{sub}</div>}
    </div>
  )
}

export default function Analytics() {
  const [sysid,  setSysId]  = useSysId()
  const { names }           = useRollNames()
  const [rollid, setRollid] = useState(1)
  const rollName = names['r' + rollid]

  // ── Settings ────────────────────────────────────────────────
  const [settings,    setSettings]    = useState(loadSettings)
  const [editSettings, setEditSettings] = useState(false)
  const [settingsDraft, setDraft]       = useState(loadSettings)

  const threshold    = settings.threshold    || -50
  const warningLevel = settings.warningLevel || -40

  function saveSettingsHandler() {
    saveSettings(settingsDraft)
    setSettings(settingsDraft)
    setEditSettings(false)
  }

  // ── Reference ────────────────────────────────────────────────
  const [refDate,  setRefDate]  = useState('')
  const [refLabel, setRefLabel] = useState('')

  const savedRef = getReference(sysid, rollid)

  function handleSetReference() {
    if (!refDate) return
    saveReference(sysid, rollid, refDate, refLabel)
    // force re-render
    setRefDate(refDate)
  }

  const referenceDate = savedRef ? parseDynamoDate(savedRef.date + 'T00:00:00') : null

  // ── Historical data ──────────────────────────────────────────
  const [from, setFrom] = useState(() => subDays(new Date(), 180))
  const [to,   setTo]   = useState(() => new Date())

  const { data: rawData, loading, error, refresh } = useApi(
    fetchWearData,
    [sysid, rollid, from?.toISOString(), to?.toISOString()],
    {}
  )
  const records = toArray(rawData).filter(r => r.sysid && r.sysid !== 'unknown')

  // ── Daily avg wear time series ────────────────────────────────
  const wearSeries = useMemo(
    () => buildDailyAvgWearSeries(records, referenceDate),
    [records, referenceDate]
  )

  // ── Prediction ───────────────────────────────────────────────
  const prediction = useMemo(
    () => wearSeries.length >= 2 ? predictWear(wearSeries, settings) : null,
    [wearSeries, settings]
  )

  // ── Status colour ────────────────────────────────────────────
  const statusColor = !prediction ? '#94a3b8'
    : prediction.status === 'critical' ? '#ef4444'
    : prediction.status === 'warning'  ? '#f59e0b'
    : prediction.status === 'caution'  ? '#f59e0b'
    : '#22c55e'

  const statusLabel = !prediction ? '—'
    : prediction.status === 'critical' ? '🔴 CRITICAL'
    : prediction.status === 'warning'  ? '🟡 Warning'
    : prediction.status === 'caution'  ? '🟡 Caution'
    : '🟢 Good'

  // ── Wear trend chart ─────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!wearSeries.length) return null

    const labels   = wearSeries.map(p => p.date)
    const measured = wearSeries.map(p => parseFloat(p.y.toFixed(3)))

    // Regression trend line
    const regLine = prediction?.regression
      ? wearSeries.map(p => parseFloat((prediction.regression.slope * p.x + prediction.regression.intercept).toFixed(3)))
      : []

    // Future projection
    const futureLabels = [], futureY = []
    if (prediction?.regression && prediction.daysToThreshold > 0) {
      const latestX   = wearSeries[wearSeries.length - 1].x
      const latestDate = new Date(wearSeries[wearSeries.length - 1].date)
      const steps = 10
      const endX  = latestX + Math.min(prediction.daysToThreshold, 365)
      for (let i = 1; i <= steps; i++) {
        const dx   = endX * i / steps
        const date = new Date(latestDate.getTime() + dx * 86400000)
        futureLabels.push(date.toISOString().slice(0, 10))
        futureY.push(parseFloat((prediction.regression.slope * (latestX + dx) + prediction.regression.intercept).toFixed(3)))
      }
    }

    const allLabels = [...labels, ...futureLabels]

    return {
      labels: allLabels,
      datasets: [
        {
          label: 'Daily avg wear (mm)',
          data:  [...measured, ...new Array(futureLabels.length).fill(null)],
          borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.07)',
          borderWidth: 2, pointRadius: 3, fill: true, tension: 0.3,
        },
        {
          label: 'Regression trend',
          data:  [...regLine, ...new Array(futureLabels.length).fill(null)],
          borderColor: '#f59e0b', backgroundColor: 'transparent',
          borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0, borderDash: [6, 3],
        },
        {
          label: 'Projection',
          data:  [...new Array(labels.length).fill(null), ...futureY],
          borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.06)',
          borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0, borderDash: [3, 3],
        },
        {
          label: `Threshold (${threshold}mm)`,
          data:  allLabels.map(() => threshold),
          borderColor: '#ef4444', backgroundColor: 'transparent',
          borderWidth: 1.5, pointRadius: 0, fill: false, borderDash: [4, 3],
        },
        {
          label: `Warning (${warningLevel}mm)`,
          data:  allLabels.map(() => warningLevel),
          borderColor: '#f59e0b', backgroundColor: 'transparent',
          borderWidth: 1, pointRadius: 0, fill: false, borderDash: [3, 3],
        },
      ],
    }
  }, [wearSeries, prediction, threshold, warningLevel])

  const chartOpts = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: {
      legend: { display: true, labels: { color: '#64748b', font: { size: 11 }, boxWidth: 12 } },
      tooltip: {
        backgroundColor: '#1e293b', titleColor: '#f1f5f9',
        bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1,
      },
    },
    scales: {
      x: {
        ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 12, maxRotation: 45 },
        grid:  { color: '#f1f5f9' },
        title: { display: true, text: 'Date', color: '#94a3b8', font: { size: 11 } },
      },
      y: {
        ticks: { color: '#94a3b8', font: { size: 10 } },
        grid:  { color: '#f1f5f9' },
        title: { display: true, text: 'Avg wear W (mm)', color: '#94a3b8', font: { size: 11 } },
      },
    },
  }

  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div style={{ maxWidth: '960px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1e293b', margin: 0 }}>Predictive Analytics</h2>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>
            Daily avg wear · Linear regression · Time to threshold
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <SysIdSelector value={sysid} onChange={setSysId} />
          <div style={{ display: 'flex', gap: '8px' }}>
            {[1, 2].map(r => (
              <button key={r} onClick={() => setRollid(r)}
                className={rollid === r ? 'btn-primary' : 'btn-secondary'}
                style={{ fontSize: '12px', padding: '7px 14px' }}>
                {names['r' + r]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Analytics Settings ── */}
      <div className="card">
        <SectionHead title="Analytics Settings" action={
          editSettings
            ? <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn-primary"   style={{ fontSize: '12px' }} onClick={saveSettingsHandler}>Save</button>
                <button className="btn-secondary" style={{ fontSize: '12px' }} onClick={() => setEditSettings(false)}>Cancel</button>
              </div>
            : <button className="btn-secondary" style={{ fontSize: '12px' }}
                onClick={() => { setDraft(settings); setEditSettings(true) }}>✏️ Edit</button>
        } />

        <div style={{ padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '12px', color: '#92400e', marginBottom: '14px' }}>
          ⚠ Set the <strong>Wear Threshold</strong> to your plant-specific value before using predictions. Default is −50mm but each plant may differ (e.g. −20mm to −50mm).
        </div>

        {editSettings ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            {[
              ['threshold',    'Wear threshold (mm)',     -200,  -1],
              ['warningLevel', 'Warning level (mm)',      -200,  -1],
              ['hoursPerDay',  'Operating hrs/day',          1,  24],
              ['daysPerWeek',  'Operating days/week',         1,   7],
              ['rollerLengthR1', `Roller length ${names.r1} (mm)`, 100, 10000],
              ['rollerLengthR2', `Roller length ${names.r2} (mm)`, 100, 10000],
            ].map(([key, label, min, max]) => (
              <div key={key}>
                <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', marginBottom: '5px' }}>{label}</div>
                <input type="number" min={min} max={max} value={settingsDraft[key] ?? ''}
                  onChange={e => setDraft(p => ({ ...p, [key]: parseFloat(e.target.value) }))}
                  className="input-field" style={{ fontFamily: 'monospace' }} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
            {[
              ['Wear threshold',     `${settings.threshold} mm`],
              ['Warning level',      `${settings.warningLevel} mm`],
              ['Operating hrs/day',  `${settings.hoursPerDay} hrs`],
              ['Operating days/week',`${settings.daysPerWeek} days`],
              [`Roller length ${names.r1}`, `${settings.rollerLengthR1 ?? 1000} mm`],
              [`Roller length ${names.r2}`, `${settings.rollerLengthR2 ?? 1000} mm`],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>{label}</div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#1e293b', fontFamily: 'monospace' }}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Reference date ── */}
      <div className="card">
        <SectionHead title={`Reference Measurement — ${rollName}`} />
        <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '14px', lineHeight: '1.6' }}>
          Set the date of the first measurement after overhaul (wear = 0 baseline). All wear values are computed relative to this date.
        </p>

        {savedRef && (
          <div style={{ padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', marginBottom: '14px', fontSize: '12px', color: '#166534' }}>
            ✓ Reference set: <strong>{savedRef.date}</strong>
            {savedRef.label && <span> — {savedRef.label}</span>}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>
              Reference date (overhaul / new roll)
            </div>
            <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)}
              style={{ padding: '8px 12px', fontSize: '13px', border: '1.5px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', color: '#1e293b', outline: 'none', fontFamily: 'inherit' }} />
          </div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>
              Label (optional)
            </div>
            <input type="text" value={refLabel} onChange={e => setRefLabel(e.target.value)}
              placeholder="e.g. After overhaul Q1 2025"
              className="input-field" style={{ marginBottom: 0 }} />
          </div>
          <button className="btn-primary" onClick={handleSetReference} disabled={!refDate}>
            📌 Set Reference
          </button>
        </div>
      </div>

      {/* ── Historical data range ── */}
      <div className="card">
        <SectionHead title="Historical Data Range" action={
          <button className="btn-primary" style={{ fontSize: '12px', padding: '7px 14px' }} onClick={refresh}>
            {loading ? <Spinner size="sm" /> : '↻ Load'}
          </button>
        } />
        <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        {records.length > 0 && (
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>
            {records.length} wear records loaded · {wearSeries.length} usable daily data points for regression
          </div>
        )}
        <ErrorBanner message={error} onRetry={refresh} />
      </div>

      {/* ── Alarm banner ── */}
      {prediction && (prediction.status === 'critical' || prediction.status === 'warning') && (
        <div style={{
          padding: '16px 20px', borderRadius: '12px',
          background: prediction.status === 'critical' ? '#fff5f5' : '#fffbeb',
          border: `2px solid ${prediction.status === 'critical' ? '#fecaca' : '#fde68a'}`,
          display: 'flex', alignItems: 'center', gap: '16px',
        }}>
          <div style={{ fontSize: '28px' }}>{prediction.status === 'critical' ? '🚨' : '⚠️'}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: '700', color: prediction.status === 'critical' ? '#991b1b' : '#854d0e', marginBottom: '4px' }}>
              {prediction.status === 'critical' ? 'CRITICAL' : 'WARNING'} — {rollName}
            </div>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              Current avg wear: <strong>{fmt2(prediction.currentWear)} mm</strong> · Threshold: <strong>{threshold} mm</strong>
              {prediction.daysToThreshold > 0
                ? ` · Est. ${fmt1(prediction.daysToThreshold)} days to threshold`
                : ' · Threshold reached — maintenance required'}
            </div>
          </div>
        </div>
      )}

      {/* ── KPI cards ── */}
      {!referenceDate && (
        <EmptyState icon="📌" title="Set a reference date"
          message="Set the reference date above (date of overhaul or first measurement). All wear is measured relative to that date." />
      )}

      {referenceDate && wearSeries.length === 0 && !loading && (
        <EmptyState icon="📊" title="No data after reference date"
          message="No wear records found after the reference date. Load a wider date range or check your data." />
      )}

      {referenceDate && wearSeries.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px' }}>
            <KpiCard
              label="Current wear" icon="📏"
              value={prediction ? fmt2(prediction.currentWear) : fmt2(wearSeries[wearSeries.length-1]?.y)}
              unit="mm" color={statusColor}
              sub={`Threshold: ${threshold}mm`}
            />
            <KpiCard
              label="Days to threshold" icon="⏱"
              value={prediction?.daysToThreshold > 0 ? fmt1(prediction.daysToThreshold) : prediction ? 'Exceeded' : '—'}
              unit={prediction?.daysToThreshold > 0 ? 'days' : ''}
              color={prediction?.daysToThreshold > 0 && prediction.daysToThreshold < 30 ? '#ef4444' : '#22c55e'}
              sub={prediction?.predictedDate ? `Est. shutdown: ${fmtDate(prediction.predictedDate)}` : '—'}
            />
            <KpiCard
              label="Operating hrs left" icon="⚙️"
              value={prediction?.hoursToThreshold > 0 ? Math.round(prediction.hoursToThreshold) : prediction ? '0' : '—'}
              unit={prediction?.hoursToThreshold > 0 ? 'hrs' : ''}
              color="#8b5cf6"
              sub={`At ${settings.hoursPerDay} hrs/day`}
            />
            <KpiCard
              label="Wear rate" icon="📉"
              value={prediction ? fmt2(Math.abs(prediction.wearRateMmPerDay)) : '—'}
              unit="mm/day"
              color="#64748b"
              sub={`R² = ${prediction ? (prediction.r2 * 100).toFixed(1) : '—'}% · ${wearSeries.length} pts`}
            />
          </div>

          {/* R² confidence warning */}
          {prediction && prediction.r2 < 0.5 && (
            <div style={{ padding: '12px 16px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', fontSize: '12px', color: '#92400e' }}>
              ⚠ Prediction confidence R² = {(prediction.r2 * 100).toFixed(1)}% — wear pattern is irregular. More data points needed for reliable prediction.
            </div>
          )}

          {/* Wear trend chart */}
          <div className="card">
            <SectionHead title={`Wear Trend — ${rollName}`} />
            <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '12px' }}>
              Each point = daily average of avg(W[i]) across all spos positions and all records that day.
              Blue = measured · Orange dashed = regression trend · Red dashed = threshold · Yellow dashed = warning
            </div>
            <div style={{ height: '300px' }}>
              {chartData && <Line data={chartData} options={chartOpts} />}
            </div>
          </div>
        </>
      )}

      {/* ── Overhaul log ── */}
      <OverhaulLogSection
        key={refreshKey}
        sysid={sysid}
        rollid={rollid}
        rollName={rollName}
        settings={settings}
        prediction={prediction}
        onReferenceUpdated={(date) => {
          setRefDate(date)
          setRefLabel(`Auto from overhaul log ${date}`)
        }}
        onSettingsUpdated={() => {
          setSettings(loadSettings())
          setRefreshKey(k => k + 1)
        }}
      />
    </div>
  )
}
