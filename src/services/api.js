/**
 * services/api.js
 *
 * GET  → https://yf8rql6c0c.execute-api.ap-south-1.amazonaws.com/dashboard
 * POST → https://j19axi2dle.execute-api.ap-south-1.amazonaws.com/writeSensor
 */

import axios from 'axios'

const GET_BASE   = 'https://yf8rql6c0c.execute-api.ap-south-1.amazonaws.com'
const POST_BASE  = 'https://j19axi2dle.execute-api.ap-south-1.amazonaws.com'
const GET_ROUTE  = '/dashboard'
const POST_ROUTE = '/writeSensor'

// ── Session token injected into every request ────────────────
function getAuthHeaders() {
  const token = localStorage.getItem('rollmonitor_session_token')
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'X-Session-Token': token } : {}),
  }
}

const getClient = axios.create({ baseURL: GET_BASE,  timeout: 30000 })
const postClient = axios.create({ baseURL: POST_BASE, timeout: 15000 })

// Inject token before every request
getClient.interceptors.request.use(cfg => { cfg.headers = { ...cfg.headers, ...getAuthHeaders() }; return cfg })
postClient.interceptors.request.use(cfg => { cfg.headers = { ...cfg.headers, ...getAuthHeaders() }; return cfg })

function normaliseError(err) {
  if (err.response) {
    const msg = err.response.data?.error || err.response.data?.message || err.response.statusText
    return `Server error ${err.response.status}: ${msg}`
  }
  if (err.request) return 'No response from server — check CORS and API Gateway.'
  return `Request error: ${err.message}`
}

// ── Parse the Lambda response body ───────────────────────────
// Lambda always returns JSON in response.data (axios auto-parses)
// But body might be a JSON string if Lambda wraps it
function parseBody(responseData) {
  if (!responseData) return null
  // If axios already parsed it, use directly
  if (typeof responseData === 'object') {
    // If Lambda wrapped in { body: "..." }
    if (typeof responseData.body === 'string') {
      try { return JSON.parse(responseData.body) } catch { return responseData }
    }
    return responseData
  }
  if (typeof responseData === 'string') {
    try { return JSON.parse(responseData) } catch { return null }
  }
  return null
}

async function safeGet(params = {}) {
  try {
    const res  = await getClient.get(GET_ROUTE, { params })
    const data = parseBody(res.data)
    return { data, error: null }
  } catch (err) {
    console.error('[GET]', GET_ROUTE, params, err)
    return { data: null, error: normaliseError(err) }
  }
}

async function safePost(body = {}) {
  try {
    const res  = await postClient.post(POST_ROUTE, body)
    const data = parseBody(res.data)
    return { data, error: null }
  } catch (err) {
    console.error('[POST]', POST_ROUTE, body, err)
    return { data: null, error: normaliseError(err) }
  }
}

// ── Safely convert any value to a plain array ────────────────
export function toArray(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (typeof data === 'object') return [data]
  return []
}

// ============================================================
//  READ APIs
// ============================================================

/**
 * Dashboard initial load — returns { status, wearData, measStarted, measFinished }
 * Each key is an array of the 5 most recent records.
 * Lambda uses: query_table(table, sysid, limit=5) for each table.
 */
export function fetchDashboard(sysid) {
  return safeGet({ sysid })
}

/**
 * Historical StatusTable records between two datetimes.
 * Lambda uses: KeyConditionExpression sysid=:sysid AND datetime BETWEEN :from AND :to
 */
export function fetchStatusHistory(sysid, fromISO, toISO) {
  return safeGet({ table: 'StatusTable', sysid, from: fromISO, to: toISO })
}

/**
 * Historical RollWearData records filtered by rollid and date range.
 */
export function fetchWearData(sysid, rollid, fromISO, toISO) {
  return safeGet({ table: 'RollWearDataTable', sysid, rollid, from: fromISO, to: toISO })
}

/**
 * RollWearMeasStarted events (optional date range).
 */
export function fetchMeasStarted(sysid, fromISO, toISO) {
  const p = { table: 'RollWearMeasStartedTable', sysid }
  if (fromISO) p.from = fromISO
  if (toISO)   p.to   = toISO
  return safeGet(p)
}

/**
 * RollWearDataFinished events (optional date range).
 */
export function fetchMeasFinished(sysid, fromISO, toISO) {
  const p = { table: 'RollWearDataFinishedTable', sysid }
  if (fromISO) p.from = fromISO
  if (toISO)   p.to   = toISO
  return safeGet(p)
}

// ============================================================
//  WRITE APIs
// ============================================================

export function postMeasConfig(config) {
  // REAL fields must always have decimal (e.g. 250.0 not 250)
  // INT fields must be integers (e.g. 140 not 140.0)
  // JS JSON.stringify drops .0 for whole numbers — fix by using toFixed then parseFloat
  const real = v => parseFloat(parseFloat(v).toFixed(4))  // ensures REAL type
  const int  = v => parseInt(v, 10)                        // ensures INT type

  const payload = {
    sysid:      String(config.sysid),
    r1_min_d:   real(config.r1_min_d),
    r1_max_d:   real(config.r1_max_d),
    r1_pos:     real(config.r1_pos),
    r1_n_steps: int(config.r1_n_steps),
    r1_step:    real(config.r1_step),
    r1_rad:     real(config.r1_rad),
    r1_rpm:     real(config.r1_rpm),
    r2_min_d:   real(config.r2_min_d),
    r2_max_d:   real(config.r2_max_d),
    r2_pos:     real(config.r2_pos),
    r2_n_steps: int(config.r2_n_steps),
    r2_step:    real(config.r2_step),
    r2_rad:     real(config.r2_rad),
    r2_rpm:     real(config.r2_rpm),
  }
  console.log('[MeasConfig] Sending to PLC:', JSON.stringify(payload))
  return safePost({ topic: 'MeasConfig', payload })
}

export function postMeasStart(sysid) {
  // PLC only needs sysid — no rollid required
  return safePost({ topic: 'MeasStart', payload: { sysid: String(sysid) } })
}

export function postMeasStop(sysid) {
  return safePost({ topic: 'MeasStop', payload: { sysid } })
}

// ============================================================
//  WEAR MATH
// ============================================================

export function computeCorrectionCurve(a, b, c, size) {
  return Array.from({ length: size }, (_, i) => a * i * i + b * i + c)
}

export function computeWear(S, C) {
  return S.map((s, i) => s - (C[i] ?? 0))
}

export function computeWearDiff(ref, test) {
  const len = Math.min(ref.length, test.length)
  return Array.from({ length: len }, (_, i) => test[i] - ref[i])
}

/**
 * Fetch all unique sysids from StatusTable.
 * Used to populate the device selector dropdown.
 * Lambda scans StatusTable for distinct sysid values.
 */
export function fetchSysIds() {
  return safeGet({ action: 'list_sysids' })
}
