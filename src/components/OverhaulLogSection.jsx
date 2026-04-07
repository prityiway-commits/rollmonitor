/**
 * OverhaulLogSection.jsx
 * Full overhaul log with 11-position diameter measurements at 0° and 180°
 *
 * Fields per entry:
 *   - Overhaul date
 *   - Roller length (mm) → drives 11 position calculation
 *   - Stoppage reason (Overhaul / Scheduled Maintenance / Emergency / Other)
 *   - Notes
 *   - Diameter at 11 positions × 2 angles (0° and 180°)
 *
 * Behaviour:
 *   - Stoppage reason = Overhaul → reference date auto-updates
 *   - Roller length updates Analytics Settings
 *   - All entries editable inline
 *   - Chart shown comparing current vs previous overhaul
 */
import React, { useState, useMemo } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import {
  addOverhaul, updateOverhaul, deleteOverhaul,
  loadOverhaulLog, saveReference,
  computeMeasPositions, computeConcavity,
  saveSettings,
} from '../services/analytics'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend)

const STOPPAGE_REASONS = [
  'Overhaul',
  'Scheduled Maintenance',
  'Emergency Stop',
  'Re-profiling',
  'Other',
]

function fmt2(v) { return typeof v === 'number' && !isNaN(v) ? v.toFixed(2) : '—' }

// Empty 11-position reading array
const emptyReadings = () => new Array(11).fill('')

// ── Measurement input grid ────────────────────────────────────
function MeasGrid({ positions, readings0, readings180, onChange0, onChange180, disabled }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: '10px' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: '12px', minWidth: '700px', width: '100%' }}>
        <thead>
          <tr>
            <th style={thStyle}>Angle</th>
            {positions.map((p, i) => (
              <th key={i} style={{ ...thStyle, fontFamily: 'monospace', fontWeight: '600', color: '#1d4ed8' }}>
                P{i+1}<br/>
                <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: '400' }}>{p}mm</span>
              </th>
            ))}
            <th style={thStyle}>Concavity</th>
          </tr>
        </thead>
        <tbody>
          {/* 0° row */}
          <tr>
            <td style={{ ...tdStyle, fontWeight: '700', color: '#1e40af', background: '#eff6ff', whiteSpace: 'nowrap' }}>
              0°
            </td>
            {readings0.map((val, i) => (
              <td key={i} style={tdStyle}>
                <input
                  type="number" value={val} disabled={disabled}
                  onChange={e => onChange0(i, e.target.value)}
                  style={inputStyle}
                  placeholder="—"
                />
              </td>
            ))}
            <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: '600', color: '#dc2626', whiteSpace: 'nowrap' }}>
              {(() => {
                const c = computeConcavity(readings0)
                return c !== null ? `${fmt2(c)}mm` : '—'
              })()}
            </td>
          </tr>
          {/* 180° row */}
          <tr>
            <td style={{ ...tdStyle, fontWeight: '700', color: '#166534', background: '#f0fdf4', whiteSpace: 'nowrap' }}>
              180°
            </td>
            {readings180.map((val, i) => (
              <td key={i} style={tdStyle}>
                <input
                  type="number" value={val} disabled={disabled}
                  onChange={e => onChange180(i, e.target.value)}
                  style={inputStyle}
                  placeholder="—"
                />
              </td>
            ))}
            <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: '600', color: '#dc2626', whiteSpace: 'nowrap' }}>
              {(() => {
                const c = computeConcavity(readings180)
                return c !== null ? `${fmt2(c)}mm` : '—'
              })()}
            </td>
          </tr>
          {/* Avg row */}
          <tr style={{ background: '#f8fafc' }}>
            <td style={{ ...tdStyle, fontWeight: '700', color: '#64748b' }}>Avg</td>
            {readings0.map((v0, i) => {
              const v1 = readings180[i]
              const avg = (parseFloat(v0) + parseFloat(v1)) / 2
              return (
                <td key={i} style={{ ...tdStyle, fontFamily: 'monospace', color: '#64748b', fontSize: '11px' }}>
                  {!isNaN(avg) ? avg.toFixed(1) : '—'}
                </td>
              )
            })}
            <td style={tdStyle} />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ── Wear profile comparison chart ─────────────────────────────
