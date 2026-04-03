/**
 * pages/Login.jsx
 * Login screen shown to unauthenticated users.
 * Also handles forced password change on first login.
 */
import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login, authCall, error, setError } = useAuth()
  const [username,  setUsername]  = useState('')
  const [password,  setPassword]  = useState('')
  const [loading,   setLoading]   = useState(false)

  // Change password flow
  const [mustChange,   setMustChange]   = useState(false)
  const [newPassword,  setNewPassword]  = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [changeToken,  setChangeToken]  = useState(null)
  const [changeMsg,    setChangeMsg]    = useState(null)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const ok = await login(username.trim(), password)
    if (!ok) { setLoading(false); return }

    // Check mustChangePassword from stored user
    const stored = localStorage.getItem('rollmonitor_user')
    if (stored) {
      const u = JSON.parse(stored)
      if (u.mustChangePassword) {
        setChangeToken(localStorage.getItem('rollmonitor_session_token'))
        setMustChange(true)
        setLoading(false)
        return
      }
    }
    setLoading(false)
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    setChangeMsg(null)
    if (newPassword !== newPassword2) { setChangeMsg('Passwords do not match'); return }
    if (newPassword.length < 8)       { setChangeMsg('Password must be at least 8 characters'); return }

    setLoading(true)
    const { data, error: err } = await authCall('change_password', {
      oldPassword: password,
      newPassword,
    })
    setLoading(false)
    if (err) { setChangeMsg(err); return }
    setMustChange(false)
    // Reload to refresh user state
    window.location.reload()
  }

  const inputStyle = {
    width: '100%', padding: '10px 14px', fontSize: '14px',
    border: '1.5px solid #e2e8f0', borderRadius: '8px',
    background: '#f8fafc', color: '#1e293b', outline: 'none',
    fontFamily: '"DM Sans", sans-serif', boxSizing: 'border-box',
  }

  if (mustChange) {
    return (
      <div style={outerStyle}>
        <div style={cardStyle}>
          <div style={logoStyle}>🔑</div>
          <h2 style={titleStyle}>Set New Password</h2>
          <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px', textAlign: 'center' }}>
            This is your first login. Please set a new password to continue.
          </p>
          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={labelStyle}>New password</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                style={inputStyle} placeholder="Min 8 characters" required autoFocus />
            </div>
            <div>
              <label style={labelStyle}>Confirm new password</label>
              <input type="password" value={newPassword2} onChange={e => setNewPassword2(e.target.value)}
                style={inputStyle} placeholder="Repeat password" required />
            </div>
            {changeMsg && <div style={errStyle}>{changeMsg}</div>}
            <button type="submit" disabled={loading} style={btnStyle}>
              {loading ? 'Saving…' : 'Set Password & Continue'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div style={outerStyle}>
      <div style={cardStyle}>
        {/* Logo */}
        <div style={logoStyle}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#1d6fbd" strokeWidth="1.5"/>
            <circle cx="12" cy="12" r="5"  stroke="#1d6fbd" strokeWidth="1.5"/>
            <circle cx="12" cy="12" r="1.5" fill="#1d6fbd"/>
          </svg>
        </div>
        <h1 style={titleStyle}>RollMonitor</h1>
        <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '24px', textAlign: 'center' }}>
          Industrial IoT Dashboard — Sign in to continue
        </p>

        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={labelStyle}>Username</label>
            <input
              type="text" value={username} autoFocus
              onChange={e => setUsername(e.target.value)}
              style={inputStyle} placeholder="Enter your username" required
              onFocus={e => e.target.style.borderColor = '#3b82f6'}
              onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
            />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              style={inputStyle} placeholder="Enter your password" required
              onFocus={e => e.target.style.borderColor = '#3b82f6'}
              onBlur={e  => e.target.style.borderColor = '#e2e8f0'}
            />
          </div>

          {error && <div style={errStyle}>{error}</div>}

          <button type="submit" disabled={loading} style={btnStyle}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: '20px', padding: '12px', background: '#f8fafc', borderRadius: '8px', fontSize: '11px', color: '#94a3b8', textAlign: 'center' }}>
          Contact your administrator if you need access or have forgotten your password.
        </div>
      </div>
    </div>
  )
}

const outerStyle = {
  minHeight: '100vh', background: 'linear-gradient(135deg, #eff6ff 0%, #f0f4f8 100%)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
}
const cardStyle = {
  background: '#fff', borderRadius: '16px', padding: '36px 32px',
  width: '100%', maxWidth: '380px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
  border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'stretch',
}
const logoStyle = { display: 'flex', justifyContent: 'center', marginBottom: '12px' }
const titleStyle = { fontSize: '20px', fontWeight: '700', color: '#1e293b', margin: '0 0 4px', textAlign: 'center' }
const labelStyle = { display: 'block', fontSize: '12px', fontWeight: '600', color: '#64748b', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.05em' }
const errStyle   = { background: '#fff5f5', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: '#dc2626' }
const btnStyle   = {
  padding: '11px', fontSize: '14px', fontWeight: '600', borderRadius: '8px',
  background: '#1d6fbd', color: '#fff', border: 'none', cursor: 'pointer',
  marginTop: '4px', transition: 'background 0.15s',
}
