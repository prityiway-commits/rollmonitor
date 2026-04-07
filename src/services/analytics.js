/**
 * analytics.js
 * Pure JS predictive analytics engine for roll wear.
 * No API calls — all computation runs in the browser.
 *
 * WEAR MODEL:
 *   Each RollWearData record has wear_data[] = raw sensor distances.
 *   Reference profile = first measurement after overhaul (entered manually).
 *   Wear at position i = wear_data[i] - reference_data[i]
 *   Scalar wear per record = min(wear differences) — most worn point.
 *
 * PREDICTION MODEL:
 *   Linear regression: wear = m * t + b  (t in days since reference)
 *   Time to threshold: TTT = (threshold - currentWear) / m
 */

// ── Storage keys ─────────────────────────────────────────────
const SETTINGS_KEY  = 'rollmonitor_analytics_settings'
const OVERHAUL_KEY  = 'rollmonitor_overhaul_log'
const REFERENCE_KEY = 'rollmonitor_references'

// ── Default settings ─────────────────────────────────────────
export const DEFAULT_SETTINGS = {
  threshold:        -50,    // mm — alarm level
  warningLevel:     -40,    // mm — warning level
  hoursPerDay:       16,    // operating hours per day
  daysPerWeek:        5,    // operating days per week
  rollerLengthR1:  1000,    // mm — physical length of roll 1
  rollerLengthR2:  1000,    // mm — physical length of roll 2
}

