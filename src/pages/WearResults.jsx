import React, { useState, useMemo } from 'react'
import { subDays } from 'date-fns'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import { Line } from 'react-chartjs-2'
import { fetchWearData, computeCorrectionCurve, computeWear, computeWearDiff, toArray } from '../services/api'
import { useApi } from '../hooks/useApi'
import { Spinner, ErrorBanner, EmptyState, SectionHead, StatCard } from '../components'
import DateRangePicker from '../components/DateRangePicker'
import SysIdSelector, { useSysId } from '../components/SysIdSelector'
import { useRollNames } from '../components/RollNameContext'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

function safeStr(val) {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}
function fmtDt(val) {
  const s = safeStr(val)
  return s === '—' ? '—' : s.replace('T', ' ').slice(0, 19)
}

const chartOpts = {
  responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
  plugins: {
    legend: { display: true, labels: { color: '#64748b', font: { size: 11, family: 'DM Sans' }, boxWidth: 12, boxHeight: 12 } },
    tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8', borderColor: '#334155', borderWidth: 1, padding: 10 },
  },
  scales: {
    x: { ticks: { color: '#94a3b8', font: { size: 10 }, maxTicksLimit: 15 }, grid: { color: '#f1f5f9' } },
    y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#f1f5f9' } },
  },
}

