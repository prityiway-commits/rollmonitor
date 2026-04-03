/**
 * Dashboard.jsx
 *
 * Status data fields found in StatusTable:
 *   sysid, datetime, status, conf, info_status, topic
 *   r1_min_d, r1_max_d, r1_pos, r1_n_steps, r1_rad, r1_rpm, r1_step
 *   (r2_* fields present when conf=1 with full config)
 *
 * info_status contains two types:
 *   - "CpuTemp: 62 SensorTemp: 40"  → parsed into temp cards
 *   - Event strings like "MQTT received valid System Configuration"
 */
import React, { useState, useCallback } from 'react'
import { subHours } from 'date-fns'
import { fetchDashboard, fetchStatusHistory, toArray } from '../services/api'
import { useApi } from '../hooks/useApi'
import { Spinner, ErrorBanner, StatCard, SectionHead, KVRow, EmptyState } from '../components'
import DateRangePicker from '../components/DateRangePicker'
import SysIdSelector, { useSysId } from '../components/SysIdSelector'
import { useRollNames } from '../components/RollNameContext'

function safeStr(val) {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function fmtDt(val) {
  if (!val) return '—'
  return String(val).replace('T', ' ').slice(0, 19)
}

// ── Parse "CpuTemp: 62 SensorTemp: 40" from info_status ─────
function parseTemps(info_status) {
  if (!info_status) return null
  const s = String(info_status)
  const cpuMatch    = s.match(/CpuTemp:\s*([\d.]+)/)
  const sensorMatch = s.match(/SensorTemp:\s*([\d.]+)/)
  if (!cpuMatch && !sensorMatch) return null
  return {
    cpu:    cpuMatch    ? parseFloat(cpuMatch[1])    : null,
    sensor: sensorMatch ? parseFloat(sensorMatch[1]) : null,
  }
}

// ── Classify info_status as temp reading or event message ────
function classifyInfoStatus(info_status) {
  if (!info_status) return 'none'
  const s = String(info_status)
  if (s.includes('CpuTemp') || s.includes('SensorTemp')) return 'temp'
  if (s.trim() === '' || s === 'No error') return 'none'
  return 'event'
}

// ── Temperature gauge card ───────────────────────────────────
function TempCard({ label, value, unit = '°C', warnAt, critAt }) {
  if (value === null || value === undefined) return null
  const v = parseFloat(value)
  const color = critAt && v >= critAt ? '#ef4444'
              : warnAt && v >= warnAt ? '#f59e0b'
              : '#22c55e'
  const accent = critAt && v >= critAt ? 'nok'
               : warnAt && v >= warnAt ? 'warn'
               : 'ok'
  return (
    <div className="card" style={{ borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: '700', color, lineHeight: 1 }}>
        {v}<span style={{ fontSize: '14px', fontWeight: '400', color: '#94a3b8', marginLeft: '3px' }}>{unit}</span>
      </div>
      {warnAt && (
        <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '6px' }}>
          {v >= (critAt || 999) ? '🔴 Critical' : v >= warnAt ? '🟡 High' : '🟢 Normal'}
        </div>
      )}
    </div>
  )
}

// ── Status badge ─────────────────────────────────────────────
function StatusBadge({ status }) {
  const s = safeStr(status).toUpperCase()
  const ok = s === 'OK'
  return (
    <span className={ok ? 'badge-ok' : s === '—' ? 'badge-warn' : 'badge-nok'}>
      <span className={ok ? 'pulse-ok' : 'pulse-nok'} />
      {s === '—' ? 'Unknown' : s}
    </span>
  )
}