// ── Settings persistence ──────────────────────────────────────
export function loadSettings() {
  try {
    const s = localStorage.getItem(SETTINGS_KEY)
    return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : { ...DEFAULT_SETTINGS }
  } catch { return { ...DEFAULT_SETTINGS } }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

// ── Reference dates per roll ──────────────────────────────────
// { 'sysid:r1': { date: '2025-09-29', label: 'After overhaul Sept 2025' }, ... }
export function loadReferences() {
  try {
    const s = localStorage.getItem(REFERENCE_KEY)
    return s ? JSON.parse(s) : {}
  } catch { return {} }
}

export function saveReference(sysid, rollid, date, label) {
  const refs = loadReferences()
  refs[`${sysid}:r${rollid}`] = { date, label, savedAt: new Date().toISOString() }
  localStorage.setItem(REFERENCE_KEY, JSON.stringify(refs))
}

export function getReference(sysid, rollid) {
  const refs = loadReferences()
  return refs[`${sysid}:r${rollid}`] || null
}

// ── Overhaul log ──────────────────────────────────────────────
// [{ id, sysid, rollid, date, notes, wearAtOverhaul }]
export function loadOverhaulLog() {
  try {
    const s = localStorage.getItem(OVERHAUL_KEY)
    return s ? JSON.parse(s) : []
  } catch { return [] }
}

export function addOverhaul(entry) {
  const log = loadOverhaulLog()
  const newEntry = { ...entry, id: Date.now().toString(), savedAt: new Date().toISOString() }
  log.push(newEntry)
  log.sort((a, b) => new Date(b.date) - new Date(a.date)) // newest first
  localStorage.setItem(OVERHAUL_KEY, JSON.stringify(log))
  return newEntry
}

export function updateOverhaul(id, updates) {
  const log = loadOverhaulLog().map(e => e.id === id ? { ...e, ...updates, updatedAt: new Date().toISOString() } : e)
  log.sort((a, b) => new Date(b.date) - new Date(a.date))
  localStorage.setItem(OVERHAUL_KEY, JSON.stringify(log))
  return log
}

// Compute 11 measurement positions given roller length
export function computeMeasPositions(rollerLength) {
  const L = parseFloat(rollerLength) || 1400
  return Array.from({ length: 11 }, (_, i) => parseFloat((20 + i * (L - 20) / 10).toFixed(1)))
}

// Compute concavity = max - min diameter
export function computeConcavity(readings) {
  const vals = readings.filter(v => v !== null && v !== '' && !isNaN(parseFloat(v))).map(parseFloat)
  if (vals.length < 2) return null
  return parseFloat((Math.max(...vals) - Math.min(...vals)).toFixed(2))
}

export function deleteOverhaul(id) {
  const log = loadOverhaulLog().filter(e => e.id !== id)
  localStorage.setItem(OVERHAUL_KEY, JSON.stringify(log))
}

// ── Parse DynamoDB datetime to JS Date ────────────────────────
// Handles both "2025-09-29-13:30:44.367" and ISO "2025-09-29T13:30:44Z"
export function parseDynamoDate(val) {
  if (!val) return null
  const s = String(val)
  try {
    const parts = s.split('-')
    if (parts.length >= 4 && s.includes(':')) {
      const iso = `${parts[0]}-${parts[1]}-${parts[2]}T${parts.slice(3).join('-')}`
      const d = new Date(iso)
      if (!isNaN(d)) {
        // PLC timestamps are UTC-5 — add 5 hours to convert to UTC
        return new Date(d.getTime() + 5 * 60 * 60 * 1000)
      }
    }
    return new Date(s)
  } catch { return null }
}

// ── Parse wear_data array (handles {N:"value"} DynamoDB format) ─
export function parseWearArray(wear_data) {
  if (!Array.isArray(wear_data)) return []
  return wear_data.map(v => {
    if (typeof v === 'object' && v.N !== undefined) return parseFloat(v.N)
    return parseFloat(v)
  }).filter(v => !isNaN(v))
}

// ── Compute avg(W[i]) for a single record ─────────────────────
// wear_data is already W[i] = S[i] - C[i] (pre-computed by PLC)
export function avgWearRecord(rec) {
  const W = parseWearArray(rec?.wear_data)
  if (!W.length) return null
  return W.reduce((s, v) => s + v, 0) / W.length
}

// ── Group records by calendar date YYYY-MM-DD ──────────────────
export function groupByDate(records) {
  const map = {}
  records.forEach(rec => {
    const dt = rec.datetime || ''
    const m  = String(dt).match(/(\d{4}-\d{2}-\d{2})/)
    if (!m) return
    const date = m[1]
    if (!map[date]) map[date] = []
    map[date].push(rec)
  })
  return map
}

// ── Build daily avg wear time series (Option C) ───────────────
// For each day: avg(W[i]) across all records and all spos positions
// Returns: [{ x: daysSinceRef, y: dailyAvgWear, date, label }]
export function buildDailyAvgWearSeries(records, referenceDate) {
  if (!records?.length || !referenceDate) return []
  const refTime = referenceDate.getTime()
  const byDate  = groupByDate(records)

  return Object.entries(byDate)
    .map(([date, recs]) => {
      const dt = new Date(date + 'T12:00:00Z')
      if (dt < referenceDate) return null
      const daysSince = (dt.getTime() - refTime) / (1000 * 60 * 60 * 24)
      // avg W across all records that day
      const allAvg = recs.map(r => avgWearRecord(r)).filter(v => v !== null)
      if (!allAvg.length) return null
      const dailyAvg = allAvg.reduce((s, v) => s + v, 0) / allAvg.length
      return { x: daysSince, y: parseFloat(dailyAvg.toFixed(4)), date, label: date, nRecs: recs.length }
    })
    .filter(Boolean)
    .sort((a, b) => a.x - b.x)
}

// ── Compute scalar wear from two profiles ─────────────────────

// Returns the minimum (most negative = most worn) difference
export function computeScalarWear(currentProfile, referenceProfile) {
  if (!currentProfile?.length || !referenceProfile?.length) return null
  const len  = Math.min(currentProfile.length, referenceProfile.length)
  const diffs = Array.from({ length: len }, (_, i) => currentProfile[i] - referenceProfile[i])
  return Math.min(...diffs) // most worn point
}

// ── Linear regression ─────────────────────────────────────────
// Input: array of {x: number, y: number} points
// Output: { slope, intercept, r2, n }
export function linearRegression(points) {
  const n = points.length
  if (n < 2) return null

  const sumX  = points.reduce((s, p) => s + p.x, 0)
  const sumY  = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)
  const sumY2 = points.reduce((s, p) => s + p.y * p.y, 0)

  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null

  const slope     = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  // R² calculation
  const yMean = sumY / n
  const ssTot = points.reduce((s, p) => s + (p.y - yMean) ** 2, 0)
  const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0)
  const r2    = ssTot === 0 ? 1 : 1 - ssRes / ssTot

  return { slope, intercept, r2, n }
}

