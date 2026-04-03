/**
 * SysIdSelector.jsx
 * Dropdown to select the active device (sysid).
 * Fetches all available sysids from the API on mount.
 * Stores the selected sysid in localStorage so it persists across pages.
 */
import React, { useState, useEffect } from 'react'
import { fetchSysIds } from '../services/api'

const STORAGE_KEY = 'rollmonitor_sysid'

// Known sysids from your DynamoDB data as fallback
const FALLBACK_SYSIDS = [
  '5.155.177.97.1.1',
  '5.143.135.82.1.1',
]

export function useSysId() {
  const [sysid, setSysIdState] = useState(
    () => localStorage.getItem(STORAGE_KEY) || FALLBACK_SYSIDS[0]
  )

  function setSysId(id) {
    localStorage.setItem(STORAGE_KEY, id)
    setSysIdState(id)
  }

  return [sysid, setSysId]
}

export default function SysIdSelector({ value, onChange }) {
  const [options,  setOptions]  = useState(FALLBACK_SYSIDS)
  const [loading,  setLoading]  = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await fetchSysIds()
      if (data?.sysids && data.sysids.length > 0) {
        // Merge API results with fallbacks, remove duplicates
        const merged = [...new Set([...data.sysids, ...FALLBACK_SYSIDS])]
        setOptions(merged.sort())
      }
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Device
      </span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          background: '#f8fafc',
          border: '1.5px solid #bfdbfe',
          borderRadius: '8px',
          padding: '7px 12px',
          color: '#1e293b',
          fontSize: '13px',
          fontFamily: '"JetBrains Mono", monospace',
          cursor: 'pointer',
          outline: 'none',
          minWidth: '180px',
        }}
      >
        {options.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      {loading && <span style={{ fontSize: '11px', color: '#94a3b8' }}>Loading devices…</span>}
    </div>
  )
}