// ── Roll config card (only shows if conf=1 and values exist) ─
function RollConfig({ prefix, label, rec }) {
  if (!rec) return null
  const v = (key, unit = '') => {
    const val = rec[`${prefix}_${key}`]
    if (val === undefined || val === null || val === '') return '—'
    return `${val}${unit ? ' ' + unit : ''}`
  }
  const hasData = ['min_d','max_d','pos','n_steps','rad','rpm','step']
    .some(k => rec[`${prefix}_${k}`] !== undefined && rec[`${prefix}_${k}`] !== '')

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '8px', borderBottom: '2px solid #eff6ff' }}>
        <div style={{ fontSize: '12px', fontWeight: '700', color: '#1d6fbd', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
        {!hasData && <span className="badge-warn">No config data</span>}
      </div>
      {hasData ? (
        <>
          <KVRow label="Min distance"   value={v('min_d', 'mm')} mono />
          <KVRow label="Max distance"   value={v('max_d', 'mm')} mono />
          <KVRow label="Start position" value={v('pos', 'mm')}   mono />
          <KVRow label="Steps"          value={v('n_steps')}      mono />
          <KVRow label="Step size"      value={v('step', 'mm')}  mono />
          <KVRow label="Roll radius"    value={v('rad', 'mm')}   mono />
          <KVRow label="RPM"            value={v('rpm', 'rpm')}  mono />
        </>
      ) : (
        <div style={{ fontSize: '12px', color: '#94a3b8', padding: '8px 0', lineHeight: '1.6' }}>
          Roll configuration is not available. Configuration is sent via MeasConfig and stored when <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '4px' }}>conf=1</code>.
        </div>
      )}
    </div>
  )
}

