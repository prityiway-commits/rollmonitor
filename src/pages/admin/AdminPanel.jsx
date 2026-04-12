/**
 * pages/admin/AdminPanel.jsx
 * Full organisation + user management for admin role.
 * Tabs: Customers | Regions | Plants | Users
 */
import React, { useState, useEffect } from 'react'
import { useAuth, hasRole } from '../../context/AuthContext'
import { SectionHead, Spinner, ErrorBanner } from '../../components'

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '5px' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder, type = 'text', required }) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} required={required}
      className="input-field" style={{ marginBottom: 0 }} />
  )
}

function Select({ value, onChange, options, placeholder }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      style={{ width: '100%', padding: '8px 12px', fontSize: '13px', border: '1.5px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', color: value ? '#1e293b' : '#94a3b8', outline: 'none' }}>
      <option value="">{placeholder || 'Select...'}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function Badge({ role }) {
  const styles = {
    admin:    { background: '#fef3c7', color: '#854d0e', border: '1px solid #fde68a' },
    global:   { background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' },
    regional: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' },
    plant:    { background: '#f5f3ff', color: '#5b21b6', border: '1px solid #ddd6fe' },
  }
  const s = styles[role] || styles.plant
  return (
    <span style={{ ...s, fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '20px', textTransform: 'uppercase' }}>
      {role}
    </span>
  )
}

export default function AdminPanel() {
  const { authCall, user } = useAuth()
  const [tab, setTab] = useState('customers')

  // Org tree
  const [org,     setOrg]     = useState(null)
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(false)
  const [msg,     setMsg]     = useState(null)
  const [error,   setError]   = useState(null)

  // Edit states
  const [editItem, setEditItem] = useState(null)  // { type, data }

  // Form states
  const [newCustomer,  setNewCustomer]  = useState({ name: '', country: '', contact: '' })
  const [newRegion,    setNewRegion]    = useState({ customerId: '', name: '', description: '' })
  const [newPlant,     setNewPlant]     = useState({ customerId: '', regionId: '', name: '', location: '', sysids: '' })
  const [newUser,      setNewUser]      = useState({ username: '', password: '', name: '', role: 'plant', customerId: '', regionId: '', plantId: '' })

  useEffect(() => { loadOrg(); loadUsers() }, [])

  async function loadOrg() {
    setLoading(true)
    const { data, error: e } = await authCall('list_org')
    if (data) setOrg(data)
    if (e)    setError(e)
    setLoading(false)
  }

  async function loadUsers() {
    const { data } = await authCall('list_users')
    if (data?.users) setUsers(data.users)
  }

  async function submitForm(action, body, resetFn) {
    setMsg(null); setError(null)
    const { data, error: e } = await authCall(action, body)
    if (e) { setError(e); return }
    setMsg(`✓ ${action.replace('_', ' ')} successful`)
    if (resetFn) resetFn()
    loadOrg(); loadUsers()
  }

  async function editEntity(type, data) {
    setEditItem({ type, data: { ...data } })
  }

  async function saveEdit() {
    if (!editItem) return
    const { type, data } = editItem
    const action = `update_${type}`
    const { error: e } = await authCall(action, data)
    if (e) { setError(e); return }
    setMsg(`✓ ${type} updated successfully`)
    setEditItem(null)
    loadOrg()
  }

  async function deleteEntity(type, customerId, entityId, name) {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    const body = type === 'customer'
      ? { customerId }
      : { customerId, entityId }
    const { error: e } = await authCall(`delete_${type}`, body)
    if (e) { setError(e); return }
    setMsg(`✓ ${type} deleted successfully`)
    loadOrg()
  }

  async function toggleUser(u) {
    await authCall('update_user', { userId: u.userId, active: !u.active })
    loadUsers()
  }

  async function deleteUser(u) {
    if (!window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) return
    await authCall('delete_user', { userId: u.userId })
    loadUsers()
  }

  async function resetPassword(u) {
    const newPass = window.prompt(
      `Reset password for "${u.username}"\n\nEnter a new temporary password (min 8 characters):`
    )
    if (!newPass) return
    if (newPass.length < 8) { alert('Password must be at least 8 characters.'); return }
    const { data, error: e } = await authCall('reset_password', {
      userId: u.userId,
      newPassword: newPass,
    })
    if (e)    { setError(e) }
    else      { setMsg(`✓ Password reset for "${u.username}". They must change it on next login.`) }
  }

  // Derived options for dropdowns
  const allCustomers = org?.tree?.map(c => ({ value: c.customerId, label: c.name })) || []
  const allRegions   = org?.tree?.flatMap(c => (c.regions||[]).map(r => ({ value: r.entityId, label: `${c.name} › ${r.name}`, customerId: c.customerId }))) || []
  const allPlants    = org?.tree?.flatMap(c => (c.plants||[]).map(p => ({ value: p.entityId, label: `${c.name} › ${p.name}`, customerId: c.customerId, regionId: p.regionId }))) || []

  const regionOptions = allRegions.filter(r => !newPlant.customerId || r.customerId === newPlant.customerId)
  const plantOptions  = allPlants.filter(p => (!newUser.customerId || p.customerId === newUser.customerId))

  const tabStyle = (t) => ({
    padding: '8px 16px', fontSize: '13px', fontWeight: tab === t ? '600' : '400',
    color: tab === t ? '#1d6fbd' : '#64748b', borderBottom: tab === t ? '2px solid #1d6fbd' : '2px solid transparent',
    background: 'none', border: 'none',
    cursor: 'pointer', fontFamily: 'inherit',
  })

  if (!hasRole(user, 'admin')) {
    return <div style={{ padding: '2rem', color: '#94a3b8' }}>Admin access required.</div>
  }

  return (
    <div style={{ maxWidth: '960px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

      <div>
        <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#1e293b', margin: 0 }}>Admin Panel</h2>
        <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>Manage customers, regions, plants and users</div>
      </div>

      {msg   && <div style={{ padding: '12px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '13px', color: '#166534' }}>{msg}</div>}
      {error && <div style={{ padding: '12px 16px', background: '#fff5f5', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '13px', color: '#dc2626' }}>{error}</div>}

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '0' }}>
        {['customers','regions','plants','users'].map(t => (
          <button key={t} style={tabStyle(t)} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── CUSTOMERS ── */}
      {tab === 'customers' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div className="card">
            <SectionHead title="Add Customer" />
            <Field label="Company name"><Input value={newCustomer.name} onChange={v => setNewCustomer(p=>({...p,name:v}))} placeholder="e.g. Tata Steel Ltd" required /></Field>
            <Field label="Country"><Input value={newCustomer.country} onChange={v => setNewCustomer(p=>({...p,country:v}))} placeholder="e.g. India" /></Field>
            <Field label="Contact email"><Input value={newCustomer.contact} onChange={v => setNewCustomer(p=>({...p,contact:v}))} placeholder="contact@company.com" type="email" /></Field>
            <button className="btn-primary" style={{ fontSize: '13px' }}
              onClick={() => submitForm('create_customer', newCustomer, () => setNewCustomer({name:'',country:'',contact:''}))}>
              + Add Customer
            </button>
          </div>
          <div className="card">
            <SectionHead title="Existing Customers" />
            {loading ? <Spinner /> : org?.tree?.map(c => (
              <div key={c.customerId} style={{ padding:'10px 0', borderBottom:'1px solid #f1f5f9' }}>
                {editItem?.type === 'customer' && editItem.data.customerId === c.customerId ? (
                  <div>
                    <Field label="Name"><Input value={editItem.data.name} onChange={v => setEditItem(p=>({...p,data:{...p.data,name:v}}))} /></Field>
                    <Field label="Country"><Input value={editItem.data.country||''} onChange={v => setEditItem(p=>({...p,data:{...p.data,country:v}}))} /></Field>
                    <Field label="Contact"><Input value={editItem.data.contact||''} onChange={v => setEditItem(p=>({...p,data:{...p.data,contact:v}}))} /></Field>
                    <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
                      <button className="btn-primary" style={{ fontSize:'12px', padding:'4px 12px' }} onClick={saveEdit}>Save</button>
                      <button className="btn-secondary" style={{ fontSize:'12px', padding:'4px 12px' }} onClick={() => setEditItem(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                      <div>
                        <div style={{ fontSize:'13px', fontWeight:'600', color:'#1e293b' }}>{c.name}</div>
                        <div style={{ fontSize:'11px', color:'#94a3b8', fontFamily:'monospace' }}>{c.customerId}</div>
                        <div style={{ fontSize:'11px', color:'#64748b', marginTop:'2px' }}>{c.regions?.length||0} regions · {c.plants?.length||0} plants</div>
                      </div>
                      <div style={{ display:'flex', gap:'6px' }}>
                        <button style={{ fontSize:'11px', padding:'3px 8px', borderRadius:'6px', border:'1px solid #e2e8f0', background:'#f8fafc', cursor:'pointer', color:'#1d4ed8' }}
                          onClick={() => editEntity('customer', { customerId:c.customerId, name:c.name, country:c.country||'', contact:c.contact||'' })}>
                          Edit
                        </button>
                        <button style={{ fontSize:'11px', padding:'3px 8px', borderRadius:'6px', border:'1px solid #fecaca', background:'#fff5f5', cursor:'pointer', color:'#dc2626' }}
                          onClick={() => deleteEntity('customer', c.customerId, null, c.name)}>
                          Delete
                        </button>
                      </div>
                    </div>
                    {/* Logo upload */}
                    <div style={{ marginTop:'10px', padding:'10px', background:'#f8fafc', borderRadius:'8px', border:'1px dashed #e2e8f0' }}>
                      <div style={{ fontSize:'11px', fontWeight:'600', color:'#64748b', marginBottom:'8px', textTransform:'uppercase', letterSpacing:'0.05em' }}>Customer Logo</div>
                      {c.logo ? (
                        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                          <img src={c.logo} alt="logo"
                            style={{ maxWidth:'100%', maxHeight:'60px', width:'auto', height:'auto', objectFit:'contain', borderRadius:'4px', border:'1px solid #e2e8f0' }} />
                          <button
                            onClick={async () => {
                              await authCall('delete_logo', { customerId: c.customerId })
                              setMsg('Logo removed'); loadOrg()
                            }}
                            style={{ fontSize:'11px', padding:'3px 8px', borderRadius:'6px', border:'1px solid #fecaca', background:'#fff5f5', cursor:'pointer', color:'#dc2626' }}>
                            Remove
                          </button>
                        </div>
                      ) : (
                        <label style={{ cursor:'pointer', display:'flex', alignItems:'center', gap:'8px' }}>
                          <div style={{ fontSize:'12px', padding:'6px 12px', borderRadius:'6px', border:'1px solid #bfdbfe', background:'#eff6ff', color:'#1d4ed8', cursor:'pointer' }}>
                            Upload JPEG
                          </div>
                          <span style={{ fontSize:'11px', color:'#94a3b8' }}>No logo uploaded</span>
                          <input type="file" accept="image/jpeg,image/jpg,image/png"
                            style={{ display:'none' }}
                            onChange={async e => {
                              const file = e.target.files[0]
                              if (!file) return
                              const reader = new FileReader()
                              reader.onload = async ev => {
                                const b64 = ev.target.result
                                const { error: er } = await authCall('upload_logo', { customerId: c.customerId, logo: b64 })
                                if (er) setError(er)
                                else { setMsg('Logo uploaded successfully'); loadOrg() }
                              }
                              reader.readAsDataURL(file)
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── REGIONS ── */}
      {tab === 'regions' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div className="card">
            <SectionHead title="Add Region" />
            <Field label="Customer"><Select value={newRegion.customerId} onChange={v => setNewRegion(p=>({...p,customerId:v}))} options={allCustomers} placeholder="Select customer" /></Field>
            <Field label="Region name"><Input value={newRegion.name} onChange={v => setNewRegion(p=>({...p,name:v}))} placeholder="e.g. South India" required /></Field>
            <Field label="Description"><Input value={newRegion.description} onChange={v => setNewRegion(p=>({...p,description:v}))} placeholder="Optional" /></Field>
            <button className="btn-primary" style={{ fontSize: '13px' }}
              onClick={() => submitForm('create_region', newRegion, () => setNewRegion({customerId:'',name:'',description:''}))}>
              + Add Region
            </button>
          </div>
          <div className="card">
            <SectionHead title="Existing Regions" />
            {org?.tree?.flatMap(c => (c.regions||[]).map(r => (
              <div key={r.entityId} style={{ padding:'10px 0', borderBottom:'1px solid #f1f5f9' }}>
                {editItem?.type === 'region' && editItem.data.entityId === r.entityId ? (
                  <div>
                    <Field label="Name"><Input value={editItem.data.name} onChange={v => setEditItem(p=>({...p,data:{...p.data,name:v}}))} /></Field>
                    <Field label="Description"><Input value={editItem.data.description||''} onChange={v => setEditItem(p=>({...p,data:{...p.data,description:v}}))} /></Field>
                    <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
                      <button className="btn-primary" style={{ fontSize:'12px', padding:'4px 12px' }} onClick={saveEdit}>Save</button>
                      <button className="btn-secondary" style={{ fontSize:'12px', padding:'4px 12px' }} onClick={() => setEditItem(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                    <div>
                      <div style={{ fontSize:'13px', fontWeight:'600', color:'#1e293b' }}>{r.name}</div>
                      <div style={{ fontSize:'11px', color:'#94a3b8' }}>{c.name} · <span style={{ fontFamily:'monospace' }}>{r.entityId}</span></div>
                      {r.description && <div style={{ fontSize:'11px', color:'#64748b', marginTop:'2px' }}>{r.description}</div>}
                    </div>
                    <div style={{ display:'flex', gap:'6px' }}>
                      <button style={{ fontSize:'11px', padding:'3px 8px', borderRadius:'6px', border:'1px solid #e2e8f0', background:'#f8fafc', cursor:'pointer', color:'#1d4ed8' }}
                        onClick={() => editEntity('region', { customerId:c.customerId, entityId:r.entityId, name:r.name, description:r.description||'' })}>
                        Edit
                      </button>
                      <button style={{ fontSize:'11px', padding:'3px 8px', borderRadius:'6px', border:'1px solid #fecaca', background:'#fff5f5', cursor:'pointer', color:'#dc2626' }}
                        onClick={() => deleteEntity('region', c.customerId, r.entityId, r.name)}>
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )))}
          </div>
        </div>
      )}

      {/* ── PLANTS ── */}
      {tab === 'plants' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div className="card">
            <SectionHead title="Add Plant" />
            <Field label="Customer"><Select value={newPlant.customerId} onChange={v => setNewPlant(p=>({...p,customerId:v,regionId:''}))} options={allCustomers} placeholder="Select customer" /></Field>
            <Field label="Region"><Select value={newPlant.regionId} onChange={v => setNewPlant(p=>({...p,regionId:v}))} options={regionOptions} placeholder="Select region" /></Field>
            <Field label="Plant name"><Input value={newPlant.name} onChange={v => setNewPlant(p=>({...p,name:v}))} placeholder="e.g. Chennai Plant 1" required /></Field>
            <Field label="Location"><Input value={newPlant.location} onChange={v => setNewPlant(p=>({...p,location:v}))} placeholder="e.g. Chennai, Tamil Nadu" /></Field>
            <Field label="Device sysids (comma separated)">
              <input value={newPlant.sysids} onChange={e => setNewPlant(p=>({...p,sysids:e.target.value}))}
                placeholder="e.g. 5.155.177.97.1.1, 5.143.135.82.1.1"
                className="input-field" style={{ fontFamily: 'monospace', fontSize: '12px' }} />
            </Field>
            <button className="btn-primary" style={{ fontSize: '13px' }}
              onClick={() => submitForm('create_plant', {
                ...newPlant,
                sysids: newPlant.sysids.split(',').map(s=>s.trim()).filter(Boolean),
              }, () => setNewPlant({customerId:'',regionId:'',name:'',location:'',sysids:''}))}>
              + Add Plant
            </button>
          </div>
          <div className="card">
            <SectionHead title="Existing Plants" />
            {org?.tree?.flatMap(c => (c.plants||[]).map(p => {
              const region = (c.regions||[]).find(r => r.entityId === p.regionId)
              return (
                <div key={p.entityId} style={{ padding:'10px 0', borderBottom:'1px solid #f1f5f9' }}>
                  {editItem?.type === 'plant' && editItem.data.entityId === p.entityId ? (
                    <div>
                      <Field label="Name"><Input value={editItem.data.name} onChange={v => setEditItem(prev=>({...prev,data:{...prev.data,name:v}}))} /></Field>
                      <Field label="Location"><Input value={editItem.data.location||''} onChange={v => setEditItem(prev=>({...prev,data:{...prev.data,location:v}}))} /></Field>
                      <Field label="Device sysids (comma separated)">
                        <input value={(editItem.data.sysids||[]).join(', ')}
                          onChange={e => setEditItem(prev=>({...prev,data:{...prev.data,sysids:e.target.value.split(',').map(s=>s.trim()).filter(Boolean)}}))}
                          className="input-field" style={{ fontFamily:'monospace', fontSize:'12px' }} />
                      </Field>
                      <div style={{ display:'flex', gap:'8px', marginTop:'8px' }}>
                        <button className="btn-primary" style={{ fontSize:'12px', padding:'4px 12px' }} onClick={saveEdit}>Save</button>
                        <button className="btn-secondary" style={{ fontSize:'12px', padding:'4px 12px' }} onClick={() => setEditItem(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                      <div>
                        <div style={{ fontSize:'13px', fontWeight:'600', color:'#1e293b' }}>{p.name}</div>
                        <div style={{ fontSize:'11px', color:'#64748b' }}>{c.name} › {region?.name || p.regionId}</div>
                        <div style={{ fontSize:'11px', color:'#94a3b8', fontFamily:'monospace', marginTop:'2px' }}>
                          {(p.sysids||[]).join(', ') || 'No devices assigned'}
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:'6px' }}>
                        <button style={{ fontSize:'11px', padding:'3px 8px', borderRadius:'6px', border:'1px solid #e2e8f0', background:'#f8fafc', cursor:'pointer', color:'#1d4ed8' }}
                          onClick={() => editEntity('plant', { customerId:c.customerId, entityId:p.entityId, name:p.name, location:p.location||'', sysids:p.sysids||[] })}>
                          Edit
                        </button>
                        <button style={{ fontSize:'11px', padding:'3px 8px', borderRadius:'6px', border:'1px solid #fecaca', background:'#fff5f5', cursor:'pointer', color:'#dc2626' }}
                          onClick={() => deleteEntity('plant', c.customerId, p.entityId, p.name)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            }))}
          </div>

        </div>
      )}

      {/* ── USERS ── */}
      {tab === 'users' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card">
            <SectionHead title="Create User" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Field label="Full name"><Input value={newUser.name} onChange={v => setNewUser(p=>({...p,name:v}))} placeholder="John Smith" required /></Field>
              <Field label="Username"><Input value={newUser.username} onChange={v => setNewUser(p=>({...p,username:v}))} placeholder="john.smith" required /></Field>
              <Field label="Temporary password"><Input value={newUser.password} onChange={v => setNewUser(p=>({...p,password:v}))} placeholder="Min 8 chars" type="password" required /></Field>
              <Field label="Role">
                <Select value={newUser.role} onChange={v => setNewUser(p=>({...p,role:v}))}
                  options={[{value:'global',label:'Global'},{value:'regional',label:'Regional'},{value:'plant',label:'Plant'}]}
                  placeholder="Select role" />
              </Field>
              <Field label="Customer"><Select value={newUser.customerId} onChange={v => setNewUser(p=>({...p,customerId:v,regionId:'',plantId:''}))} options={allCustomers} placeholder="Select customer" /></Field>
              {(newUser.role === 'regional' || newUser.role === 'plant') && (
                <Field label="Region">
                  <Select value={newUser.regionId} onChange={v => setNewUser(p=>({...p,regionId:v,plantId:''}))}
                    options={allRegions.filter(r => r.customerId === newUser.customerId)} placeholder="Select region" />
                </Field>
              )}
              {newUser.role === 'plant' && (
                <Field label="Plant">
                  <Select value={newUser.plantId} onChange={v => setNewUser(p=>({...p,plantId:v}))}
                    options={plantOptions.filter(p => p.customerId === newUser.customerId)} placeholder="Select plant" />
                </Field>
              )}
            </div>
            <button className="btn-primary" style={{ fontSize: '13px', marginTop: '8px' }}
              onClick={() => submitForm('create_user', newUser, () => setNewUser({username:'',password:'',name:'',role:'plant',customerId:'',regionId:'',plantId:''}))}>
              + Create User
            </button>
          </div>

          <div className="card">
            <SectionHead title={`All Users (${users.length})`} />
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr><th>Name</th><th>Username</th><th>Role</th><th>Customer</th><th>Devices</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const cust = org?.tree?.find(c => c.customerId === u.customerId)
                    return (
                      <tr key={u.userId}>
                        <td style={{ fontWeight: '500' }}>{u.name}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{u.username}</td>
                        <td><Badge role={u.role} /></td>
                        <td style={{ fontSize: '12px' }}>{cust?.name || u.customerId || '—'}</td>
                        <td style={{ fontSize: '11px', fontFamily: 'monospace', color: '#64748b' }}>
                          {(u.sysids||[]).length > 0 ? (u.sysids||[]).slice(0,2).join(', ') + (u.sysids.length > 2 ? `…+${u.sysids.length-2}` : '') : '—'}
                        </td>
                        <td>
                          <span style={{ fontSize: '11px', fontWeight: '600', padding: '2px 8px', borderRadius: '20px',
                            background: u.active ? '#f0fdf4' : '#fff5f5',
                            color:      u.active ? '#166534' : '#dc2626',
                            border: `1px solid ${u.active ? '#bbf7d0' : '#fecaca'}` }}>
                            {u.active ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button onClick={() => toggleUser(u)}
                              style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#f8fafc', cursor: 'pointer', color: u.active ? '#dc2626' : '#166534' }}>
                              {u.active ? 'Disable' : 'Enable'}
                            </button>
                            <button onClick={() => resetPassword(u)}
                              style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', border: '1px solid #fde68a', background: '#fffbeb', cursor: 'pointer', color: '#854d0e' }}>
                              🔑 Reset PW
                            </button>
                            {u.userId !== user?.userId && (
                              <button onClick={() => deleteUser(u)}
                                style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', border: '1px solid #fecaca', background: '#fff5f5', cursor: 'pointer', color: '#dc2626' }}>
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