// ── Build wear time series from records ───────────────────────
// referenceDate: JS Date (t=0)
// records: RollWearData[] sorted ascending
// referenceProfile: number[] from the reference record
// Returns: [{ x: daysSinceRef, y: scalarWear, datetime, label }]
export function buildWearTimeSeries(records, referenceDate, referenceProfile) {
  if (!records?.length || !referenceDate || !referenceProfile?.length) return []

  const refTime = referenceDate.getTime()

  return records
    .map(rec => {
      const dt      = parseDynamoDate(rec.datetime)
      if (!dt || dt < referenceDate) return null
      const daysSince = (dt.getTime() - refTime) / (1000 * 60 * 60 * 24)
      const profile   = parseWearArray(rec.wear_data)
      const wear      = computeScalarWear(profile, referenceProfile)
      if (wear === null) return null
      return { x: daysSince, y: wear, datetime: dt, label: rec.datetime }
    })
    .filter(Boolean)
}

// ── Main prediction function ──────────────────────────────────
export function predictWear(wearTimeSeries, settings, hoursPerDay) {
  if (!wearTimeSeries?.length) return null

  const { threshold, warningLevel } = settings
  const hpd = hoursPerDay || settings.hoursPerDay || 16

  const regression = linearRegression(wearTimeSeries)
  if (!regression || regression.slope >= 0) {
    // No wear trend or improving — return current state
    const latest = wearTimeSeries[wearTimeSeries.length - 1]
    return {
      currentWear:      latest.y,
      wearRateMmPerDay: 0,
      wearRateMmPerHour:0,
      daysToThreshold:  null,
      hoursToThreshold: null,
      predictedDate:    null,
      r2:               regression?.r2 ?? 0,
      n:                regression?.n  ?? 0,
      status:           'stable',
      regression,
    }
  }

  const { slope, intercept, r2, n } = regression
  const latestX   = wearTimeSeries[wearTimeSeries.length - 1].x
  const currentWear = slope * latestX + intercept

  // Days until threshold: threshold = slope * (latestX + daysLeft) + intercept
  const daysToThreshold  = (threshold - currentWear) / slope
  const hoursToThreshold = daysToThreshold * hpd

  const predictedDate = daysToThreshold > 0
    ? new Date(Date.now() + daysToThreshold * 24 * 60 * 60 * 1000)
    : null

  const status = currentWear <= threshold   ? 'critical'
               : currentWear <= warningLevel ? 'warning'
               : daysToThreshold < 30        ? 'caution'
               : 'good'

  return {
    currentWear:       parseFloat(currentWear.toFixed(3)),
    wearRateMmPerDay:  parseFloat(slope.toFixed(4)),
    wearRateMmPerHour: parseFloat((slope / hpd).toFixed(5)),
    daysToThreshold:   daysToThreshold > 0 ? parseFloat(daysToThreshold.toFixed(1)) : 0,
    hoursToThreshold:  hoursToThreshold > 0 ? parseFloat(hoursToThreshold.toFixed(0)) : 0,
    predictedDate,
    r2:                parseFloat(r2.toFixed(3)),
    n,
    status,
    regression,
    // Future trend points for chart
    trendPoints: generateTrendLine(regression, latestX, daysToThreshold),
  }
}

// ── Generate trend line points for chart ──────────────────────
function generateTrendLine(regression, currentX, daysAhead) {
  if (!regression) return []
  const { slope, intercept } = regression
  const endX = currentX + Math.max(daysAhead || 30, 30)
  const steps = 20
  return Array.from({ length: steps + 1 }, (_, i) => {
    const x = currentX + (endX - currentX) * i / steps
    return { x, y: slope * x + intercept }
  })
}

// ── Overhaul interval analysis ────────────────────────────────
// Given overhaul log for a sysid+rollid, compute interval stats
export function analyseOverhaulIntervals(sysid, rollid) {
  const log = loadOverhaulLog()
    .filter(e => e.sysid === sysid && String(e.rollid) === String(rollid))
    .sort((a, b) => new Date(a.date) - new Date(b.date))

  if (log.length < 2) return { intervals: [], avg: null, min: null, max: null, count: log.length }

  const intervals = []
  for (let i = 1; i < log.length; i++) {
    const days = (new Date(log[i].date) - new Date(log[i-1].date)) / (1000 * 60 * 60 * 24)
    intervals.push({
      from:  log[i-1].date,
      to:    log[i].date,
      days:  parseFloat(days.toFixed(1)),
      label: `${log[i-1].date} → ${log[i].date}`,
    })
  }

  const avg = intervals.reduce((s, v) => s + v.days, 0) / intervals.length
  const min = Math.min(...intervals.map(v => v.days))
  const max = Math.max(...intervals.map(v => v.days))

  return {
    intervals: intervals.slice(-5), // last 5
    avg: parseFloat(avg.toFixed(1)),
    min,
    max,
    count: log.length,
    log,
  }
}
