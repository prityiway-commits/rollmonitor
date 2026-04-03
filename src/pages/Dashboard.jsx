/**
 * Dashboard.jsx — Clean operator view
 *
 * Row 1: PLC Parameters — System ID | System Status | Internet Connection
 * Row 2: Roll Parameters — Sensor Temp R1 | Sensor Temp R2 | RPM R1 | RPM R2 | Radius R1 | Radius R2
 */
import React from 'react'
import { differenceInMinutes } from 'date-fns'
import { fetchDashboard, toArray } from '../services/api'
import { useApi } from '../hooks/useApi'
import { Spinner, ErrorBanner, EmptyState } from '../components'
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

// Parse "CpuTemp: 62 SensorTemp: 40" from info_status
function parseTemps(info_status) {
  if (!info_status) return { cpu: null, sensor: null }
  const s = String(info_status)
  const cpuMatch    = s.match(/CpuTemp:\s*([\d.]+)/)
  const sensorMatch = s.match(/SensorTemp:\s*([\d.]+)/)
  return {
    cpu:    cpuMatch    ? parseFloat(cpuMatch[1])    : null,
    sensor: sensorMatch ? parseFloat(sensorMatch[1]) : null,
  }
}

// Parse DynamoDB datetime to JS Date
function parseDynamoDate(val) {
  if (!val) return null
  try {
    const s = String(val)
    const parts = s.split('-')
    if (parts.length >= 4) {
      const iso = `${parts[0]}-${parts[1]}-${parts[2]}T${parts.slice(3).join('-')}`
      const d = new Date(iso)
      if (!isNaN(d)) return d
    }
    const d = new Date(s)
    return isNaN(d) ? null : d
  } catch { return null }
}

// ── Reusable card components ──────────────────────────────────

function SectionLabel({ text }) {
  return (
    <div style={{
      fontSize: '11px', fontWeight: '700', color: '#64748b',
      textTransform: 'uppercase', letterSpacing: '0.08em',
      marginBottom: '12px', marginTop: '8px',
    }}>{text}</div>
  )
}

function StatusCard({ label, children, accentColor }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '14px', padding: '20px 22px',
      border: '1px solid #e2e8f0', borderLeft: `4px solid ${accentColor}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)', flex: 1,
    }}>
      <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function MetricCard({ label, value, unit, color, sub }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '14px', padding: '20px 22px',
      border: '1px solid #e2e8f0', borderLeft: `4px solid ${color || '#3b82f6'}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)', flex: 1,
    }}>
      <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
        {label}
      </div>
      <div style={{ fontSize: '28px', fontWeight: '700', color: color || '#1e293b', lineHeight: 1 }}>
        {value ?? '—'}
        {unit && value !== '—' && value !== null && value !== undefined && (
          <span style={{ fontSize: '14px', fontWeight: '400', color: '#94a3b8', marginLeft: '4px' }}>{unit}</span>
        )}
      </div>
      {sub && <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>{sub}</div>}
    </div>
  )
}

function PulsingDot({ color }) {
  return (
    <span style={{
      display: 'inline-block', width: '9px', height: '9px',
      borderRadius: '50%', background: color,
      marginRight: '7px', verticalAlign: 'middle',
      animation: 'pulse 2s infinite',
    }} />
  )
}