export default function WearResults() {
  const [sysid,  setSysId]  = useSysId()
  const { names } = useRollNames()
  const [rollid, setRollid] = useState(1)
  const [from,   setFrom]   = useState(subDays(new Date(), 180))
  const [to,     setTo]     = useState(new Date())
  const [refRec, setRefRec] = useState(null)
  const [liveMode, setLiveMode] = useState(false)

  // Live mode: polls every 15s with no date filter (latest 10 records)
  // Historical mode: queries by date range
  const { data: rawData, loading, error, refresh } = useApi(
    fetchWearData,
    liveMode
      ? [sysid, rollid, null, null]
      : [sysid, rollid, from?.toISOString(), to?.toISOString()],
    { pollMs: liveMode ? 15000 : null }
  )

  const records = toArray(rawData)
  const latest  = records[0] ?? null

  const latestProfile = useMemo(() => {
    if (!latest?.wear_data) return null
    // wear_data may come as array of {N: "value"} objects from DynamoDB export
    // or as plain numbers from Lambda
    const S = latest.wear_data.map(v =>
      typeof v === 'object' && v.N !== undefined ? parseFloat(v.N) : parseFloat(v)
    )
    const C = computeCorrectionCurve(
      parseFloat(latest.aParam), parseFloat(latest.bParam),
      parseFloat(latest.cParam), S.length
    )
    return { S, C, W: computeWear(S, C) }
  }, [latest])

  const refProfile = useMemo(() => {
    if (!refRec?.wear_data) return null
    const S = refRec.wear_data.map(v =>
      typeof v === 'object' && v.N !== undefined ? parseFloat(v.N) : parseFloat(v)
    )
    const C = computeCorrectionCurve(
      parseFloat(refRec.aParam), parseFloat(refRec.bParam),
      parseFloat(refRec.cParam), S.length
    )
    return computeWear(S, C)
  }, [refRec])

  const wearDiff = useMemo(() =>
    latestProfile?.W && refProfile ? computeWearDiff(refProfile, latestProfile.W) : null,
    [latestProfile, refProfile]
  )

  const labels = latestProfile ? latestProfile.S.map((_, i) => `S${i + 1}`) : []

  const profileData = {
    labels,
    datasets: [
      { label: 'Raw (S)',        data: latestProfile?.S ?? [], borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.07)',  borderWidth: 2,   pointRadius: 2, fill: true,  tension: 0.3 },
      { label: 'Correction (C)', data: latestProfile?.C ?? [], borderColor: '#f59e0b', backgroundColor: 'transparent',            borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3, borderDash: [5, 4] },
      { label: 'Wear (W=S−C)',   data: latestProfile?.W ?? [], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.07)', borderWidth: 2,   pointRadius: 3, fill: true,  tension: 0.3 },
    ],
  }
  const diffData = {
    labels: wearDiff ? wearDiff.map((_, i) => `S${i + 1}`) : [],
    datasets: [{ label: 'Wear diff (test − ref)', data: wearDiff ?? [], borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.07)', borderWidth: 2, pointRadius: 3, fill: true, tension: 0.3 }],
  }
  const trendData = {
    labels: [...records].reverse().map(r => fmtDt(r.datetime).slice(0, 16)),
    datasets: [{ label: 'aParam trend', data: [...records].reverse().map(r => parseFloat(r.aParam)), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.07)', borderWidth: 2, pointRadius: 3, fill: true, tension: 0.4 }],
  }

  return (
    <div style={{ maxWidth: '960px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Filters */}
      <div className="card">
        <SectionHead
          title={liveMode ? `Live — ${names['r'+rollid]} (auto-refresh 15s)` : 'Historical Filters'}
          action={
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setLiveMode(l => !l)}
                className={liveMode ? 'btn-danger' : 'btn-success'}
                style={{ fontSize: '12px', padding: '7px 14px' }}
              >
                {liveMode ? '⏹ Stop Live' : '▶ Go Live'}
              </button>
              {!liveMode && (
                <button className="btn-primary" style={{ fontSize: '12px', padding: '7px 14px' }} onClick={refresh}>
                  {loading ? <Spinner size="sm" /> : '↻ Load Data'}
                </button>
              )}
            </div>
          }
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '20px' }}>

          {/* Device selector */}
          <SysIdSelector value={sysid} onChange={setSysId} />

          {/* Roll selector */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Roll</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[1, 2].map(r => (
                <button key={r} onClick={() => setRollid(r)}
                  className={rollid === r ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '8px 20px', fontSize: '13px' }}>
                  {names['r'+r]}
                </button>
              ))}
            </div>
          </div>

          {/* Date range — hidden in live mode */}
          {!liveMode && (
            <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
          )}
          {liveMode && (
            <div style={{ padding: '8px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '12px', color: '#166534' }}>
              🟢 Live mode active — showing latest wear data, refreshing every 15 seconds. Click <strong>Stop Live</strong> to switch to historical view.
            </div>
          )}
        </div>

        {/* Info about selected device */}
        <div style={{ marginTop: '12px', fontSize: '12px', color: '#94a3b8' }}>
          Querying <span style={{ fontFamily: '"JetBrains Mono",monospace', color: '#1d4ed8' }}>{sysid}</span> — Roll {rollid} — {records.length} record{records.length !== 1 ? 's' : ''} loaded
        </div>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />
      {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><Spinner size="lg" /></div>}

      {!loading && records.length === 0 && (
        <EmptyState icon="📊" title="No wear data found"
          message={`No RollWearData records found for device "${sysid}", Roll ${rollid} in the selected date range. Try selecting a different device or widening the date range.`} />
      )}

      {!loading && latest && (
        <>
          {/* Stat cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px' }}>
            <StatCard label="Records loaded"  value={records.length}              accent="info" />
            <StatCard label="Array size"      value={latest.wear_data_array_size} accent="info" />
            <StatCard label="aParam (latest)" value={parseFloat(latest.aParam).toFixed(8)} accent="none" />
            <StatCard label="spos (latest)"   value={`${safeStr(latest.spos)} mm`} accent="none" />
          </div>

          {/* Wear profile chart */}
          <div className="card">
            <SectionHead title={`Wear Profile — ${sysid} · Roll ${rollid} (latest)`} />
            <div style={{ fontSize: '11px', color: '#94a3b8', fontFamily: '"JetBrains Mono",monospace', marginBottom: '14px' }}>
              {fmtDt(latest.datetime)}
            </div>
            <div style={{ height: '280px' }}><Line data={profileData} options={chartOpts} /></div>
            <div style={{ marginTop: '10px', fontSize: '11px', color: '#cbd5e1' }}>
              Blue = raw sensor S · Yellow dashed = correction curve C · Green = corrected wear W = S − C
            </div>
          </div>

          {/* aParam trend */}
          {records.length > 1 && (
            <div className="card">
              <SectionHead title="aParam Trend Over Time" />
              <div style={{ height: '220px' }}><Line data={trendData} options={chartOpts} /></div>
              <div style={{ marginTop: '8px', fontSize: '11px', color: '#cbd5e1' }}>
                Rising aParam may indicate progressive roll wear.
              </div>
            </div>
          )}

          {/* Reference comparison */}
          <div className="card">
            <SectionHead title="Wear Difference — Reference vs Latest" />
            <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '14px', lineHeight: '1.6' }}>
              Click a record to set it as <strong style={{ color: '#1d4ed8' }}>reference</strong>. The chart shows wear difference vs the latest record.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', maxHeight: '200px', overflowY: 'auto', marginBottom: '16px' }}>
              {records.map((rec, i) => {
                const isRef = refRec?.datetime === rec.datetime
                return (
                  <div key={i} onClick={() => setRefRec(isRef ? null : rec)} style={{
                    padding: '10px 14px', borderRadius: '10px', cursor: 'pointer',
                    background: isRef ? '#eff6ff' : '#f8fafc',
                    border: isRef ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                    transition: 'all 0.15s',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <span style={{ fontSize: '11px', fontFamily: '"JetBrains Mono",monospace', color: '#334155' }}>{fmtDt(rec.datetime)}</span>
                      {isRef && <span className="badge-info">Reference</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>Roll {safeStr(rec.rollid)} · {safeStr(rec.wear_data_array_size)} pts · spos {safeStr(rec.spos)}</div>
                  </div>
                )
              })}
            </div>
            {wearDiff
              ? <div style={{ height: '220px' }}><Line data={diffData} options={chartOpts} /></div>
              : <div style={{ textAlign: 'center', padding: '2rem', fontSize: '13px', color: '#cbd5e1' }}>Select a reference record above.</div>}
          </div>

          {/* Raw records table */}
          <div className="card">
            <SectionHead title="Raw Records" />
            <div style={{ overflowX: 'auto', maxHeight: '300px', overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr><th>Datetime</th><th>Roll</th><th>spos</th><th>aParam</th><th>bParam</th><th>cParam</th><th>Points</th></tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>{fmtDt(r.datetime)}</td>
                      <td>{safeStr(r.rollid)}</td>
                      <td style={{ fontFamily: '"JetBrains Mono",monospace' }}>{safeStr(r.spos)}</td>
                      <td style={{ fontFamily: '"JetBrains Mono",monospace' }}>{parseFloat(r.aParam).toFixed(8)}</td>
                      <td style={{ fontFamily: '"JetBrains Mono",monospace' }}>{parseFloat(r.bParam).toFixed(8)}</td>
                      <td style={{ fontFamily: '"JetBrains Mono",monospace' }}>{parseFloat(r.cParam).toFixed(4)}</td>
                      <td style={{ fontFamily: '"JetBrains Mono",monospace' }}>{safeStr(r.wear_data_array_size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
