import React from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom'

import { AuthProvider, useAuth, hasRole } from './context/AuthContext'
import { RollNameProvider } from './components/RollNameContext'

import Login       from './pages/Login'
import Dashboard   from './pages/Dashboard'
import RollControl from './pages/RollControl'
import WearResults from './pages/WearResults'
import SystemHealth from './pages/SystemHealth'
import Analytics   from './pages/Analytics'
import AdminPanel  from './pages/admin/AdminPanel'

// ── Icons ─────────────────────────────────────────────────────
const Icons = {
  Dashboard:  () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>,
  Control:    () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>,
  Results:    () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>,
  Health:     () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
  Analytics:  () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  Admin:      () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Logout:     () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
}

const NAV = [
  { path: '/',          label: 'Dashboard',     Icon: Icons.Dashboard, desc: 'Live system status',         minRole: 'plant'    },
  { path: '/control',   label: 'Roll Control',  Icon: Icons.Control,   desc: 'Start / stop / configure',   minRole: 'plant'    },
  { path: '/results',   label: 'Wear Results',  Icon: Icons.Results,   desc: 'Charts & analysis',          minRole: 'plant'    },
  { path: '/analytics', label: 'Analytics',     Icon: Icons.Analytics, desc: 'Wear prediction & alarms',   minRole: 'plant'    },
  { path: '/health',    label: 'System Health', Icon: Icons.Health,    desc: 'Connectivity & events',      minRole: 'plant'    },
  { path: '/admin',     label: 'Admin Panel',   Icon: Icons.Admin,     desc: 'Users & org management',     minRole: 'admin'    },
]

function RoleBadge({ role }) {
  const colors = {
    admin:    '#854d0e', regional: '#166534',
    global:   '#1e40af', plant:    '#5b21b6',
  }
  const bgs = {
    admin:    '#fef3c7', regional: '#f0fdf4',
    global:   '#eff6ff', plant:    '#f5f3ff',
  }
  return (
    <span style={{ fontSize: '9px', fontWeight: '700', padding: '2px 6px', borderRadius: '10px',
      background: bgs[role]||'#f1f5f9', color: colors[role]||'#334155',
      textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {role}
    </span>
  )
}

function Sidebar() {
  const { user, logout } = useAuth()
  return (
    <aside style={{
      width: '220px', minWidth: '220px', minHeight: '100vh',
      background: 'linear-gradient(180deg, #1e40af 0%, #1d6fbd 60%, #2563eb 100%)',
      display: 'flex', flexDirection: 'column',
      boxShadow: '4px 0 24px rgba(29,111,189,0.18)', position: 'relative', zIndex: 10,
    }}>
      {/* Logo */}
      <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <div style={{ width: '36px', height: '36px', background: 'rgba(255,255,255,0.15)', borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="white" strokeWidth="1.5"/>
              <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1.5"/>
              <circle cx="12" cy="12" r="1.5" fill="white"/>
            </svg>
          </div>
          <div>
            <div style={{ color: '#fff', fontWeight: '700', fontSize: '15px', lineHeight: '1.1' }}>RollMonitor</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Industrial IoT</div>
          </div>
        </div>
        {/* User info */}
        {user && (
          <div style={{ background: 'rgba(255,255,255,0.1)', borderRadius: '8px', padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
              <span style={{ color: '#fff', fontSize: '12px', fontWeight: '600' }}>{user.name || user.username}</span>
              <RoleBadge role={user.role} />
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px', fontFamily: 'monospace' }}>{user.username}</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {NAV.filter(n => hasRole(user, n.minRole)).map(({ path, label, Icon, desc }) => (
          <NavLink key={path} to={path} end={path === '/'}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
              borderRadius: '9px', textDecoration: 'none', transition: 'all 0.15s',
              background: isActive ? 'rgba(255,255,255,0.18)' : 'transparent',
              border: isActive ? '1px solid rgba(255,255,255,0.25)' : '1px solid transparent',
            })}>
            {({ isActive }) => (
              <>
                <div style={{ width: '32px', height: '32px', borderRadius: '7px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: isActive ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)',
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.65)' }}>
                  <Icon />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: isActive ? '#fff' : 'rgba(255,255,255,0.75)', fontSize: '13px', fontWeight: isActive ? '600' : '500' }}>{label}</div>
                  <div style={{ color: 'rgba(255,255,255,0.38)', fontSize: '10px' }}>{desc}</div>
                </div>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer: logout */}
      <div style={{ padding: '12px 10px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <button onClick={logout} style={{
          display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
          padding: '9px 12px', borderRadius: '9px', background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', color: 'rgba(255,255,255,0.7)',
          fontSize: '13px', fontFamily: 'inherit',
          transition: 'all 0.15s',
        }}>
          <Icons.Logout /> Sign Out
        </button>
        <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '7px', paddingLeft: '2px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px #4ade80' }} />
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px' }}>AWS IoT · ap-south-1</div>
        </div>
      </div>
    </aside>
  )
}

function Layout({ children }) {
  const loc  = useLocation()
  const page = NAV.find(n => n.path === loc.pathname) || NAV[0]
  const { user } = useAuth()
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f0f4f8' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{ height: '58px', background: '#fff', borderBottom: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 28px', position: 'sticky', top: 0, zIndex: 9, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#94a3b8', fontSize: '13px' }}>RollMonitor</span>
            <span style={{ color: '#cbd5e1' }}>/</span>
            <span style={{ color: '#1e293b', fontSize: '13px', fontWeight: '600' }}>{page.label}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
              <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '500' }}>Live</span>
            </div>
            {user && (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '4px 10px', fontSize: '11px', color: '#1d4ed8', fontWeight: '600', fontFamily: 'monospace' }}>
                {localStorage.getItem('rollmonitor_sysid') || 'No device'}
              </div>
            )}
          </div>
        </header>
        <main style={{ flex: 1, padding: '28px', overflowY: 'auto' }}>{children}</main>
      </div>
    </div>
  )
}

// ── Protected route wrapper ───────────────────────────────────
function ProtectedRoute({ children, minRole }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><div style={{ width: '32px', height: '32px', border: '3px solid #bfdbfe', borderTopColor: '#1d6fbd', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /></div>
  if (!user)   return <Navigate to="/login" replace />
  if (minRole && !hasRole(user, minRole)) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return null

  return (
    <Routes>
      <Route path="/login" element={!user ? <Login /> : <Navigate to="/" replace />} />
      <Route path="/*" element={
        <ProtectedRoute>
          <Layout>
            <Routes>
              <Route path="/"          element={<Dashboard />} />
              <Route path="/control"   element={<RollControl />} />
              <Route path="/results"   element={<WearResults />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/health"    element={<SystemHealth />} />
              <Route path="/admin"     element={<ProtectedRoute minRole="admin"><AdminPanel /></ProtectedRoute>} />
            </Routes>
          </Layout>
        </ProtectedRoute>
      } />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <RollNameProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRoutes />
        </BrowserRouter>
      </RollNameProvider>
    </AuthProvider>
  )
}
