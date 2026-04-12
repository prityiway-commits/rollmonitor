/**
 * SysIdSelector.jsx
 * Dropdown to select the active device (sysid).
 * Admin role → fetches all sysids from API
 * Other roles → uses user's assigned sysids from login
 */
import React, { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { fetchSysIds } from '../services/api'

const STORAGE_KEY = 'rollmonitor_sysid'

export function useSysId() {
  const [sysid, setSysIdState] = useState(
    () => localStorage.getItem(STORAGE_KEY) || ''
  )

  function setSysId(id) {
    localStorage.setItem(STORAGE_KEY, id)
    setSysIdState(id)
  }

  return [sysid, setSysId]
}

export default function SysIdSelector({ value, onChange }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isAdmin) {
      setLoading(true)
      fetchSysIds().then(({ data }) => {
        const sysids = (data?.sysids || []).filter(Boolean).sort()
        setOptions(sysids)
        if (sysids.length > 0 && (!value || !sysids.includes(value))) {
          onChange(sysids[0])
        }
        setLoading(false)
      })
    } else {
      const assigned = (user?.sysids || []).filter(Boolean).sort()
      setOptions(assigned)
      if (assigned.length === 0) {
        // Clear any stale sysid from localStorage
        localStorage.removeItem('rollmonitor_sysid')
        onChange('')
      } else if (!value || !assigned.includes(value)) {
        // Clear stale value and select first assigned
        onChange(assigned[0])
      }
    }
  }, [user?.role, (user?.sysids||[]).join(',')])

  if (options.length === 0 && !loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
        <span style={{ fontSize:'11px', fontWeight:'700', color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em' }}>
          Device
        </span>
        <span style={{ fontSize:'13px', color:'#dc2626', fontStyle:'italic' }}>
          {isAdmin ? 'No devices found' : 'No devices assigned — contact admin'}
        </span>
      </div>
    )
  }

  return (
    <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
      <span style={{ fontSize:'11px', fontWeight:'700', color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em' }}>
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
      {loading && <span style={{ fontSize:'11px', color:'#94a3b8' }}>Loading…</span>}
    </div>
  )
}