function WearProfileChart({ entries, rollName }) {
  if (entries.length < 1) return null

  // Last 3 entries for comparison
  const shown = entries.slice(0, 3)
  const positions = computeMeasPositions(shown[0].rollerLength || 1400)
  const labels = positions.map(p => `${p}mm`)

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444']

  const datasets = shown.flatMap((entry, ei) => {
    const ds = []
    const r0 = entry.readings0 || []
    const r180 = entry.readings180 || []

    const avg0 = r0.map(v => parseFloat(v)).filter(v => !isNaN(v))
    const avg180 = r180.map(v => parseFloat(v)).filter(v => !isNaN(v))

    if (avg0.length === 11) {
      ds.push({
        label: `${entry.date} — 0°`,
        data: r0.map(v => parseFloat(v) || null),
        borderColor: colors[ei],
        backgroundColor: 'transparent',
        borderWidth: 2, pointRadius: 4, tension: 0.3,
        borderDash: [],
      })
    }
    if (avg180.length === 11) {
      ds.push({
        label: `${entry.date} — 180°`,
        data: r180.map(v => parseFloat(v) || null),
        borderColor: colors[ei],
        backgroundColor: 'transparent',
        borderWidth: 1.5, pointRadius: 3, tension: 0.3,
        borderDash: [5, 3],
      })
    }
    return ds
  })

  if (!datasets.length) return null

  const data = { labels, datasets }
  const opts = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: {
      legend: { display: true, labels: { color: '#64748b', font: { size: 11 }, boxWidth: 12 } },
      tooltip: {
        backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#94a3b8',
        borderColor: '#334155', borderWidth: 1,
        callbacks: {
          title: items => `Position: ${labels[items[0].dataIndex]}`,
          label: item  => ` ${item.dataset.label}: ${item.raw}mm`,
        }
      },
    },
    scales: {
      x: {
        ticks: { color: '#94a3b8', font: { size: 10 }, maxRotation: 45 },
        grid:  { color: '#f1f5f9' },
        title: { display: true, text: 'Position along roller width (mm)', color: '#94a3b8', font: { size: 11 } },
      },
      y: {
        ticks: { color: '#94a3b8', font: { size: 10 } },
        grid:  { color: '#f1f5f9' },
        title: { display: true, text: 'Diameter (mm)', color: '#94a3b8', font: { size: 11 } },
      },
    },
  }

  return (
    <div style={{ marginTop: '20px', padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginBottom: '4px' }}>
        Diameter Profile — {rollName}
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '12px' }}>
        Solid lines = 0° · Dashed lines = 180° · Shows last {shown.length} overhaul measurements
      </div>
      <div style={{ height: '260px' }}>
        <Line data={data} options={opts} />
      </div>
    </div>
  )
}

