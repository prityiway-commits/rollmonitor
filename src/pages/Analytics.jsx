/**
 * Analytics.jsx — Predictive wear analytics page
 *
 * Shows:
 *  1. Settings (threshold, operating hours, reference date)
 *  2. Wear trend chart with regression line + threshold line
 *  3. Prediction cards (current wear, TTT, RUL, confidence)
 *  4. Alarm status
 *  5. Overhaul log + interval analysis
 */
import React, { useState, useEffect, useMemo } from 'react'
import { subDays } from 'date-fns'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import { Line } from 'react-chartjs-2'

import { fetchWearData, toArray } from '../services/api'
import { useApi } from '../hooks/useApi'
import { useRollNames } from '../components/RollNameContext'
import SysIdSelector, { useSysId } from '../components/SysIdSelector'
import { Spinner, ErrorBanner, SectionHead, EmptyState } from '../components'
import DateRangePicker from '../components/DateRangePicker'

import {
  loadSettings, saveSettings, DEFAULT_SETTINGS,
  getReference, saveReference,
  loadOverhaulLog, addOverhaul, deleteOverhaul,
  parseDynamoDate, parseWearArray,
  buildWearTimeSeries, predictWear, analyseOverhaulIntervals,
} from '../services/analytics'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

function safeStr(val) {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

// ── Status colour map ─────────────────────────────────────────
const STATUS = {
  good:     { color: '#22c55e', bg: '#f0fdf4', border: '#bbf7d0', label: 'Good',     icon: '🟢' },
  caution:  { color: '#f59e0b', bg: '#fffbeb', border: '#fde68a', label: 'Caution',  icon: '🟡' },
  warning:  { color: '#ef4444', bg: '#fff5f5', border: '#fecaca', label: 'Warning',  icon: '🔴' },
  critical: { color: '#7f1d1d', bg: '#fef2f2', border: '#fca5a5', label: 'CRITICAL', icon: '🚨' },
  stable:   { color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', label: 'Stable',   icon: '📊' },
}

// ── Prediction KPI card ───────────────────────────────────────
function KpiCard({ label, value, unit, sub, status, icon }) {
  const s = STATUS[status] || STATUS.good
  return (
    <div className="card" style={{ borderLeft: `4px solid ${s.color}` }}>
      <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>
        {icon && <span style={{ marginRight: '5px' }}>{icon}</span>}{label}
      </div>
      <div style={{ fontSize: '26px', fontWeight: '700', color: s.color, lineHeight: 1 }}>
        {value ?? '—'}
        {unit && <span style={{ fontSize: '13px', fontWeight: '400', color: '#94a3b8', marginLeft: '4px' }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>{sub}</div>}
    </div>
  )
}

// ── Alarm banner ──────────────────────────────────────────────
function AlarmBanner({ prediction, rollName, threshold }) {
  if (!prediction) return null
  const { status, currentWear, daysToThreshold } = prediction
  if (status === 'good' || status === 'stable') return null
  const s = STATUS[status]
  return (
    <div style={{ padding: '16px 20px', borderRadius: '12px', background: s.bg, border: `2px solid ${s.border}`, display: 'flex', alignItems: 'center', gap: '16px' }}>
      <div style={{ fontSize: '28px' }}>{s.icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '15px', fontWeight: '700', color: s.color, marginBottom: '4px' }}>
          {s.label} — {rollName}
        </div>
        <div style={{ fontSize: '13px', color: '#64748b' }}>
          Current wear: <strong style={{ color: s.color }}>{currentWear?.toFixed(2)} mm</strong>
          {' '}(threshold: {threshold} mm).
          {daysToThreshold > 0
            ? ` Estimated ${daysToThreshold} days until shutdown threshold is reached.`
            : ' Wear has reached or exceeded the threshold — maintenance required immediately.'}
        </div>
      </div>
    </div>
  )
}

export default function Analytics() {
  const [sysid,   setSysId]  = useSysId()
  const { names }            = useRollNames()
  const [rollid,  setRollid] = useState(1)

  // Settings
  const [settings,    setSettings]    = useState(loadSettings)
  const [settingsDirty, setDirty]     = useState(false)

  // Reference config
  const [refDate,  setRefDate]  = useState('')
  const [refLabel, setRefLabel] = useState('')
  const savedRef = getReference(sysid, rollid)

  // Date range for fetching historical wear data
  const [from, setFrom] = useState(subDays(new Date(), 180))
  const [to,   setTo]   = useState(new Date())

  // Overhaul log
  const [overhaulLog,    setOverhaulLog]    = useState(loadOverhaulLog)
  const [newOverhaul,    setNewOverhaul]    = useState({ date: '', notes: '', wearAtOverhaul: '' })
  const [showOHForm,     setShowOHForm]     = useState(false)

  // Fetch wear data
  const { data: rawData, loading, error, refresh } =
    useApi(fetchWearData, [sysid, rollid, from.toISOString(), to.toISOString()], {})

  const records = useMemo(() => toArray(rawData).reverse(), [rawData]) // ascending by time

  // Find reference profile — first record on or after reference date
  const referenceProfile = useMemo(() => {
    if (!savedRef?.date || !records.length) return null
    const refDt = new Date(savedRef.date)
    const refRecord = records.find(r => {
      const dt = parseDynamoDate(r.datetime)
      return dt && dt >= refDt
    })
    if (!refRecord) return null
    return parseWearArray(refRecord.wear_data)
  }, [savedRef, records])

  // Build wear time series
  const wearSeries = useMemo(() => {
    if (!savedRef?.date || !referenceProfile) return []
    return buildWearTimeSeries(records, new Date(savedRef.date), referenceProfile)
  }, [records, savedRef, referenceProfile])

  // Run prediction
  const prediction = useMemo(() =>
    predictWear(wearSeries, settings, settings.hoursPerDay),
    [wearSeries, settings]
  )

  // Overhaul interval analysis
  const ohAnalysis = useMemo(() =>
    analyseOverhaulIntervals(sysid, rollid),
    [sysid, rollid, overhaulLog]
  )

  // Chart data
  const chartData = useMemo(() => {
    if (!wearSeries.length) return null

    const actualLabels = wearSeries.map(p => {
      const dt = p.datetime
      return dt ? dt.toLocaleDateString() : ''
    })

    const datasets = [
      {
        label: 'Measured wear (mm)',
        data: wearSeries.map(p => parseFloat(p.y.toFixed(3))),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.08)',
        borderWidth: 2, pointRadius: 4, fill: true, tension: 0.3,
      },
    ]

    if (prediction?.regression) {
      datasets.push({
        label: 'Wear trend (regression)',
        data: wearSeries.map((_, i) => {
          const { slope, intercept } = prediction.regression
          return parseFloat((slope * wearSeries[i].x + intercept).toFixed(3))
        }),
        borderColor: '#f59e0b',
        backgroundColor: 'transparent',
        borderWidth: 2, pointRadius: 0, fill: false,
        borderDash: [6, 3], tension: 0,
      })
    }

    // Threshold line
    datasets.push({
      label: `Threshold (${settings.threshold} mm)`,
      data: wearSeries.map(() => settings.threshold),
      borderColor: '#ef4444',
      backgroundColor: 'transparent',
      borderWidth: 1.5, pointRadius: 0, fill: false,
      borderDash: [4, 4], tension: 0,
    })

    // Warning line
    datasets.push({
      label: `Warning (${settings.warningLevel} mm)`,
      data: wearSeries.map(() => settings.warningLevel),
      borderColor: '#f59e0b',
      backgroundColor: 'transparent',
      borderWidth: 1, pointRadius: 0, fill: false,
      borderDash: [3, 3], tension: 0,
    })

    return { labels: actualLabels, datasets }
  }, [wearSeries, prediction, settings])

  const chartOpts = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: {
      legend: { display: true, labels: { color: '#64748b', font: { size: 11 }, boxWidth: 14 } },
      tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1 },
    },
    scales: {
      x: { ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 12 }, grid: { color: '#f1f5f9' } },
      y: {
        ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#f1f5f9' },
        title: { display: true, text: 'Wear (mm)', color: '#94a3b8', font: { size: 11 } },
      },
    },
  }

  function saveSettingsNow() {
    saveSettings(settings)
    setDirty(false)
  }

  function handleSaveRef() {
    if (!refDate) return
    saveReference(sysid, rollid, refDate, refLabel || `Reference — ${new Date(refDate).toLocaleDateString()}`)
    setRefDate(''); setRefLabel('')
    refresh()
  }

  function handleAddOverhaul() {
    if (!newOverhaul.date) return
    const entry = addOverhaul({ ...newOverhaul, sysid, rollid })
    setOverhaulLog(loadOverhaulLog())
    setNewOverhaul({ date: '', notes: '', wearAtOverhaul: '' })
    setShowOHForm(false)
  }

  function handleDeleteOverhaul(id) {
    deleteOverhaul(id)
    setOverhaulLog(loadOverhaulLog())
  }

  const rollName = names['r' + rollid]

  return (
    <div style={{ maxWidth: '980px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1e293b', margin: 0 }}>Predictive Analytics</h2>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>Wear trend · Time to threshold · Overhaul planning</div>
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <SysIdSelector value={sysid} onChange={setSysId} />
          <div style={{ display: 'flex', gap: '8px' }}>
            {[1, 2].map(r => (
              <button key={r} onClick={() => setRollid(r)}
                className={rollid === r ? 'btn-primary' : 'btn-secondary'}
                style={{ padding: '7px 16px', fontSize: '12px' }}>
                {names['r' + r]}
              </button>
            ))}
          </div>
          <button onClick={refresh} className="btn-secondary" style={{ fontSize: '12px' }}>
            {loading ? <Spinner size="sm" /> : '↻ Refresh'}
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

      {/* ── Alarm banner ── */}
      <AlarmBanner prediction={prediction} rollName={rollName} threshold={settings.threshold} />

      {/* ── Settings ── */}
      <div className="card">
        <SectionHead title="Analytics Settings" action={
          settingsDirty && <button className="btn-primary" style={{ fontSize: '12px', padding: '6px 14px' }} onClick={saveSettingsNow}>Save Settings</button>
        } />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px' }}>
          {[
            { label: 'Wear threshold (mm)', key: 'threshold',    step: 1  },
            { label: 'Warning level (mm)',  key: 'warningLevel', step: 1  },
            { label: 'Operating hrs/day',   key: 'hoursPerDay',  step: 0.5},
            { label: 'Operating days/week', key: 'daysPerWeek',  step: 1  },
          ].map(({ label, key, step }) => (
            <div key={key}>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{label}</div>
              <input type="number" step={step} value={settings[key]}
                onChange={e => { setSettings(s => ({ ...s, [key]: parseFloat(e.target.value) })); setDirty(true) }}
                className="input-field" style={{ fontFamily: '"JetBrains Mono",monospace' }} />
            </div>
          ))}
        </div>
      </div>

      {/* ── Reference date ── */}
      <div className="card">
        <SectionHead title={`Reference Measurement — ${rollName}`} />
        {savedRef ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '20px' }}>📌</span>
            <div>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#166534' }}>{savedRef.label}</div>
              <div style={{ fontSize: '11px', color: '#64748b', fontFamily: '"JetBrains Mono",monospace' }}>Reference date: {savedRef.date}</div>
              {referenceProfile
                ? <div style={{ fontSize: '11px', color: '#64748b' }}>✅ Reference profile loaded — {referenceProfile.length} sensor points</div>
                : <div style={{ fontSize: '11px', color: '#f59e0b' }}>⚠ No wear record found on or after this date. Try an earlier date or load more data.</div>}
            </div>
          </div>
        ) : (
          <div style={{ padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '12px', color: '#92400e', marginBottom: '12px' }}>
            ⚠ No reference date set. Set the date when the roll was last overhauled or when measurement baseline was established.
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Reference date (overhaul / new roll)</div>
            <input type="date" value={refDate} onChange={e => setRefDate(e.target.value)}
              className="input-field" style={{ width: '180px' }} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Label (optional)</div>
            <input type="text" value={refLabel} onChange={e => setRefLabel(e.target.value)}
              placeholder="e.g. After overhaul Q1 2025"
              className="input-field" style={{ width: '240px' }} />
          </div>
          <button className="btn-primary" onClick={handleSaveRef} disabled={!refDate} style={{ padding: '8px 16px', fontSize: '12px' }}>
            📌 Set Reference
          </button>
        </div>
      </div>

      {/* ── Data range ── */}
      <div className="card">
        <SectionHead title="Historical Data Range" action={
          <button className="btn-primary" style={{ fontSize: '12px', padding: '6px 14px' }} onClick={refresh}>
            {loading ? <Spinner size="sm" /> : '↻ Load'}
          </button>
        } />
        <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#94a3b8' }}>
          {records.length} wear records loaded · {wearSeries.length} usable data points for regression
        </div>
      </div>

      {/* ── Prediction KPIs ── */}
      {prediction ? (
        <>
          <SectionHead title="Wear Prediction" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px' }}>
            <KpiCard
              label="Current Wear"
              value={prediction.currentWear?.toFixed(2)}
              unit="mm"
              status={prediction.status}
              icon="📏"
              sub={`Threshold: ${settings.threshold} mm`}
            />
            <KpiCard
              label="Days to Threshold"
              value={prediction.daysToThreshold > 0 ? prediction.daysToThreshold : 'Exceeded'}
              unit={prediction.daysToThreshold > 0 ? 'days' : ''}
              status={prediction.status}
              icon="📅"
              sub={prediction.predictedDate ? `Est. ${prediction.predictedDate.toLocaleDateString()}` : 'Immediate action required'}
            />
            <KpiCard
              label="Operating Hours Left"
              value={prediction.hoursToThreshold > 0 ? prediction.hoursToThreshold : '0'}
              unit="hrs"
              status={prediction.status}
              icon="⏱"
              sub={`At ${settings.hoursPerDay} hrs/day`}
            />
            <KpiCard
              label="Wear Rate"
              value={Math.abs(prediction.wearRateMmPerDay).toFixed(4)}
              unit="mm/day"
              status="stable"
              icon="📉"
              sub={`${Math.abs(prediction.wearRateMmPerHour).toFixed(5)} mm/hr · R²=${prediction.r2} (${prediction.n} pts)`}
            />
          </div>

          {/* Confidence indicator */}
          <div style={{ padding: '10px 16px', borderRadius: '10px', background: prediction.r2 > 0.8 ? '#f0fdf4' : prediction.r2 > 0.5 ? '#fffbeb' : '#fff5f5', border: `1px solid ${prediction.r2 > 0.8 ? '#bbf7d0' : prediction.r2 > 0.5 ? '#fde68a' : '#fecaca'}`, fontSize: '12px', color: '#334155' }}>
            <strong>Prediction confidence (R² = {prediction.r2}):</strong>{' '}
            {prediction.r2 > 0.8 ? '🟢 High — trend is consistent and reliable.' : prediction.r2 > 0.5 ? '🟡 Moderate — collect more data points for better accuracy.' : '🔴 Low — wear pattern is irregular. More data needed before relying on this prediction.'}
            {prediction.n < 5 && ' ⚠ Fewer than 5 data points — predictions are indicative only.'}
          </div>
        </>
      ) : !loading && savedRef && wearSeries.length === 0 && (
        <EmptyState icon="📈" title="Not enough data for prediction"
          message="No wear data found after the reference date. Try widening the date range or check that wear records exist in RollWearDataTable." />
      )}

      {/* ── Wear trend chart ── */}
      {chartData && (
        <div className="card">
          <SectionHead title={`Wear Trend — ${rollName}`} />
          <div style={{ height: '320px' }}>
            <Line data={chartData} options={chartOpts} />
          </div>
          <div style={{ marginTop: '10px', fontSize: '11px', color: '#94a3b8' }}>
            Blue = measured wear · Orange dashed = regression trend · Red dashed = threshold · Yellow dashed = warning level
          </div>
        </div>
      )}

      {!savedRef && !loading && (
        <EmptyState icon="📌" title="Set a reference date to begin"
          message="The reference date defines the wear=0 baseline. Set it above to the date your roll was last overhauled or when measurement started." />
      )}

      {/* ── Overhaul log ── */}
      <div className="card">
        <SectionHead
          title={`Overhaul Log — ${rollName}`}
          action={
            <button className="btn-secondary" style={{ fontSize: '12px', padding: '6px 14px' }} onClick={() => setShowOHForm(f => !f)}>
              {showOHForm ? 'Cancel' : '+ Log Overhaul'}
            </button>
          }
        />

        {/* Add overhaul form */}
        {showOHForm && (
          <div style={{ padding: '14px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div className="label">Overhaul date</div>
              <input type="date" value={newOverhaul.date} onChange={e => setNewOverhaul(o => ({ ...o, date: e.target.value }))}
                className="input-field" style={{ width: '160px' }} />
            </div>
            <div>
              <div className="label">Wear at overhaul (mm)</div>
              <input type="number" value={newOverhaul.wearAtOverhaul} onChange={e => setNewOverhaul(o => ({ ...o, wearAtOverhaul: e.target.value }))}
                placeholder="e.g. -48.5" className="input-field" style={{ width: '140px', fontFamily: '"JetBrains Mono",monospace' }} />
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <div className="label">Notes</div>
              <input type="text" value={newOverhaul.notes} onChange={e => setNewOverhaul(o => ({ ...o, notes: e.target.value }))}
                placeholder="e.g. Roll surface re-ground" className="input-field" />
            </div>
            <button className="btn-primary" onClick={handleAddOverhaul} disabled={!newOverhaul.date} style={{ fontSize: '12px' }}>
              Save
            </button>
          </div>
        )}

        {/* Interval analysis */}
        {ohAnalysis.count >= 2 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px', marginBottom: '16px' }}>
            <div style={{ padding: '12px', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Avg overhaul interval</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#1d4ed8' }}>{ohAnalysis.avg} <span style={{ fontSize: '12px', fontWeight: '400' }}>days</span></div>
            </div>
            <div style={{ padding: '12px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Shortest interval</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#166534' }}>{ohAnalysis.min} <span style={{ fontSize: '12px', fontWeight: '400' }}>days</span></div>
            </div>
            <div style={{ padding: '12px', background: '#fffbeb', borderRadius: '8px', border: '1px solid #fde68a' }}>
              <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Longest interval</div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#854d0e' }}>{ohAnalysis.max} <span style={{ fontSize: '12px', fontWeight: '400' }}>days</span></div>
            </div>
          </div>
        )}

        {/* Overhaul table */}
        {ohAnalysis.log?.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Wear at overhaul</th><th>Notes</th><th>Interval</th><th></th></tr>
            </thead>
            <tbody>
              {ohAnalysis.log.map((e, i) => (
                <tr key={e.id}>
                  <td style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '12px' }}>{e.date}</td>
                  <td style={{ fontFamily: '"JetBrains Mono",monospace', color: '#ef4444' }}>
                    {e.wearAtOverhaul ? `${e.wearAtOverhaul} mm` : '—'}
                  </td>
                  <td style={{ color: '#64748b', fontSize: '12px' }}>{e.notes || '—'}</td>
                  <td style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '12px', color: '#64748b' }}>
                    {ohAnalysis.intervals[i - 1] ? `${ohAnalysis.intervals[i - 1].days} days` : '—'}
                  </td>
                  <td>
                    <button onClick={() => handleDeleteOverhaul(e.id)}
                      style={{ fontSize: '11px', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize: '12px', color: '#cbd5e1', padding: '12px 0' }}>
            No overhaul records yet. Log your first overhaul using the button above.
            {ohAnalysis.count < 2 && ' You need at least 2 overhaul records to compute interval statistics.'}
          </div>
        )}
      </div>

    </div>
  )
}
