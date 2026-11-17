// Everything that enters the store from outside (AI output, backups, shared links, CSV) passes through here,
// so one malformed record can never crash a screen or smuggle in a dangerous link.
import type { Application, Deadline, Requirement, Status } from './types'
import { STATUSES } from './types'
import { isValidISO, isValidTz } from './dates'
import { safeUrl } from './url'

const TZ_ABBR: Record<string, string> = { WAT: 'Africa/Lagos', CAT: 'Africa/Maputo', EAT: 'Africa/Nairobi', SAST: 'Africa/Johannesburg', GMT: 'UTC', UTC: 'UTC', Z: 'UTC', BST: 'Europe/London', CET: 'Europe/Berlin', CEST: 'Europe/Berlin', EST: 'America/New_York', EDT: 'America/New_York', ET: 'America/New_York', CST: 'America/Chicago', CDT: 'America/Chicago', PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles', PT: 'America/Los_Angeles', IST: 'Asia/Kolkata', JST: 'Asia/Tokyo', AEST: 'Australia/Sydney', AEDT: 'Australia/Sydney' }
export function normalizeTz(tz: unknown): string | undefined {
  if (typeof tz !== 'string' || !tz.trim()) return undefined
  const t = tz.trim()
  if (TZ_ABBR[t.toUpperCase()]) return TZ_ABBR[t.toUpperCase()]
  return isValidTz(t) ? t : undefined
}
export function normalizeTime(t: unknown): string | undefined {
  if (typeof t !== 'string') return undefined
  const m = /^\s*(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm)?\s*$/i.exec(t)
  if (!m) return undefined
  let h = +m[1]
  if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12
  if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0
  if (h > 23 || +m[2] > 59) return undefined
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.slice(0, max) : '')
const strs = (v: unknown, max = 30) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().slice(0, 200)).slice(0, max) : [])
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
const KINDS = ['scholarship', 'admission', 'referee', 'offer', 'opens', 'other']
const REQ = ['document', 'essay', 'referee', 'test', 'fee', 'other']
let seq = 0
const id = (p: string, v: unknown) => (typeof v === 'string' && v ? v : `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`)

export function sanitizeDeadlines(v: unknown): Deadline[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: Deadline[] = []
  for (const d of v) {
    if (!d || !isValidISO(d.date)) continue
    const kind = KINDS.includes(d.kind) ? d.kind : 'other'
    const key = kind + d.date
    if (seen.has(key)) continue
    seen.add(key)
    const time = normalizeTime(d.time)
    out.push({ id: id('dl', d.id), kind, date: d.date, time, tz: time ? normalizeTz(d.tz) : undefined, label: str(d.label, 80) || undefined })
  }
  return out.slice(0, 12)
}

export function sanitizeApp(a: any): Application | null {
  if (!a || typeof a !== 'object') return null
  const now = new Date().toISOString()
  const status: Status = STATUSES.some((s) => s.id === a.status) ? a.status : 'saved'
  const reqs: Requirement[] = (Array.isArray(a.requirements) ? a.requirements : []).filter((r: any) => r && typeof r.label === 'string' && r.label.trim()).slice(0, 60)
    .map((r: any) => ({ id: id('rq', r.id), label: r.label.trim().slice(0, 200), kind: REQ.includes(r.kind) ? r.kind : 'other', done: !!r.done, note: str(r.note, 500) || undefined }))
  const custom: Record<string, string> = {}
  if (a.custom && typeof a.custom === 'object') for (const [k, v] of Object.entries(a.custom).slice(0, 40)) if (typeof v === 'string') custom[k] = v.slice(0, 500)
  const numMap = (o: unknown) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v as number)).slice(0, 40)) as Record<string, number>
  const strMap = (o: unknown) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, (v as string).slice(0, 300)]).slice(0, 40)) as Record<string, string>
  return {
    id: id('app', a.id), title: str(a.title, 200).trim(), organisationId: typeof a.organisationId === 'string' && a.organisationId ? a.organisationId : null,
    funder: str(a.funder, 160).trim() || null, programme: str(a.programme, 200), degreeLevel: str(a.degreeLevel, 60), country: str(a.country, 80), status,
    deadlines: sanitizeDeadlines(a.deadlines),
    funding: { type: ['full', 'partial', 'unknown'].includes(a.funding?.type) ? a.funding.type : 'unknown', summary: str(a.funding?.summary, 400) || undefined, covers: strs(a.funding?.covers, 15), amount: num(a.funding?.amount), currency: str(a.funding?.currency, 6).toUpperCase() || undefined },
    criteria: { nationalities: strs(a.criteria?.nationalities), degreeLevels: strs(a.criteria?.degreeLevels, 8), fields: strs(a.criteria?.fields), minGpa: num(a.criteria?.minGpa), maxAge: num(a.criteria?.maxAge), other: strs(a.criteria?.other, 15) },
    requirements: reqs, sourceUrl: safeUrl(a.sourceUrl), officialUrl: safeUrl(a.officialUrl),
    sourceKind: typeof a.sourceKind === 'string' ? a.sourceKind : 'manual', notes: str(a.notes, 20000), custom, confidence: numMap(a.confidence), evidence: strMap(a.evidence),
    needsReview: !!a.needsReview, verified: !!a.verified,
    scamFlags: (Array.isArray(a.scamFlags) ? a.scamFlags : []).filter((f: any) => f && typeof f.text === 'string').slice(0, 10).map((f: any) => ({ id: str(f.id, 40), severity: f.severity === 'high' ? 'high' : 'medium', text: f.text.slice(0, 300) })),
    fee: num(a.fee), nextCycleOn: isValidISO(a.nextCycleOn) ? a.nextCycleOn : undefined,
    thumbnail: typeof a.thumbnail === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(a.thumbnail) && a.thumbnail.length < 400_000 ? a.thumbnail : undefined,
    hasThumb: a.hasThumb === true ? true : undefined, lastCheckedAt: typeof a.lastCheckedAt === 'string' ? a.lastCheckedAt : undefined, changeNote: str(a.changeNote, 300) || undefined,
    pendingDeadline: a.pendingDeadline && isValidISO(a.pendingDeadline.date) ? { date: a.pendingDeadline.date, time: normalizeTime(a.pendingDeadline.time), tz: normalizeTz(a.pendingDeadline.tz) } : undefined,
    captureId: typeof a.captureId === 'string' ? a.captureId : undefined,
    history: (Array.isArray(a.history) ? a.history : []).filter((h: any) => h && typeof h.at === 'string' && STATUSES.some((s) => s.id === h.to)).slice(-100),
    createdAt: typeof a.createdAt === 'string' && !Number.isNaN(Date.parse(a.createdAt)) ? a.createdAt : now,
    updatedAt: typeof a.updatedAt === 'string' && !Number.isNaN(Date.parse(a.updatedAt)) ? a.updatedAt : now,
  }
}
