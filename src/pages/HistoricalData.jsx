/**
 * HistoricalData.jsx
 * Scrollable table — 5 columns: Date & Time | Status | CPU Temp | Sensor Temp | Event
 * All times in browser local timezone.
 */
import React, { useState, useCallback } from 'react'
import { subHours } from 'date-fns'
import { fetchStatusHistory, fetchMeasStarted, fetchMeasFinished, toArray } from '../services/api'
import { Spinner, ErrorBanner, SectionHead, EmptyState } from '../components'
import DateRangePicker from '../components/DateRangePicker'
import SysIdSelector, { useSysId } from '../components/SysIdSelector'

function safeStr(val) {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

// Parse PLC datetime (UTC string or epoch ms) → JS Date
function parseDt(val) {
  if (!val) return null
  const num = Number(val)
  if (!isNaN(num) && num > 1000000000000) return new Date(num)
  const s = String(val)
  const parts = s.split('-')
  if (parts.length >= 4) {
    const iso = `${parts[0]}-${parts[1]}-${parts[2]}T${parts.slice(3).join('-')}Z`
    const d = new Date(iso)
    if (!isNaN(d)) return d
  }
  return null
}

// Format in local timezone
function fmtLocal(val) {
  const d = parseDt(val)
  if (!d) return safeStr(val).slice(0, 19)
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
}

function parseTemps(info) {
  if (!info) return { cpu: null, sensor: null }
  const s = String(info)
  const c = s.match(/CpuTemp:\s*([\d.]+)/)
  const t = s.match(/SensorTemp:\s*([\d.]+)/)
  return { cpu: c ? parseFloat(c[1]) : null, sensor: t ? parseFloat(t[1]) : null }
}

function parseEvent(info) {
  if (!info) return null
  const s = String(info).trim()
  if (!s || s === 'No error' || s.includes('CpuTemp')) return null
  return s
}

function StatusBadge({ status }) {
  const ok = safeStr(status).toUpperCase() === 'OK'
  return (
    <span style={{
      fontSize: '11px', fontWeight: '700', padding: '2px 10px', borderRadius: '20px',
      background: ok ? '#dcfce7' : '#fee2e2',
      color:      ok ? '#166534' : '#991b1b',
      border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`,
      whiteSpace: 'nowrap',
    }}>{ok ? 'OK' : 'NOK'}</span>
  )
}

export default function HistoricalData() {
  const [sysid, setSysId] = useSysId()
  const [from, setFrom]   = useState(subHours(new Date(), 24))
  const [to,   setTo]     = useState(new Date())

  const [histLoading, setHistLoading] = useState(false)
  const [histData,    setHistData]    = useState(null)
  const [histError,   setHistError]   = useState(null)

  const [evtLoading,  setEvtLoading]  = useState(false)
  const [startData,   setStartData]   = useState(null)
  const [finishData,  setFinishData]  = useState(null)
  const [evtError,    setEvtError]    = useState(null)

  const loadAll = useCallback(async () => {
    if (!from || !to) return
    const fromISO = from.toISOString()
    const toISO   = to.toISOString()

    setHistLoading(true); setHistError(null); setHistData(null)
    const { data: hd, error: he } = await fetchStatusHistory(sysid, fromISO, toISO)
    setHistData(toArray(hd).filter(r => r.sysid && r.sysid !== 'unknown'))
    setHistError(he)
    setHistLoading(false)

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

  const thStyle = {
    padding: '10px 14px',
    fontSize: '11px', fontWeight: '700',
    color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em',
    background: '#f8fafc', borderBottom: '2px solid #e2e8f0',
    position: 'sticky', top: 0, zIndex: 1,
    whiteSpace: 'nowrap', textAlign: 'left',
  }
  const tdStyle = {
    padding: '9px 14px', fontSize: '12px',
    color: '#334155', borderBottom: '1px solid #f1f5f9',
    verticalAlign: 'middle',
  }

  return (
    <div style={{ maxWidth: '1000px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1e293b', margin: 0 }}>Historical Data</h2>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>Status records and measurement events</div>
        </div>
        <SysIdSelector value={sysid} onChange={setSysId} />
      </div>

      {/* Date range */}
      <div className="card">
        <SectionHead
          title="Date Range"
          action={
            <button className="btn-primary" style={{ fontSize: '12px', padding: '7px 16px' }}
              onClick={loadAll} disabled={histLoading || evtLoading}>
              {histLoading || evtLoading ? <Spinner size="sm" /> : '↻ Load Data'}
            </button>
          }
        />
        <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>
          Querying <span style={{ fontFamily: 'monospace', color: '#1d4ed8' }}>{sysid}</span> · All times in local timezone (IST)
        </div>
      </div>

      <ErrorBanner message={histError || evtError} />

      {/* Scrollable status table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b' }}>
            Status History {histData ? `(${histData.length} records)` : ''}
          </div>
          {histData && histData.length > 0 && (
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Scroll to see all records</div>
          )}
        </div>

        {histLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
            <Spinner />
          </div>
        )}

        {!histLoading && histData && histData.length > 0 && (
          <div style={{ overflowY: 'auto', maxHeight: '500px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Date & Time</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>CPU Temp</th>
                  <th style={thStyle}>Sensor Temp</th>
                  <th style={thStyle}>Event</th>
                </tr>
              </thead>
              <tbody>
                {histData.map((row, i) => {
                  const t     = parseTemps(row.info_status)
                  const event = parseEvent(row.info_status)
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
                        {fmtLocal(row.datetime)}
                      </td>
                      <td style={tdStyle}>
                        <StatusBadge status={row.status} />
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace' }}>
                        {t.cpu !== null ? `${t.cpu}°C` : '—'}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace' }}>
                        {t.sensor !== null ? `${t.sensor}°C` : '—'}
                      </td>
                      <td style={{ ...tdStyle, fontSize: '11px', color: event ? '#1e40af' : '#94a3b8', maxWidth: '200px' }}>
                        {event || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!histLoading && histData && histData.length === 0 && (
          <div style={{ padding: '20px' }}>
            <EmptyState icon="📅" title="No status records"
              message="No records found in the selected date range. Try widening the range." />
          </div>
        )}

        {!histLoading && !histData && (
          <div style={{ fontSize: '13px', color: '#94a3b8', padding: '20px' }}>
            Select a date range above and click Load Data.
          </div>
        )}
      </div>

      {/* Measurement events */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        {/* Started */}
        <div className="card">
          <SectionHead title={`Measurement Started ${startData ? `(${startData.length})` : ''}`} />
          {evtLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}><Spinner /></div>}
          {!evtLoading && startData && startData.length > 0 && (
            <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
              {startData.map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe', whiteSpace: 'nowrap' }}>
                    Started
                  </span>
                  <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                    {fmtLocal(e.datetime)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!evtLoading && startData && startData.length === 0 && (
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>No start events in this range.</div>
          )}
          {!evtLoading && !startData && (
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Load data to see events.</div>
          )}
        </div>

        {/* Finished */}
        <div className="card">
          <SectionHead title={`Measurement Finished ${finishData ? `(${finishData.length})` : ''}`} />
          {evtLoading && <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}><Spinner /></div>}
          {!evtLoading && finishData && finishData.length > 0 && (
            <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
              {finishData.map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', whiteSpace: 'nowrap' }}>
                    Finished
                  </span>
                  <div style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace' }}>
                    {fmtLocal(e.datetime)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!evtLoading && finishData && finishData.length === 0 && (
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>No finish events in this range.</div>
          )}
          {!evtLoading && !finishData && (
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Load data to see events.</div>
          )}
        </div>
      </div>
    </div>
  )
}