// ── Event log item ────────────────────────────────────────────
function EventItem({ datetime, message, type }) {
  const colors = {
    config:  { bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af', label: 'Config' },
    stop:    { bg: '#fef9c3', border: '#fde68a', text: '#854d0e', label: 'Stop'   },
    start:   { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', label: 'Start'  },
    error:   { bg: '#fff5f5', border: '#fecaca', text: '#991b1b', label: 'Error'  },
    info:    { bg: '#f8fafc', border: '#e2e8f0', text: '#334155', label: 'Info'   },
  }
  const c = colors[type] || colors.info
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', background: c.bg, border: `1px solid ${c.border}`, color: c.text, whiteSpace: 'nowrap', marginTop: '1px' }}>
        {c.label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12px', color: '#334155', lineHeight: '1.4' }}>{message}</div>
        <div style={{ fontSize: '10px', color: '#94a3b8', fontFamily: '"JetBrains Mono",monospace', marginTop: '2px' }}>{fmtDt(datetime)}</div>
      </div>
    </div>
  )
}

// ── Classify event type from info_status string ───────────────
function getEventType(info) {
  if (!info) return 'info'
  const s = String(info).toLowerCase()
  if (s.includes('configuration') || s.includes('config')) return 'config'
  if (s.includes('stop')) return 'stop'
  if (s.includes('start')) return 'start'
  if (s.includes('error') || s.includes('nok')) return 'error'
  return 'info'
}

export default function Dashboard() {
  const [sysid, setSysId] = useSysId()
  const { names } = useRollNames()

  const { data: dashRaw, loading, error, refresh } =
    useApi(fetchDashboard, [sysid], { pollMs: 30000 })

  const dashData    = (dashRaw && typeof dashRaw === 'object' && !Array.isArray(dashRaw)) ? dashRaw : {}
  const statusList  = toArray(dashData.status).filter(r => r.sysid && r.sysid !== 'unknown')
  const startList   = toArray(dashData.measStarted)
  const finishList  = toArray(dashData.measFinished)
  const latest      = statusList[0] ?? null

  // Parse temperatures from latest record
  const temps = latest ? parseTemps(latest.info_status) : null

  // Build event log from all status records — only non-temp info_status
  const eventLog = statusList
    .filter(r => classifyInfoStatus(r.info_status) === 'event')
    .slice(0, 8)

  // Historical
  const [from,        setFrom]        = useState(subHours(new Date(), 24))
  const [to,          setTo]          = useState(new Date())
  const [histLoading, setHistLoading] = useState(false)
  const [histData,    setHistData]    = useState(null)
  const [histError,   setHistError]   = useState(null)

  const loadHistory = useCallback(async () => {
    if (!from || !to) return
    setHistLoading(true); setHistError(null); setHistData(null)
    const { data, error: e } = await fetchStatusHistory(sysid, from.toISOString(), to.toISOString())
    setHistData(toArray(data).filter(r => r.sysid && r.sysid !== 'unknown'))
    setHistError(e)
    setHistLoading(false)
  }, [sysid, from, to])

  const recentStarts   = startList.slice(0, 5)
  const recentFinished = finishList.slice(0, 5)

  return (
    <div style={{ maxWidth: '960px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1e293b', margin: 0 }}>Live Dashboard</h2>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>Auto-refreshes every 30s</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <SysIdSelector value={sysid} onChange={setSysId} />
          {loading && <Spinner size="sm" />}
          <button onClick={refresh} className="btn-secondary" style={{ fontSize: '12px' }}>↻ Refresh</button>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

      {latest ? (
        <>
          {/* ── Row 1: Status + System ID + Config status ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>

            {/* System ID */}
            <div className="card" style={{ borderLeft: '3px solid #3b82f6' }}>
              <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>System ID</div>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#1e293b', fontFamily: '"JetBrains Mono",monospace', wordBreak: 'break-all', lineHeight: '1.6' }}>
                {safeStr(latest.sysid)}
              </div>
              <div style={{ fontSize: '10px', color: '#94a3b8', fontFamily: '"JetBrains Mono",monospace', marginTop: '4px' }}>
                {fmtDt(latest.datetime)}
              </div>
            </div>

            {/* Status */}
            <div className="card" style={{ borderLeft: '3px solid ' + (safeStr(latest.status).toUpperCase() === 'OK' ? '#22c55e' : '#ef4444') }}>
              <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '10px' }}>System Status</div>
              <StatusBadge status={latest.status} />
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '8px', lineHeight: '1.5' }}>
                {classifyInfoStatus(latest.info_status) === 'temp'
                  ? 'All systems normal'
                  : classifyInfoStatus(latest.info_status) === 'event'
                  ? safeStr(latest.info_status)
                  : 'No errors reported'}
              </div>
            </div>

            {/* Config validity */}
            <div className="card" style={{ borderLeft: `3px solid ${latest.conf ? '#22c55e' : '#f59e0b'}` }}>
              <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '10px' }}>Configuration</div>
              <span className={latest.conf ? 'badge-ok' : 'badge-warn'}>
                <span className={latest.conf ? 'pulse-ok' : 'pulse-nok'} />
                {latest.conf ? 'Valid (conf=1)' : 'Not configured (conf=0)'}
              </span>
              <div style={{ fontSize: '11px', color: '#64748b', marginTop: '8px', lineHeight: '1.5' }}>
                {latest.conf
                  ? 'Measurement configuration received from PLC.'
                  : 'No valid configuration received yet. Send MeasConfig from Roll Control page.'}
              </div>
            </div>
          </div>

          {/* ── Row 2: Temperature cards (parsed from info_status) ── */}
          {temps && (
            <div>
              <SectionHead title="Hardware Temperatures" />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px' }}>
                {temps.cpu !== null && (
                  <TempCard label="CPU Temperature" value={temps.cpu} warnAt={70} critAt={85} />
                )}
                {temps.sensor !== null && (
                  <TempCard label="Sensor Temperature" value={temps.sensor} warnAt={50} critAt={65} />
                )}
                <StatCard label="r1 RPM" value={safeStr(latest.r1_rpm) !== '—' && latest.r1_rpm !== '' ? safeStr(latest.r1_rpm) : '—'} unit="rpm" accent="info" />
                <StatCard label="r1 Radius" value={safeStr(latest.r1_rad) !== '—' && latest.r1_rad !== '' ? safeStr(latest.r1_rad) : '—'} unit="mm" accent="info" />
              </div>
            </div>
          )}

          {/* ── Row 3: Roll Configuration ── */}
          <SectionHead title="Roll Configuration (last conf=1 record)" />
          {(() => {
            // Find the most recent record where conf=1 to show config
            const confRecord = statusList.find(r => r.conf == 1) ?? latest
            return (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <RollConfig prefix="r1" label="Roll 1" rec={confRecord} />
                <RollConfig prefix="r2" label="Roll 2" rec={confRecord} />
              </div>
            )
          })()}

          {/* ── Row 4: Event log ── */}
          {eventLog.length > 0 && (
            <div className="card">
              <SectionHead title="Recent System Events" />
              <div>
                {eventLog.map((r, i) => (
                  <EventItem
                    key={i}
                    datetime={r.datetime}
                    message={safeStr(r.info_status)}
                    type={getEventType(r.info_status)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      ) : !loading && (
        <EmptyState icon="📡" title="No status data"
          message={`No records found for device "${sysid}". Select a different device or check your Lambda and StatusTable.`} />
      )}

      {/* ── Historical status ── */}
      <div className="card">
        <SectionHead
          title="Historical Status"
          action={
            <button className="btn-primary" style={{ fontSize: '12px', padding: '7px 16px' }}
              onClick={loadHistory} disabled={histLoading}>
              {histLoading ? <Spinner size="sm" /> : '↻ Load History'}
            </button>
          }
        />
        <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px', marginTop: '4px' }}>
          Querying <span style={{ fontFamily: '"JetBrains Mono",monospace', color: '#1d4ed8' }}>{sysid}</span> — select a range and click Load History.
        </div>
        <ErrorBanner message={histError} />
        {histLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><Spinner /></div>}

        {!histLoading && histData && histData.length > 0 && (
          <div style={{ marginTop: '12px', overflowX: 'auto' }}>
            <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', marginBottom: '8px' }}>
              {histData.length} record{histData.length !== 1 ? 's' : ''} found
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Datetime</th><th>Status</th><th>Conf</th>
                  <th>CPU Temp</th><th>Sensor Temp</th>
                  <th>r1 RPM</th><th>r1 Radius</th><th>Info / Event</th>
                </tr>
              </thead>
              <tbody>
                {histData.map((row, i) => {
                  const t = parseTemps(row.info_status)
                  const isEvent = classifyInfoStatus(row.info_status) === 'event'
                  return (
                    <tr key={i}>
                      <td style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>{fmtDt(row.datetime)}</td>
                      <td><StatusBadge status={row.status} /></td>
                      <td>{row.conf == 1 ? <span className="badge-ok">Valid</span> : <span className="badge-warn">—</span>}</td>
                      <td style={{ fontFamily: '"JetBrains Mono",monospace' }}>{t?.cpu !== null && t?.cpu !== undefined ? `${t.cpu}°C` : '—'}</td>
                      <td style={{ fontFamily: '"JetBrains Mono",monospace' }}>{t?.sensor !== null && t?.sensor !== undefined ? `${t.sensor}°C` : '—'}</td>
                      <td style={{ fontFamily: '"JetBrains Mono",monospace' }}>{row.r1_rpm || '—'}</td>
                      <td style={{ fontFamily: '"JetBrains Mono",monospace' }}>{row.r1_rad || '—'}</td>
                      <td style={{ fontSize: '11px', color: isEvent ? '#1e40af' : '#94a3b8', maxWidth: '200px' }}>
                        {isEvent ? safeStr(row.info_status) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!histLoading && histData && histData.length === 0 && (
          <EmptyState icon="📅" title="No records found"
            message="No records in the selected range. Try widening the date range." />
        )}
      </div>

      {/* ── Last measurement events — single record each ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        {/* Last Measurement Started */}
        <div className="card">
          <SectionHead title="Last Measurement Started" />
          {recentStarts.length > 0 ? (() => {
            const e = recentStarts[0]
            const rollName = e.rollid == 1 ? names.r1 : e.rollid == 2 ? names.r2 : `Roll ${safeStr(e.rollid)}`
            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                  <span className="badge-info">Started</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#334155' }}>{rollName}</span>
                </div>
                <KVRow label="Datetime" value={fmtDt(e.datetime)} mono />
                <KVRow label="Roll ID"  value={safeStr(e.rollid)} mono />
                <KVRow label="Device"   value={safeStr(e.sysid)}  mono />
              </div>
            )
          })()
          : <div style={{ fontSize: '12px', color: '#cbd5e1', padding: '8px 0' }}>No measurement start events found.</div>}
        </div>

        {/* Last Measurement Finished */}
        <div className="card">
          <SectionHead title="Last Measurement Finished" />
          {recentFinished.length > 0 ? (() => {
            const e = recentFinished[0]
            const rollName = e.rollid == 1 ? names.r1 : e.rollid == 2 ? names.r2 : `Roll ${safeStr(e.rollid)}`
            return (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                  <span className="badge-ok">Finished</span>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#334155' }}>{rollName}</span>
                </div>
                <KVRow label="Datetime" value={fmtDt(e.datetime)} mono />
                <KVRow label="Roll ID"  value={safeStr(e.rollid)} mono />
                <KVRow label="Device"   value={safeStr(e.sysid)}  mono />
              </div>
            )
          })()
          : <div style={{ fontSize: '12px', color: '#cbd5e1', padding: '8px 0' }}>No measurement finish events found.</div>}
        </div>
      </div>
    </div>
  )
}
