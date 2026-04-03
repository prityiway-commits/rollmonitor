/**
 * HistoricalData.jsx
 * Shows historical status records + measurement events with date range filter.
 */
import React, { useState, useCallback } from 'react'
import { subHours } from 'date-fns'
import { fetchStatusHistory, fetchMeasStarted, fetchMeasFinished, toArray } from '../services/api'
import { Spinner, ErrorBanner, SectionHead, EmptyState } from '../components'
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

function parseTemps(info) {
  if (!info) return { cpu: null, sensor: null }
  const s = String(info)
  const c = s.match(/CpuTemp:\s*([\d.]+)/)
  const t = s.match(/SensorTemp:\s*([\d.]+)/)
  return { cpu: c ? parseFloat(c[1]) : null, sensor: t ? parseFloat(t[1]) : null }
}

function StatusBadge({ status }) {
  const ok = safeStr(status).toUpperCase() === 'OK'
  return (
    <span style={{
      fontSize: '11px', fontWeight: '700', padding: '2px 10px', borderRadius: '20px',
      background: ok ? '#dcfce7' : '#fee2e2',
      color:      ok ? '#166534' : '#991b1b',
      border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`,
    }}>{ok ? 'OK' : 'NOK'}</span>
  )
}

export default function HistoricalData() {
  const [sysid, setSysId] = useSysId()
  const { names } = useRollNames()
  const [from, setFrom] = useState(subHours(new Date(), 24))
  const [to,   setTo]   = useState(new Date())

  const [histLoading, setHistLoading] = useState(false)
  const [histData,    setHistData]    = useState(null)
  const [histError,   setHistError]   = useState(null)

  const [evtLoading, setEvtLoading] = useState(false)
  const [startData,  setStartData]  = useState(null)
  const [finishData, setFinishData] = useState(null)
  const [evtError,   setEvtError]   = useState(null)

  const loadAll = useCallback(async () => {
    if (!from || !to) return
    const fromISO = from.toISOString()
    const toISO   = to.toISOString()

    // Load status history
    setHistLoading(true); setHistError(null); setHistData(null)
    const { data: hd, error: he } = await fetchStatusHistory(sysid, fromISO, toISO)
    setHistData(toArray(hd).filter(r => r.sysid && r.sysid !== 'unknown'))
    setHistError(he)
    setHistLoading(false)

    // Load measurement events
    setEvtLoading(true); setEvtError(null)
    const [sr, fr] = await Promise.all([
      fetchMeasStarted(sysid, fromISO, toISO),
      fetchMeasFinished(sysid, fromISO, toISO),
    ])
    setStartData(toArray(sr.data))
    setFinishData(toArray(fr.data))
    setEvtError(sr.error || fr.error)
    setEvtLoading(false)
  }, [sysid, from, to])

  const totalLoading = histLoading || evtLoading

  return (
    <div style={{ maxWidth: '1000px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1e293b', margin: 0 }}>Historical Data</h2>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>
            Status records and measurement events over time
          </div>
        </div>
        <SysIdSelector value={sysid} onChange={setSysId} />
      </div>

      {/* Date range + load */}
      <div className="card">
        <SectionHead
          title="Date Range"
          action={
            <button className="btn-primary" style={{ fontSize: '12px', padding: '7px 16px' }}
              onClick={loadAll} disabled={totalLoading}>
              {totalLoading ? <Spinner size="sm" /> : '↻ Load Data'}
            </button>
          }
        />
        <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>
          Querying <span style={{ fontFamily: 'monospace', color: '#1d4ed8' }}>{sysid}</span> — select a range and click Load Data.
        </div>
      </div>

      <ErrorBanner message={histError || evtError} />

      {/* Status history table */}
      <div className="card">
        <SectionHead title={`Status History ${histData ? `(${histData.length} records)` : ''}`} />

        {histLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><Spinner /></div>}

        {!histLoading && histData && histData.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Datetime</th>
                  <th>Status</th>
                  <th>CPU Temp</th>
                  <th>Sensor Temp</th>
                  <th>{names.r1} RPM</th>
                  <th>{names.r2} RPM</th>
                  <th>{names.r1} Radius</th>
                  <th>Conf</th>
                  <th>Event</th>
                </tr>
              </thead>
              <tbody>
                {histData.map((row, i) => {
                  const t = parseTemps(row.info_status)
                  const isTemp  = row.info_status && String(row.info_status).includes('CpuTemp')
                  const isEvent = row.info_status && !isTemp && String(row.info_status).trim() !== '' && String(row.info_status) !== 'No error'
                  return (
                    <tr key={i}>
                      <td style={{ fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>{fmtDt(row.datetime)}</td>
                      <td><StatusBadge status={row.status} /></td>
                      <td style={{ fontFamily: 'monospace' }}>{t.cpu !== null ? `${t.cpu}°C` : '—'}</td>
                      <td style={{ fontFamily: 'monospace' }}>{t.sensor !== null ? `${t.sensor}°C` : '—'}</td>
                      <td style={{ fontFamily: 'monospace' }}>{row.r1_rpm || '—'}</td>
                      <td style={{ fontFamily: 'monospace' }}>{row.r2_rpm || '—'}</td>
                      <td style={{ fontFamily: 'monospace' }}>{row.r1_rad || '—'}</td>
                      <td>
                        {row.conf == 1
                          ? <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', background: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' }}>Valid</span>
                          : <span style={{ fontSize: '10px', color: '#94a3b8' }}>—</span>}
                      </td>
                      <td style={{ fontSize: '11px', color: isEvent ? '#1e40af' : '#94a3b8', maxWidth: '180px' }}>
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
          <EmptyState icon="📅" title="No status records"
            message="No records found in the selected date range. Try widening the range." />
        )}

        {!histLoading && !histData && (
          <div style={{ fontSize: '13px', color: '#94a3b8', padding: '16px 0' }}>
            Select a date range above and click Load Data.
          </div>
        )}
      </div>

      {/* Measurement events */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        {/* Started events */}
        <div className="card">
          <SectionHead title={`Measurement Started ${startData ? `(${startData.length})` : ''}`} />
          {evtLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}><Spinner /></div>}
          {!evtLoading && startData && startData.length > 0 && (
            <div>
              {startData.map((e, i) => {
                const rName = e.rollid == 1 ? names.r1 : e.rollid == 2 ? names.r2 : `Roll ${safeStr(e.rollid)}`
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', whiteSpace: 'nowrap' }}>Started</span>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#334155' }}>{rName}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>{fmtDt(e.datetime)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {!evtLoading && startData && startData.length === 0 && (
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>No measurement start events in this range.</div>
          )}
          {!evtLoading && !startData && <div style={{ fontSize: '12px', color: '#94a3b8' }}>Load data to see events.</div>}
        </div>

        {/* Finished events */}
        <div className="card">
          <SectionHead title={`Measurement Finished ${finishData ? `(${finishData.length})` : ''}`} />
          {evtLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}><Spinner /></div>}
          {!evtLoading && finishData && finishData.length > 0 && (
            <div>
              {finishData.map((e, i) => {
                const rName = e.rollid == 1 ? names.r1 : e.rollid == 2 ? names.r2 : `Roll ${safeStr(e.rollid)}`
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', whiteSpace: 'nowrap' }}>Finished</span>
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: '#334155' }}>{rName}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>{fmtDt(e.datetime)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {!evtLoading && finishData && finishData.length === 0 && (
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>No measurement finish events in this range.</div>
          )}
          {!evtLoading && !finishData && <div style={{ fontSize: '12px', color: '#94a3b8' }}>Load data to see events.</div>}
        </div>
      </div>
    </div>
  )
}