// ── Add/Edit form ─────────────────────────────────────────────
function OverhaulForm({ initial, onSave, onCancel, settings, sysid, rollid, rollName }) {
  const [form, setForm] = useState(() => ({
    date:           initial?.date           || new Date().toISOString().slice(0, 10),
    rollerLength:   initial?.rollerLength   || (rollid === 1 ? (settings.rollerLengthR1 || 1400) : (settings.rollerLengthR2 || 1400)),
    stoppageReason: initial?.stoppageReason || 'Overhaul',
    notes:          initial?.notes          || '',
    readings0:      initial?.readings0      || emptyReadings(),
    readings180:    initial?.readings180    || emptyReadings(),
  }))

  const positions = useMemo(() => computeMeasPositions(form.rollerLength), [form.rollerLength])

  function setR0(i, v) { const r = [...form.readings0]; r[i] = v; setForm(p => ({ ...p, readings0: r })) }
  function setR180(i, v) { const r = [...form.readings180]; r[i] = v; setForm(p => ({ ...p, readings180: r })) }

  const conc0   = computeConcavity(form.readings0)
  const conc180 = computeConcavity(form.readings180)

  return (
    <div style={{ padding: '16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', marginBottom: '16px' }}>

      {/* Basic fields */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', marginBottom: '14px' }}>
        <div>
          <div style={labelStyle}>Overhaul date *</div>
          <input type="date" value={form.date}
            onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
            style={fieldStyle} />
        </div>
        <div>
          <div style={labelStyle}>Roller length (mm) *</div>
          <input type="number" value={form.rollerLength} min={100} max={10000}
            onChange={e => setForm(p => ({ ...p, rollerLength: parseFloat(e.target.value) || 1400 }))}
            style={{ ...fieldStyle, fontFamily: 'monospace' }} />
        </div>
        <div>
          <div style={labelStyle}>Stoppage reason *</div>
          <select value={form.stoppageReason}
            onChange={e => setForm(p => ({ ...p, stoppageReason: e.target.value }))}
            style={{ ...fieldStyle, cursor: 'pointer' }}>
            {STOPPAGE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <div style={labelStyle}>Notes</div>
          <input type="text" value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            placeholder="Optional notes"
            style={fieldStyle} />
        </div>
      </div>

      {/* Stoppage = Overhaul notice */}
      {form.stoppageReason === 'Overhaul' && (
        <div style={{ padding: '8px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', fontSize: '12px', color: '#1e40af', marginBottom: '12px' }}>
          ℹ Reference date will auto-update to <strong>{form.date}</strong> when saved.
          Roller length ({form.rollerLength}mm) will update Analytics Settings.
        </div>
      )}

      {/* Measurement grid */}
      <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
        Diameter measurements at 11 positions (mm)
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>
        Positions: {positions.map(p => `${p}mm`).join(' · ')}
      </div>

      <MeasGrid
        positions={positions}
        readings0={form.readings0}
        readings180={form.readings180}
        onChange0={setR0}
        onChange180={setR180}
        disabled={false}
      />

      {/* Auto-calculated summary */}
      {(conc0 !== null || conc180 !== null) && (
        <div style={{ display: 'flex', gap: '16px', marginTop: '10px', padding: '10px 14px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
          {conc0 !== null && (
            <div style={{ fontSize: '12px' }}>
              <span style={{ color: '#94a3b8' }}>Concavity 0°: </span>
              <strong style={{ color: '#dc2626', fontFamily: 'monospace' }}>{fmt2(conc0)}mm</strong>
            </div>
          )}
          {conc180 !== null && (
            <div style={{ fontSize: '12px' }}>
              <span style={{ color: '#94a3b8' }}>Concavity 180°: </span>
              <strong style={{ color: '#dc2626', fontFamily: 'monospace' }}>{fmt2(conc180)}mm</strong>
            </div>
          )}
          {conc0 !== null && conc180 !== null && (
            <div style={{ fontSize: '12px' }}>
              <span style={{ color: '#94a3b8' }}>Avg concavity: </span>
              <strong style={{ color: '#dc2626', fontFamily: 'monospace' }}>{fmt2((conc0 + conc180) / 2)}mm</strong>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
        <button className="btn-primary" style={{ fontSize: '12px' }} onClick={() => onSave(form)}>
          💾 Save Overhaul
        </button>
        <button className="btn-secondary" style={{ fontSize: '12px' }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Entry row (collapsed view) ────────────────────────────────
function OverhaulEntry({ entry, positions, onEdit, onDelete, isExpanded, onToggle }) {
  const conc0   = computeConcavity(entry.readings0 || [])
  const conc180 = computeConcavity(entry.readings180 || [])
  const hasData = (entry.readings0 || []).some(v => v !== '' && v !== null)

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', marginBottom: '10px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: '#fff', cursor: 'pointer' }}
        onClick={onToggle}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', fontFamily: 'monospace' }}>{entry.date}</span>
          <span style={{
            fontSize: '10px', fontWeight: '700', padding: '2px 10px', borderRadius: '20px',
            background: entry.stoppageReason === 'Overhaul' ? '#eff6ff' : '#f0fdf4',
            color:      entry.stoppageReason === 'Overhaul' ? '#1e40af' : '#166534',
            border: `1px solid ${entry.stoppageReason === 'Overhaul' ? '#bfdbfe' : '#bbf7d0'}`,
          }}>{entry.stoppageReason}</span>
          {entry.rollerLength && (
            <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>L={entry.rollerLength}mm</span>
          )}
          {conc0 !== null && (
            <span style={{ fontSize: '11px', color: '#dc2626', fontFamily: 'monospace' }}>
              Conc: {fmt2(conc0)}mm / {fmt2(conc180)}mm
            </span>
          )}
          {entry.notes && <span style={{ fontSize: '11px', color: '#64748b' }}>{entry.notes}</span>}
          {!hasData && <span style={{ fontSize: '10px', color: '#94a3b8', padding: '1px 6px', background: '#f8fafc', borderRadius: '4px', border: '1px solid #e2e8f0' }}>No measurements</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={e => { e.stopPropagation(); onEdit() }}
            style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '6px', border: '1px solid #bfdbfe', background: '#eff6ff', cursor: 'pointer', color: '#1e40af' }}>
            ✏️ Edit
          </button>
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '6px', border: '1px solid #fecaca', background: '#fff5f5', cursor: 'pointer', color: '#dc2626' }}>
            🗑
          </button>
          <span style={{ fontSize: '16px', color: '#94a3b8', minWidth: '16px' }}>{isExpanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded: measurement table */}
      {isExpanded && hasData && (
        <div style={{ padding: '0 16px 16px', background: '#f8fafc', borderTop: '1px solid #f1f5f9' }}>
          <MeasGrid
            positions={positions}
            readings0={entry.readings0 || emptyReadings()}
            readings180={entry.readings180 || emptyReadings()}
            onChange0={() => {}} onChange180={() => {}}
            disabled={true}
          />
        </div>
      )}
      {isExpanded && !hasData && (
        <div style={{ padding: '12px 16px', background: '#f8fafc', borderTop: '1px solid #f1f5f9', fontSize: '12px', color: '#94a3b8' }}>
          No diameter measurements recorded for this entry.
        </div>
      )}
    </div>
  )
}

// ── Main exported component ───────────────────────────────────
export default function OverhaulLogSection({
  sysid, rollid, rollName, settings, prediction,
  onReferenceUpdated, onSettingsUpdated,
}) {
  const [log,         setLog]         = useState(() => loadOverhaulLog().filter(e => e.sysid === sysid && String(e.rollid) === String(rollid)))
  const [showForm,    setShowForm]    = useState(false)
  const [editEntry,   setEditEntry]   = useState(null) // entry being edited
  const [expandedId,  setExpandedId]  = useState(null)

  function reloadLog() {
    setLog(loadOverhaulLog().filter(e => e.sysid === sysid && String(e.rollid) === String(rollid)))
  }

  function handleSave(form) {
    const entry = {
      ...form,
      sysid,
      rollid,
      wearAtOverhaul: prediction?.currentWear ?? null,
    }

    if (editEntry) {
      updateOverhaul(editEntry.id, entry)
    } else {
      addOverhaul(entry)
    }

    // If Overhaul → update reference date and roller length in settings
    if (form.stoppageReason === 'Overhaul') {
      saveReference(sysid, rollid, form.date, `Auto from overhaul log ${form.date}`)
      const key = rollid === 1 ? 'rollerLengthR1' : 'rollerLengthR2'
      saveSettings({ ...settings, [key]: parseFloat(form.rollerLength) })
      if (onReferenceUpdated) onReferenceUpdated(form.date)
      if (onSettingsUpdated)  onSettingsUpdated()
    }

    reloadLog()
    setShowForm(false)
    setEditEntry(null)
  }

  function handleDelete(id) {
    if (!window.confirm('Delete this overhaul entry? This cannot be undone.')) return
    deleteOverhaul(id)
    reloadLog()
  }

  // Positions for the most recent entry (or default)
  const latestLength = log[0]?.rollerLength || (rollid === 1 ? settings.rollerLengthR1 : settings.rollerLengthR2) || 1400
  const positions    = computeMeasPositions(latestLength)

  // Interval analysis
  const intervals = useMemo(() => {
    if (log.length < 2) return []
    return log.slice(0, -1).map((e, i) => {
      const d1 = new Date(log[i+1].date)
      const d2 = new Date(e.date)
      return { from: log[i+1].date, to: e.date, days: Math.round((d2-d1)/86400000) }
    })
  }, [log])

  const avgInterval = intervals.length ? Math.round(intervals.reduce((s, i) => s + i.days, 0) / intervals.length) : null

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#1e293b' }}>Overhaul Log — {rollName}</div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
            Diameter measurements at 11 positions · 0° and 180°
          </div>
        </div>
        <button className="btn-secondary" style={{ fontSize: '12px' }}
          onClick={() => { setShowForm(!showForm); setEditEntry(null) }}>
          {showForm ? '✕ Cancel' : '+ Log Overhaul'}
        </button>
      </div>

      {/* Add form */}
      {showForm && !editEntry && (
        <OverhaulForm
          initial={null}
          onSave={handleSave}
          onCancel={() => setShowForm(false)}
          settings={settings}
          sysid={sysid}
          rollid={rollid}
          rollName={rollName}
        />
      )}

      {/* Edit form */}
      {editEntry && (
        <OverhaulForm
          initial={editEntry}
          onSave={handleSave}
          onCancel={() => setEditEntry(null)}
          settings={settings}
          sysid={sysid}
          rollid={rollid}
          rollName={rollName}
        />
      )}

      {/* Log entries */}
      {log.length === 0 ? (
        <div style={{ fontSize: '13px', color: '#94a3b8', padding: '8px 0' }}>
          No overhaul entries yet. Click <strong style={{ color: '#1d4ed8' }}>+ Log Overhaul</strong> to record the first entry.
        </div>
      ) : (
        <>
          {log.map(entry => (
            <OverhaulEntry
              key={entry.id}
              entry={entry}
              positions={computeMeasPositions(entry.rollerLength || latestLength)}
              onEdit={() => { setEditEntry(entry); setShowForm(false) }}
              onDelete={() => handleDelete(entry.id)}
              isExpanded={expandedId === entry.id}
              onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
            />
          ))}

          {/* Interval stats */}
          {intervals.length > 0 && (
            <div style={{ padding: '14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', marginTop: '8px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
                Overhaul Interval Analysis
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px', marginBottom: '10px' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: '700', color: '#1e40af' }}>{avgInterval}</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>Avg days between overhauls</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: '700', color: '#1e40af' }}>{Math.min(...intervals.map(i=>i.days))}</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>Min interval (days)</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '22px', fontWeight: '700', color: '#1e40af' }}>{Math.max(...intervals.map(i=>i.days))}</div>
                  <div style={{ fontSize: '11px', color: '#64748b' }}>Max interval (days)</div>
                </div>
              </div>
              {intervals.map((iv, i) => (
                <div key={i} style={{ fontSize: '11px', color: '#64748b', fontFamily: 'monospace', marginBottom: '2px' }}>
                  {iv.from} → {iv.to}: {iv.days} days
                </div>
              ))}
            </div>
          )}

          {/* Wear profile chart */}
          <WearProfileChart entries={log} rollName={rollName} />
        </>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────
const thStyle = {
  padding: '6px 8px', background: '#f8fafc',
  border: '1px solid #e2e8f0', textAlign: 'center',
  fontSize: '11px', color: '#64748b', fontWeight: '600',
  whiteSpace: 'nowrap',
}
const tdStyle = {
  padding: '4px 6px', border: '1px solid #f1f5f9',
  textAlign: 'center', fontSize: '12px',
}
const inputStyle = {
  width: '62px', padding: '4px 4px', fontSize: '12px',
  border: '1px solid #e2e8f0', borderRadius: '4px',
  textAlign: 'center', background: '#fff', color: '#1e293b',
  fontFamily: 'monospace', outline: 'none',
}
const labelStyle = {
  fontSize: '11px', fontWeight: '700', color: '#64748b',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px',
}
const fieldStyle = {
  padding: '8px 10px', fontSize: '13px', width: '100%',
  border: '1.5px solid #e2e8f0', borderRadius: '8px',
  background: '#fff', color: '#1e293b', outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
}
