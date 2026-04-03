/**
 * context/AuthContext.jsx
 * Global authentication state.
 * Provides: user, token, login(), logout(), loading
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)

const AUTH_URL = 'https://xbhbnor07b.execute-api.ap-south-1.amazonaws.com/auth'
// Replace with your new API Gateway URL for the auth Lambda
// e.g. 'https://abc123.execute-api.ap-south-1.amazonaws.com/prod/auth'

const TOKEN_KEY = 'rollmonitor_session_token'
const USER_KEY  = 'rollmonitor_user'

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(() => {
    try { return JSON.parse(localStorage.getItem(USER_KEY)) } catch { return null }
  })
  const [token,   setToken]   = useState(() => localStorage.getItem(TOKEN_KEY))
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // Validate token on mount
  useEffect(() => {
    async function validate() {
      const t = localStorage.getItem(TOKEN_KEY)
      if (!t) { setLoading(false); return }
      try {
        const res = await fetch(AUTH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Session-Token': t },
          body: JSON.stringify({ action: 'me' }),
        })
        const data = await res.json()
        if (res.ok && data.userId) {
          setUser(data)
          setToken(t)
          localStorage.setItem(USER_KEY, JSON.stringify(data))
        } else {
          clearStorage()
        }
      } catch {
        clearStorage()
      } finally {
        setLoading(false)
      }
    }
    validate()
  }, [])

  function clearStorage() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setUser(null)
    setToken(null)
  }

  const login = useCallback(async (username, password) => {
    setError(null)
    try {
      const res = await fetch(AUTH_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'login', username, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Login failed'); return false }

      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.setItem(USER_KEY,  JSON.stringify(data.user))
      setToken(data.token)
      setUser(data.user)
      return true
    } catch (e) {
      setError('Network error — cannot reach server')
      return false
    }
  }, [])

  const logout = useCallback(async () => {
    if (token) {
      try {
        await fetch(AUTH_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'X-Session-Token': token },
          body:    JSON.stringify({ action: 'logout' }),
        })
      } catch {}
    }
    clearStorage()
  }, [token])

  // Generic auth API call helper
  const authCall = useCallback(async (action, body = {}) => {
    try {
      const res = await fetch(AUTH_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Token': token || '' },
        body:    JSON.stringify({ action, ...body }),
      })
      const data = await res.json()
      return { data: res.ok ? data : null, error: res.ok ? null : (data.error || 'Request failed') }
    } catch (e) {
      return { data: null, error: 'Network error' }
    }
  }, [token])

  return (
    <AuthContext.Provider value={{ user, token, loading, error, login, logout, authCall, setError }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

// Role helpers
export function hasRole(user, minRole) {
  const ranks = { admin: 0, global: 1, regional: 2, plant: 3 }
  if (!user) return false
  return (ranks[user.role] ?? 99) <= (ranks[minRole] ?? 99)
}
