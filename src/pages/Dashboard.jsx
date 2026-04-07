import React from 'react'
import { differenceInMinutes } from 'date-fns'
import { fetchDashboard, toArray } from '../services/api'
import { useApi } from '../hooks/useApi'
import { Spinner, ErrorBanner, EmptyState } from '../components'
import SysIdSelector, { useSysId } from '../components/SysIdSelector'
import { useRollNames } from '../components/RollNameContext'

// ── Helpers ───────────────────────────────────────────────────
function safeStr(val) {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function fmtDt(val) {
  if (!val) return '—'
  const s = String(val).replace('T', ' ')
  // Convert "2026-02-04-14:01:31" → "14:01 04-02-2026"
  const match = s.match(/(\d{4})-(\d{2})-(\d{2})[-\s](\d{2}):(\d{2})/)
  if (match) {
    const [, yyyy, mm, dd, hh, min] = match
    return `${hh}:${min} ${dd}-${mm}-${yyyy}`
  }
  return s.slice(0, 16)
}

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

function parseTemps(info_status) {
  if (!info_status) return { cpu: null, sensor: null }
  const s = String(info_status)
  const c = s.match(/CpuTemp:\s*([\d.]+)/)
  const t = s.match(/SensorTemp:\s*([\d.]+)/)
  return {
    cpu:    c ? parseFloat(c[1]) : null,
    sensor: t ? parseFloat(t[1]) : null,
  }
}

function safeNum(val) {
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

function tempColor(val, warn, crit) {
  if (val === null) return '#94a3b8'
  if (val >= crit)  return '#ef4444'
  if (val >= warn)  return '#f59e0b'
  return '#22c55e'
}

// ── PulsingDot ────────────────────────────────────────────────
function Dot({ color }) {
  return (
    <span style={{
      display: 'inline-block', width: '8px', height: '8px',
      borderRadius: '50%', background: color,
      marginRight: '6px', verticalAlign: 'middle',
      flexShrink: 0,
    }} />
  )
}

// ── Row 1 PLC card ────────────────────────────────────────────
function PlcCard({ label, accentColor, children }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '14px',
      padding: '18px 20px', border: '1px solid #e2e8f0',
      borderTop: `4px solid ${accentColor}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      display: 'flex', flexDirection: 'column', gap: '6px',
      flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: '10px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

// ── Row 2 Roll header card ────────────────────────────────────
function RollHeaderCard({ name, color }) {
  return (
    <div style={{
      background: color, borderRadius: '14px',
      padding: '14px 20px', flex: 1, minWidth: 0,
      display: 'flex', alignItems: 'center', gap: '10px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      <Dot color="#fff" />
      <span style={{ fontSize: '16px', fontWeight: '700', color: '#fff', letterSpacing: '0.02em' }}>
        {name}
      </span>
    </div>
  )
}

// ── Row 3/4 metric card ───────────────────────────────────────
function MetricCard({ label, value, unit, color, noDataText, lastReceived }) {
  const hasData = value !== null && value !== undefined && value !== '—'
  return (
    <div style={{
      background: '#fff', borderRadius: '14px',
      padding: '18px 20px', border: '1px solid #e2e8f0',
      borderLeft: `4px solid ${hasData ? (color || '#3b82f6') : '#e2e8f0'}`,
      boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      display: 'flex', flexDirection: 'column', gap: '4px',
      flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: '10px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
        {label}
      </div>
      {hasData ? (
        <div style={{ fontSize: '26px', fontWeight: '700', color: color || '#1e293b', lineHeight: 1.1 }}>
          {value}
          {unit && <span style={{ fontSize: '13px', fontWeight: '400', color: '#94a3b8', marginLeft: '4px' }}>{unit}</span>}
        </div>
      ) : (
        <div style={{ fontSize: '18px', fontWeight: '700', color: '#94a3b8' }}>
          {noDataText || '—'}
        </div>
      )}
      {lastReceived && (
        <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px', lineHeight: 1.4 }}>
          {lastReceived}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────
export default function Dashboard() {
  const [sysid, setSysId] = useSysId()
  const { names } = useRollNames()

  const { data: dashRaw, loading, error, refresh } =
    useApi(fetchDashboard, [sysid], { pollMs: 30000 })

  const dashData   = (dashRaw && typeof dashRaw === 'object' && !Array.isArray(dashRaw)) ? dashRaw : {}
  const statusList = toArray(dashData.status).filter(r => r.sysid && r.sysid !== 'unknown')
  const latest     = statusList[0] ?? null

  const lastSeenDt  = latest ? parseDynamoDate(latest.datetime) : null
  const minsAgo     = lastSeenDt ? differenceInMinutes(new Date(), lastSeenDt) : null
  const isConnected = minsAgo !== null && minsAgo < 30
  const temps       = latest ? parseTemps(latest.info_status) : { cpu: null, sensor: null }
  const statusOk    = safeStr(latest?.status).toUpperCase() === 'OK'
  const lastDtStr   = fmtDt(latest?.datetime)

  // Roll values — only meaningful when conf=1
  const hasConf  = latest?.conf == 1
  const r1_rpm   = hasConf ? safeNum(latest?.r1_rpm)   : null
  const r2_rpm   = hasConf ? safeNum(latest?.r2_rpm)   : null
  const r1_rad   = hasConf ? safeNum(latest?.r1_rad)   : null
  const r2_rad   = hasConf ? safeNum(latest?.r2_rad)   : null
  const r1_pos   = hasConf ? safeNum(latest?.r1_pos)   : null
  const r2_pos   = hasConf ? safeNum(latest?.r2_pos)   : null

  const waitConf = 'Waiting for conf=1'

  // Row layout style
  const row = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '14px',
    marginBottom: '14px',
  }
  const row2 = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '14px',
    marginBottom: '14px',
  }

  return (
    <div style={{ maxWidth: '1020px', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '22px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1e293b', margin: 0 }}>Live Dashboard</h2>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>Auto-refreshes every 30s</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <SysIdSelector value={sysid} onChange={setSysId} />
          {loading && <Spinner size="sm" />}
          <button onClick={refresh} className="btn-secondary" style={{ fontSize: '12px' }}>↻ Refresh</button>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

      {!latest && !loading && (
        <EmptyState icon="📡" title="No data received"
          message={`No status records found for "${sysid}". Check PLC and MQTT connection.`} />
      )}

      {latest && (
        <>
          {/* ══ ROW 1: PLC Parameters ══ */}
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '10px' }}>
            PLC Parameters
          </div>
          <div style={row}>

            {/* Card 1 — System ID */}
            <PlcCard label="System ID" accentColor="#3b82f6">
              <div style={{ fontSize: '17px', fontWeight: '700', color: '#1e293b', fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.4 }}>
                {safeStr(latest.sysid)}
              </div>
              <div style={{ fontSize: '10px', color: '#94a3b8' }}>Beckhoff AMS NetID</div>
            </PlcCard>

            {/* Card 2 — System Status */}
            <PlcCard label="System Status" accentColor={!isConnected ? '#94a3b8' : statusOk ? '#22c55e' : '#ef4444'}>
              {isConnected ? (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <Dot color={statusOk ? '#22c55e' : '#ef4444'} />
                  <span style={{ fontSize: '22px', fontWeight: '700', color: statusOk ? '#166534' : '#991b1b' }}>
                    {statusOk ? 'OK' : 'NOT OK'}
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: '20px', fontWeight: '700', color: '#94a3b8' }}>NO DATA</div>
              )}
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>
                Last Status → <strong>{statusOk ? 'OK' : 'NOT OK'}</strong> received: {lastDtStr}
              </div>
            </PlcCard>

            {/* Card 3 — CPU Temperature */}
            <PlcCard label="CPU Temperature" accentColor={temps.cpu !== null && isConnected ? tempColor(temps.cpu, 70, 85) : '#94a3b8'}>
              {isConnected && temps.cpu !== null ? (
                <>
                  <div style={{ fontSize: '26px', fontWeight: '700', color: tempColor(temps.cpu, 70, 85), lineHeight: 1.1 }}>
                    {temps.cpu}<span style={{ fontSize: '14px', fontWeight: '400', color: '#94a3b8', marginLeft: '3px' }}>°C</span>
                  </div>
                  <div style={{ fontSize: '10px', color: temps.cpu >= 85 ? '#ef4444' : temps.cpu >= 70 ? '#f59e0b' : '#22c55e' }}>
                    {temps.cpu >= 85 ? '🔴 Critical' : temps.cpu >= 70 ? '🟡 High' : '🟢 Normal'}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '20px', fontWeight: '700', color: '#94a3b8' }}>NO DATA</div>
              )}
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
                Last Reading → <strong>{temps.cpu !== null ? `${temps.cpu}°C` : '—'}</strong> received: {lastDtStr}
              </div>
            </PlcCard>

            {/* Card 4 — Internet Connection */}
            <PlcCard label="Internet Connection" accentColor={isConnected ? '#22c55e' : '#ef4444'}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Dot color={isConnected ? '#22c55e' : '#ef4444'} />
                <span style={{ fontSize: '20px', fontWeight: '700', color: isConnected ? '#166534' : '#991b1b' }}>
                  {isConnected ? 'Connected' : 'No Connection'}
                </span>
              </div>
              {!isConnected && (
                <div style={{ fontSize: '10px', color: '#ef4444', fontWeight: '600' }}>
                  No data for {minsAgo} min — check PLC & MQTT
                </div>
              )}
              <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
                Last Data → received: {lastDtStr}
              </div>
            </PlcCard>

          </div>

          {/* ══ ROW 2: Roll Name Headers ══ */}
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '10px', marginTop: '8px' }}>
            Roll Parameters
          </div>
          <div style={row2}>
            <RollHeaderCard name={names.r1} color="#1d6fbd" />
            <RollHeaderCard name={names.r2} color="#0891b2" />
          </div>

          {/* ══ ROW 3: Sensor Temp + RPM for each roll ══ */}
          <div style={row}>

            <MetricCard
              label={`Sensor Temp — ${names.r1}`}
              value={isConnected && temps.sensor !== null ? temps.sensor : null}
              unit="°C"
              color={tempColor(temps.sensor, 50, 65)}
              noDataText="NO DATA"
              lastReceived={`Last Reading → ${temps.sensor !== null ? `${temps.sensor}°C` : '—'} received: ${lastDtStr}`}
            />

            <MetricCard
              label={`RPM / Speed — ${names.r1}`}
              value={isConnected && r1_rpm !== null ? r1_rpm.toFixed(1) : null}
              unit="rpm"
              color="#1d6fbd"
              noDataText={!isConnected ? 'NO DATA' : waitConf}
              lastReceived={r1_rpm !== null ? `Last Reading → ${r1_rpm.toFixed(1)} rpm received: ${lastDtStr}` : 'Received when conf=1'}
            />

            <MetricCard
              label={`Sensor Temp — ${names.r2}`}
              value={isConnected && temps.sensor !== null ? temps.sensor : null}
              unit="°C"
              color={tempColor(temps.sensor, 50, 65)}
              noDataText="NO DATA"
              lastReceived={`Last Reading → ${temps.sensor !== null ? `${temps.sensor}°C` : '—'} received: ${lastDtStr}`}
            />

            <MetricCard
              label={`RPM / Speed — ${names.r2}`}
              value={isConnected && r2_rpm !== null ? r2_rpm.toFixed(1) : null}
              unit="rpm"
              color="#1d6fbd"
              noDataText={!isConnected ? 'NO DATA' : waitConf}
              lastReceived={r2_rpm !== null ? `Last Reading → ${r2_rpm.toFixed(1)} rpm received: ${lastDtStr}` : 'Received when conf=1'}
            />

          </div>

          {/* ══ ROW 4: Radius + Sensor Position for each roll ══ */}
          <div style={row}>

            <MetricCard
              label={`Radius — ${names.r1}`}
              value={isConnected && r1_rad !== null ? r1_rad.toFixed(1) : null}
              unit="mm"
              color="#7c3aed"
              noDataText={!isConnected ? 'NO DATA' : waitConf}
              lastReceived={r1_rad !== null ? `Last Reading → ${r1_rad.toFixed(1)} mm received: ${lastDtStr}` : 'Received when conf=1'}
            />

            <MetricCard
              label={`Sensor Position — ${names.r1}`}
              value={isConnected && r1_pos !== null ? r1_pos.toFixed(1) : null}
              unit="mm"
              color="#0891b2"
              noDataText={!isConnected ? 'NO DATA' : waitConf}
              lastReceived={r1_pos !== null ? `Last Reading → ${r1_pos.toFixed(1)} mm received: ${lastDtStr}` : 'Received when conf=1'}
            />

            <MetricCard
              label={`Radius — ${names.r2}`}
              value={isConnected && r2_rad !== null ? r2_rad.toFixed(1) : null}
              unit="mm"
              color="#7c3aed"
              noDataText={!isConnected ? 'NO DATA' : waitConf}
              lastReceived={r2_rad !== null ? `Last Reading → ${r2_rad.toFixed(1)} mm received: ${lastDtStr}` : 'Received when conf=1'}
            />

            <MetricCard
              label={`Sensor Position — ${names.r2}`}
              value={isConnected && r2_pos !== null ? r2_pos.toFixed(1) : null}
              unit="mm"
              color="#0891b2"
              noDataText={!isConnected ? 'NO DATA' : waitConf}
              lastReceived={r2_pos !== null ? `Last Reading → ${r2_pos.toFixed(1)} mm received: ${lastDtStr}` : 'Received when conf=1'}
            />

          </div>

          {/* ══ Config status strip ══ */}
          <div style={{
            padding: '12px 18px', borderRadius: '10px', marginTop: '4px',
            background: hasConf ? '#f0fdf4' : '#fffbeb',
            border: `1px solid ${hasConf ? '#bbf7d0' : '#fde68a'}`,
            fontSize: '12px', color: '#64748b',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <span style={{
              fontSize: '10px', fontWeight: '700', padding: '2px 10px', borderRadius: '20px',
              background: hasConf ? '#dcfce7' : '#fef9c3',
              color: hasConf ? '#166534' : '#854d0e',
              border: `1px solid ${hasConf ? '#bbf7d0' : '#fde68a'}`,
              whiteSpace: 'nowrap',
            }}>
              {hasConf ? 'conf = 1 ✓' : 'conf = 0'}
            </span>
            {hasConf
              ? 'PLC configuration valid. All roll parameters are live values from the PLC.'
              : 'PLC has not sent measurement configuration yet. RPM, Radius and Sensor Position will show when conf=1 is received. Go to Roll Control → Apply Configuration.'}
          </div>
        </>
      )}
    </div>
  )
}
