/**
 * DateRangePicker.jsx
 * Custom date+time picker — no third-party calendar library.
 * Uses native HTML <input type="date"> and <input type="time">
 * which render as proper OS-native pickers with zero overlap issues.
 */
import React from 'react'

function toLocalDateString(date) {
  if (!date) return ''
  // Format as YYYY-MM-DD for input[type=date]
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function toLocalTimeString(date) {
  if (!date) return '00:00'
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

function mergeDateAndTime(dateStr, timeStr) {
  if (!dateStr) return null
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hours, minutes]   = (timeStr || '00:00').split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes, 0)
}

const inputStyle = {
  background: '#f8fafc',
  border: '1.5px solid #bfdbfe',
  borderRadius: '8px',
  padding: '8px 12px',
  color: '#1e293b',
  fontSize: '13px',
  fontFamily: '"DM Sans", sans-serif',
  outline: 'none',
  cursor: 'pointer',
  height: '38px',
}

const labelStyle = {
  fontSize: '11px',
  fontWeight: '700',
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: '6px',
  display: 'block',
}

function DateTimeInput({ label, value, onChange, min, max }) {
  const dateStr = toLocalDateString(value)
  const timeStr = toLocalTimeString(value)

  function handleDateChange(e) {
    const newDate = mergeDateAndTime(e.target.value, timeStr)
    if (newDate) onChange(newDate)
  }

  function handleTimeChange(e) {
    const newDate = mergeDateAndTime(dateStr, e.target.value)
    if (newDate) onChange(newDate)
  }

  return (
    <div>
      <span style={labelStyle}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Date selector — opens native OS calendar */}
        <input
          type="date"
          value={dateStr}
          min={min ? toLocalDateString(min) : undefined}
          max={max ? toLocalDateString(max) : undefined}
          onChange={handleDateChange}
          style={{ ...inputStyle, width: '150px' }}
          onFocus={e => e.target.style.borderColor = '#3b82f6'}
          onBlur={e  => e.target.style.borderColor = '#bfdbfe'}
        />
        {/* Time selector — opens native OS time picker */}
        <input
          type="time"
          value={timeStr}
          onChange={handleTimeChange}
          style={{ ...inputStyle, width: '100px' }}
          onFocus={e => e.target.style.borderColor = '#3b82f6'}
          onBlur={e  => e.target.style.borderColor = '#bfdbfe'}
        />
      </div>
    </div>
  )
}

export default function DateRangePicker({ from, to, onFromChange, onToChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '16px', marginBottom: '16px' }}>
      <DateTimeInput
        label="From"
        value={from}
        onChange={onFromChange}
        max={to || new Date()}
      />
      <div style={{ color: '#cbd5e1', fontSize: '20px', paddingBottom: '4px' }}>→</div>
      <DateTimeInput
        label="To"
        value={to}
        onChange={onToChange}
        min={from}
        max={new Date()}
      />
    </div>
  )
}
