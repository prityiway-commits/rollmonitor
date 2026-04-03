/**
 * RollNameContext.jsx
 * Global context for custom roll names.
 * Names are saved in localStorage so they persist across pages and refreshes.
 */
import React, { createContext, useContext, useState } from 'react'

const STORAGE_KEY = 'rollmonitor_roll_names'

const defaults = { r1: 'Roll 1', r2: 'Roll 2' }

function load() {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s) return { ...defaults, ...JSON.parse(s) }
  } catch {}
  return defaults
}

const RollNameContext = createContext(null)

export function RollNameProvider({ children }) {
  const [names, setNames] = useState(load)

  function updateName(key, value) {
    const updated = { ...names, [key]: value || defaults[key] }
    setNames(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  }

  return (
    <RollNameContext.Provider value={{ names, updateName }}>
      {children}
    </RollNameContext.Provider>
  )
}

export function useRollNames() {
  return useContext(RollNameContext)
}
