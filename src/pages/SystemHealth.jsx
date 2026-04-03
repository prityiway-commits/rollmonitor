import React from 'react'
import { differenceInMinutes } from 'date-fns'
import { fetchDashboard, toArray } from '../services/api'
import { useApi } from '../hooks/useApi'
import { Spinner, ErrorBanner, SectionHead, KVRow, EmptyState } from '../components'
import SysIdSelector, { useSysId } from '../components/SysIdSelector'
import { useRollNames } from '../components/RollNameContext'

function safeStr(val) {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function fmtDt(val) {
  if (!val) return '—'
  const s = String(val)
  return s.replace('T', ' ').slice(0, 19)
}

// Convert DynamoDB dash-format datetime to JS Date
// "2025-09-29-13:30:44.367" → Date object
function parseDynamoDate(val) {
  if (!val) return null
  try {
    // Format: "2025-09-29-13:30:44.367"
    // Replace the third dash (between date and time) with T
    const parts = String(val).split('-')
    if (parts.length >= 4) {
      const isoStr = `${parts[0]}-${parts[1]}-${parts[2]}T${parts.slice(3).join('-')}`
      return new Date(isoStr)
    }
    return new Date(val)
  } catch { return null }
}

function HealthRow({ label, ok, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 0', borderBottom: '1px solid #f1f5f9' }}>
      <span style={{ fontSize: '13px', color: '#334155', fontWeight: '500' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {value && <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: '"JetBrains Mono",monospace' }}>{value}</span>}
        <span className={ok ? 'badge-ok' : 'badge-nok'}>
          <span className={ok ? 'pulse-ok' : 'pulse-nok'} />
          {ok ? 'OK' : 'NOK'}
        </span>
      </div>
    </div>
  )
}

export default function SystemHealth() {
  const [sysid, setSysId] = useSysId()
  const { names } = useRollNames()

  const { data: dashRaw, loading, error, refresh } =
    useApi(fetchDashboard, [sysid], { pollMs: 30000 })

  const dashData   = (dashRaw && typeof dashRaw === 'object' && !Array.isArray(dashRaw)) ? dashRaw : {}
  const statusList = toArray(dashData.status)
  const startList  = toArray(dashData.measStarted)
  const finishList = toArray(dashData.measFinished)

  const latest     = statusList[0] ?? null
  const lastStart  = startList[0]  ?? null
  const lastFinish = finishList[0] ?? null

  // Parse datetime correctly from DynamoDB format
  const lastSeenDate = latest ? parseDynamoDate(latest.datetime) : null
  const isOnline     = lastSeenDate
    ? differenceInMinutes(new Date(), lastSeenDate) < 5
    : false

  return (
    <div style={{ maxWidth: '820px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1e293b', margin: 0 }}>System Health</h2>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>Live connectivity and parameter status</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <SysIdSelector value={sysid} onChange={setSysId} />
          <button onClick={refresh} className="btn-secondary" style={{ fontSize: '12px' }}>
            {loading ? <Spinner size="sm" /> : '↻ Refresh'}
          </button>
        </div>
      </div>

      <ErrorBanner message={error} onRetry={refresh} />

      {!loading && !latest && (
        <EmptyState icon="📡" title="No data"
          message={`No status records found for device "${sysid}". Select a different device or check your API Gateway and StatusTable.`} />
      )}

      {latest && (
        <>
          {/* Connectivity */}
          <div className="card">
            <SectionHead title="Connectivity" />
            <HealthRow
              label="PLC online (last message within 5 min)"
              ok={isOnline}
              value={fmtDt(latest.datetime)}
            />
            <HealthRow
              label="System status"
              ok={safeStr(latest.status).toUpperCase() === 'OK'}
              value={safeStr(latest.info_status) || undefined}
            />
            <HealthRow label="Configuration valid" ok={!!latest.conf} />
          </div>

          {/* Roll params */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="card">
              <SectionHead title={`${names.r1} Parameters`} />
              <KVRow label="RPM"          value={`${safeStr(latest.r1_rpm)} rpm`}  mono />
              <KVRow label="Radius"       value={`${safeStr(latest.r1_rad)} mm`}   mono />
              <KVRow label="Min distance" value={`${safeStr(latest.r1_min_d)} mm`} mono />
              <KVRow label="Max distance" value={`${safeStr(latest.r1_max_d)} mm`} mono />
              <KVRow label="Steps"        value={safeStr(latest.r1_n_steps)}        mono />
              <KVRow label="Step size"    value={`${safeStr(latest.r1_step)} mm`}   mono />
            </div>
            <div className="card">
              <SectionHead title={`${names.r2} Parameters`} />
              <KVRow label="RPM"          value={`${safeStr(latest.r2_rpm)} rpm`}  mono />
              <KVRow label="Radius"       value={`${safeStr(latest.r2_rad)} mm`}   mono />
              <KVRow label="Min distance" value={`${safeStr(latest.r2_min_d)} mm`} mono />
              <KVRow label="Max distance" value={`${safeStr(latest.r2_max_d)} mm`} mono />
              <KVRow label="Steps"        value={safeStr(latest.r2_n_steps)}        mono />
              <KVRow label="Step size"    value={`${safeStr(latest.r2_step)} mm`}   mono />
            </div>
          </div>

          {/* Last events */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="card">
              <SectionHead title="Last Meas. Started" />
              {lastStart ? (
                <>
                  <KVRow label="Datetime" value={fmtDt(lastStart.datetime)} mono />
                  <KVRow label="Roll"     value={safeStr(lastStart.rollid)} mono />
                  <KVRow label="Sys ID"   value={safeStr(lastStart.sysid)}  mono />
                </>
              ) : <div style={{ fontSize: '12px', color: '#cbd5e1' }}>No events found.</div>}
            </div>
            <div className="card">
              <SectionHead title="Last Meas. Finished" />
              {lastFinish ? (
                <>
                  <KVRow label="Datetime" value={fmtDt(lastFinish.datetime)} mono />
                  <KVRow label="Roll"     value={safeStr(lastFinish.rollid)} mono />
                  <KVRow label="Sys ID"   value={safeStr(lastFinish.sysid)}  mono />
                </>
              ) : <div style={{ fontSize: '12px', color: '#cbd5e1' }}>No events found.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