export default function Dashboard() {
  const [sysid, setSysId] = useSysId()
  const { names } = useRollNames()

  const { data: dashRaw, loading, error, refresh } =
    useApi(fetchDashboard, [sysid], { pollMs: 30000 })

  const dashData   = (dashRaw && typeof dashRaw === 'object' && !Array.isArray(dashRaw)) ? dashRaw : {}
  const statusList = toArray(dashData.status).filter(r => r.sysid && r.sysid !== 'unknown')
  const latest     = statusList[0] ?? null

  // Parse values
  const temps       = latest ? parseTemps(latest.info_status) : { cpu: null, sensor: null }
  const lastSeenDt  = latest ? parseDynamoDate(latest.datetime) : null
  const minsAgo     = lastSeenDt ? differenceInMinutes(new Date(), lastSeenDt) : null
  const isOnline    = minsAgo !== null && minsAgo < 30
  const statusOk    = safeStr(latest?.status).toUpperCase() === 'OK'

  // Safe numeric values
  const safeNum = (val) => {
    const n = parseFloat(val)
    return isNaN(n) ? null : n
  }

  const r1_rpm  = safeNum(latest?.r1_rpm)
  const r2_rpm  = safeNum(latest?.r2_rpm)
  const r1_rad  = safeNum(latest?.r1_rad)
  const r2_rad  = safeNum(latest?.r2_rad)

  // Temp color logic
  const tempColor = (val, warn, crit) => {
    if (val === null) return '#94a3b8'
    if (val >= crit) return '#ef4444'
    if (val >= warn) return '#f59e0b'
    return '#22c55e'
  }

  return (
    <div style={{ maxWidth: '1000px', display: 'flex', flexDirection: 'column', gap: '0' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '24px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1e293b', margin: 0 }}>Live Dashboard</h2>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>
            Auto-refreshes every 30s
            {lastSeenDt && (
              <span> · Last data: <span style={{ fontFamily: 'monospace' }}>{fmtDt(latest?.datetime)}</span></span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <SysIdSelector value={sysid} onChange={setSysId} />
          {loading && <Spinner size="sm" />}
          <button onClick={refresh} className="btn-secondary" style={{ fontSize: '12px' }}>↻ Refresh</button>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

      {!latest && !loading && (
        <EmptyState icon="📡" title="No data received"
          message={`No status records found for device "${sysid}". Check that the PLC is connected and publishing to AWS IoT Core.`} />
      )}

      {latest && (
        <>
          {/* ══ ROW 1: PLC Parameters ══ */}
          <SectionLabel text="PLC Parameters" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '28px' }}>

            {/* System ID */}
            <StatusCard label="System ID" accentColor="#3b82f6">
              <div style={{ fontSize: '18px', fontWeight: '700', color: '#1e293b', fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: '1.4' }}>
                {safeStr(latest.sysid)}
              </div>
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
                PLC · AMS NetID
              </div>
            </StatusCard>

            {/* System Status */}
            <StatusCard label="System Status" accentColor={statusOk ? '#22c55e' : '#ef4444'}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                <PulsingDot color={statusOk ? '#22c55e' : '#ef4444'} />
                <span style={{ fontSize: '22px', fontWeight: '700', color: statusOk ? '#166534' : '#991b1b' }}>
                  {statusOk ? 'OK' : 'NOT OK'}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.5' }}>
                {(() => {
                  const info = safeStr(latest.info_status)
                  if (!info || info === '—') return 'No info'
                  if (info.includes('CpuTemp')) return 'All systems normal'
                  return info
                })()}
              </div>
            </StatusCard>

            {/* Internet / Data Connection */}
            <StatusCard label="Internet Connection" accentColor={isOnline ? '#22c55e' : '#ef4444'}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                <PulsingDot color={isOnline ? '#22c55e' : '#ef4444'} />
                <span style={{ fontSize: '22px', fontWeight: '700', color: isOnline ? '#166534' : '#991b1b' }}>
                  {isOnline ? 'Connected' : 'No Connection'}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.5' }}>
                {minsAgo === null
                  ? 'No data received yet'
                  : minsAgo < 1
                  ? 'Data received just now'
                  : `Last data ${minsAgo} min ago`}
                {!isOnline && minsAgo !== null && minsAgo >= 30 && (
                  <div style={{ marginTop: '4px', color: '#dc2626', fontWeight: '600', fontSize: '11px' }}>
                    ⚠ No data for {minsAgo} minutes — check PLC and MQTT connection
                  </div>
                )}
              </div>
            </StatusCard>

          </div>

          {/* ══ ROW 2: Roll Parameters ══ */}
          <SectionLabel text="Roll Parameters" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '12px' }}>

            {/* Sensor Temperature — Roll 1 */}
            <MetricCard
              label={`Sensor Temp — ${names.r1}`}
              value={temps.sensor !== null ? temps.sensor : '—'}
              unit="°C"
              color={tempColor(temps.sensor, 50, 65)}
              sub={temps.sensor !== null
                ? (temps.sensor >= 65 ? '🔴 Critical — check sensor cooling'
                  : temps.sensor >= 50 ? '🟡 High — monitor closely'
                  : '🟢 Normal range')
                : 'No temperature data'}
            />

            {/* Sensor Temperature — Roll 2 */}
            <MetricCard
              label={`Sensor Temp — ${names.r2}`}
              value={temps.sensor !== null ? temps.sensor : '—'}
              unit="°C"
              color={tempColor(temps.sensor, 50, 65)}
              sub={temps.sensor !== null
                ? (temps.sensor >= 65 ? '🔴 Critical'
                  : temps.sensor >= 50 ? '🟡 High'
                  : '🟢 Normal range')
                : 'No temperature data'}
            />

            {/* CPU Temperature (common for both rolls) */}
            <MetricCard
              label="CPU Temperature"
              value={temps.cpu !== null ? temps.cpu : '—'}
              unit="°C"
              color={tempColor(temps.cpu, 70, 85)}
              sub={temps.cpu !== null
                ? (temps.cpu >= 85 ? '🔴 Critical — check cooling'
                  : temps.cpu >= 70 ? '🟡 High'
                  : '🟢 Normal range')
                : 'No data'}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '28px' }}>

            {/* RPM — Roll 1 */}
            <MetricCard
              label={`RPM — ${names.r1}`}
              value={r1_rpm !== null ? r1_rpm.toFixed(1) : '—'}
              unit="rpm"
              color="#1d6fbd"
              sub={r1_rpm === null ? 'Waiting for conf=1 data' : 'Rotation speed'}
            />

            {/* RPM — Roll 2 */}
            <MetricCard
              label={`RPM — ${names.r2}`}
              value={r2_rpm !== null ? r2_rpm.toFixed(1) : '—'}
              unit="rpm"
              color="#1d6fbd"
              sub={r2_rpm === null ? 'Waiting for conf=1 data' : 'Rotation speed'}
            />

            {/* Radius — Roll 1 */}
            <MetricCard
              label={`Radius — ${names.r1}`}
              value={r1_rad !== null ? r1_rad.toFixed(1) : '—'}
              unit="mm"
              color="#8b5cf6"
              sub={r1_rad === null ? 'Waiting for conf=1 data' : 'Roll radius'}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '28px' }}>

            {/* Radius — Roll 2 */}
            <MetricCard
              label={`Radius — ${names.r2}`}
              value={r2_rad !== null ? r2_rad.toFixed(1) : '—'}
              unit="mm"
              color="#8b5cf6"
              sub={r2_rad === null ? 'Waiting for conf=1 data' : 'Roll radius'}
            />

            {/* Steps — Roll 1 */}
            <MetricCard
              label={`Steps — ${names.r1}`}
              value={latest?.r1_n_steps || '—'}
              unit=""
              color="#0891b2"
              sub="Sensor steps along rail"
            />

            {/* Steps — Roll 2 */}
            <MetricCard
              label={`Steps — ${names.r2}`}
              value={latest?.r2_n_steps || '—'}
              unit=""
              color="#0891b2"
              sub="Sensor steps along rail"
            />
          </div>

          {/* ══ Configuration status strip ══ */}
          <div style={{
            padding: '14px 20px', borderRadius: '12px', marginBottom: '8px',
            background: latest.conf ? '#f0fdf4' : '#fffbeb',
            border: `1px solid ${latest.conf ? '#bbf7d0' : '#fde68a'}`,
            display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <span style={{
              fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '20px',
              background: latest.conf ? '#dcfce7' : '#fef9c3',
              color: latest.conf ? '#166534' : '#854d0e',
              border: `1px solid ${latest.conf ? '#bbf7d0' : '#fde68a'}`,
            }}>
              <PulsingDot color={latest.conf ? '#22c55e' : '#f59e0b'} />
              {latest.conf ? 'Configuration Valid (conf=1)' : 'Not Configured (conf=0)'}
            </span>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {latest.conf
                ? `Roll parameters received from PLC. RPM, Radius and Steps are live values.`
                : `PLC has not sent measurement configuration yet. RPM, Radius and Steps show — until conf=1 is received. Go to Roll Control → Apply Configuration.`}
            </span>
          </div>
        </>
      )}
    </div>
  )
}
