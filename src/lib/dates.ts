// Date helpers. Deadlines are stored as YYYY-MM-DD plus optional HH:mm and an IANA time zone.
import type { Deadline } from './types'

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

export function todayIn(tz: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
    return parts
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}
export const diffDays = (a: string, b: string) => dayNumber(a) - dayNumber(b)
export const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

function tzOffsetMs(instant: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p: Record<string, number> = {}
  for (const part of f.formatToParts(new Date(instant))) if (part.type !== 'literal') p[part.type] = Number(part.value)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - instant
}

/** The exact instant (ms) a wall-clock date/time occurs in a zone. */
export function zonedToInstant(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  let instant = guess - tzOffsetMs(guess, tz)
  instant = guess - tzOffsetMs(instant, tz)
  return instant
}

export interface LocalDeadline { date: string; time?: string; label: string }

/** A deadline expressed in the user's own zone. Date-only deadlines stay as dates. */
export function toUserZone(d: Deadline, userTz: string): LocalDeadline {
  const label = ''
  if (!d.time) return { date: d.date, label }
  const tz = d.tz || userTz
  if (tz === userTz) return { date: d.date, time: d.time, label }
  try {
    const inst = zonedToInstant(d.date, d.time, tz)
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: userTz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    const p: Record<string, string> = {}
    for (const part of f.formatToParts(new Date(inst))) if (part.type !== 'literal') p[part.type] = part.value
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, label }
  } catch {
    return { date: d.date, time: d.time, label }
  }
}

export function daysLeft(d: Deadline, userTz: string, now = new Date()): number {
  return diffDays(toUserZone(d, userTz).date, todayIn(userTz, now))
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const fmtDate = (iso: string, opts: { year?: boolean } = {}) => {
  if (!isValidISO(iso)) return iso || ''
  const [y, m, d] = iso.split('-').map(Number)
  const short = MONTHS[m - 1].slice(0, 3)
  return opts.year === false ? `${d} ${short}` : `${d} ${short} ${y}`
}
export const fmtLong = (iso: string) => {
  if (!isValidISO(iso)) return iso || ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
export const fmtRelative = (days: number) => {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${-days}d overdue`
  if (days < 14) return `${days} days`
  if (days < 60) return `${Math.round(days / 7)} weeks`
  return `${Math.round(days / 30)} months`
}

export const COMMON_TZS = ['Africa/Lagos', 'Africa/Accra', 'Africa/Nairobi', 'Africa/Johannesburg', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney']
export const defaultTz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos' } catch { return 'Africa/Lagos' }
}

const MONTH_IDX: Record<string, number> = {}
MONTHS.forEach((m, i) => { MONTH_IDX[m.toLowerCase()] = i + 1; MONTH_IDX[m.slice(0, 3).toLowerCase()] = i + 1 })
MONTH_IDX['sept'] = 9

export interface FoundDate { date: string; index: number; raw: string }

/** Find dates written in common styles. Slash dates are read day-first (dd/mm/yyyy). */
export const isValidISO = (iso: unknown): iso is string => {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
export const isValidTz = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || !tz) return false
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false }
}

export function findDates(text: string, ref: Date = new Date()): FoundDate[] {
  const refYear = ref.getFullYear()
  const refIso = isoDate(refYear, ref.getMonth() + 1, ref.getDate())
  // A date written without a year means the next time it comes round, not one long gone.
  const yearFor = (mo: number, d: number) => (diffDays(isoDate(refYear, mo, d), refIso) < -30 ? refYear + 1 : refYear)
  const out: FoundDate[] = []
  const monthRe = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'
  const push = (y: number, m: number, d: number, index: number, raw: string) => {
    if (y < 2000 || y > 2100 || !isValidISO(isoDate(y, m, d))) return
    out.push({ date: isoDate(y, m, d), index, raw })
  }
  let m: RegExpExecArray | null
  const iso = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g
  while ((m = iso.exec(text))) push(+m[1], +m[2], +m[3], m.index, m[0])
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${monthRe}\\.?,?\\s*(20\\d{2})?\\b`, 'gi')
  while ((m = dmy.exec(text))) { if (m[2] === 'may' && !m[3]) continue; const mo = MONTH_IDX[m[2].toLowerCase()]; push(m[3] ? +m[3] : yearFor(mo, +m[1]), mo, +m[1], m.index, m[0]) }
  const mdy = new RegExp(`\\b${monthRe}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}))?\\b`, 'gi')
  while ((m = mdy.exec(text))) { if (m[1] === 'may' && !m[3]) continue; const mo = MONTH_IDX[m[1].toLowerCase()]; push(m[3] ? +m[3] : yearFor(mo, +m[2]), mo, +m[2], m.index, m[0]) }
  const slash = /\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2}|\d{2})\b/g
  while ((m = slash.exec(text))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    // day first, unless that is impossible (11/30/2026 can only be month first)
    if (+m[2] > 12 && +m[1] <= 12) push(y, +m[1], +m[2], m.index, m[0])
    else push(y, +m[2], +m[1], m.index, m[0])
  }
  const seen = new Set<string>()
  return out.filter((f) => { const k = f.date + ':' + f.index; if (seen.has(k)) return false; seen.add(k); return true }).sort((a, b) => a.index - b.index)
}
