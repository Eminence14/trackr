import type { Application, Capture, Criteria, FieldDef, ParseResult, SourceKind } from './types'
import { uid } from './ids'
import { canonicalUrl, isShortener, safeUrl, sourceKindOf } from './url'
import { sanitizeApp } from './sanitize'
import { putThumb } from './thumbs'
import { detectScamFlags } from './scam'
import { getState, addApp, upsertOrg, setTasksForApp, patchApp } from './store'
import { generateTasks } from './planner'

export const emptyCriteria = (): Criteria => ({ nationalities: [], degreeLevels: [], fields: [], other: [] })

export function newApplication(p: Partial<Application> = {}): Application {
  const now = new Date().toISOString()
  return {
    id: uid('app'), title: '', organisationId: null, funder: null, programme: '', degreeLevel: '', country: '', status: 'saved', deadlines: [],
    funding: { covers: [] }, criteria: emptyCriteria(), requirements: [], sourceUrl: '', officialUrl: '', sourceKind: 'manual', notes: '', custom: {},
    confidence: {}, evidence: {}, needsReview: false, verified: false, scamFlags: [], history: [{ at: now, from: null, to: p.status ?? 'saved' }],
    createdAt: now, updatedAt: now, ...p,
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function findDuplicate(sourceUrl: string, officialUrl: string, title: string, universityName?: string): Application | undefined {
  const { apps, orgs } = getState()
  const cs = sourceUrl ? canonicalUrl(sourceUrl) : ''
  const co = officialUrl ? canonicalUrl(officialUrl) : ''
  return apps.find((a) => {
    if (cs && (canonicalUrl(a.sourceUrl) === cs || (a.officialUrl && canonicalUrl(a.officialUrl) === cs))) return true
    if (co && ((a.officialUrl && canonicalUrl(a.officialUrl) === co) || canonicalUrl(a.sourceUrl) === co)) return true
    if (title && norm(a.title) === norm(title)) {
      const orgName = a.organisationId ? orgs.find((o) => o.id === a.organisationId)?.name ?? '' : ''
      return !universityName || !orgName || norm(orgName) === norm(universityName)
    }
    return false
  })
}

export interface IngestContext {
  sourceUrl: string
  rawText: string
  kind?: SourceKind
  thumbnail?: string
  capture?: Capture
  fields: FieldDef[]
}

export interface IngestOutcome { id: string; duplicate: boolean; refreshed?: boolean }

/** Turn a parse result into a stored application. If it is already tracked, an unchecked entry is refreshed and a checked one is left alone. */
export function saveParsed(r: ParseResult, ctx: IngestContext): IngestOutcome {
  const tz = getState().profile.tz
  // keep the real address behind a short link (lnkd.in, bit.ly) so the same post is recognised next time
  const sourceUrl = safeUrl(r.fetchedUrl && isShortener(ctx.sourceUrl) ? canonicalUrl(r.fetchedUrl) : ctx.sourceUrl)
  const university = (r.university ?? '').trim()
  const dup = findDuplicate(sourceUrl, r.officialUrl ?? '', r.title ?? '', university || undefined) ?? (ctx.sourceUrl && ctx.sourceUrl !== sourceUrl ? findDuplicate(ctx.sourceUrl, '', '', undefined) : undefined)
  if (dup && (dup.verified || !r.title)) return { id: dup.id, duplicate: true }

  const kind: SourceKind = ctx.kind ?? (ctx.thumbnail ? 'screenshot' : sourceUrl ? sourceKindOf(sourceUrl) : 'manual')
  const organisationId = university ? upsertOrg(university, 'university', { country: r.country }) : null
  const customKeys = new Set(ctx.fields.filter((f) => !f.isDefault).map((f) => f.key))
  const custom = Object.fromEntries(Object.entries(r.custom ?? {}).filter(([k, v]) => customKeys.has(k) && v))
  const text = r.sourceText || ctx.rawText || ''
  const scamFlags = detectScamFlags(text, sourceUrl, r.officialUrl ?? '', kind)
  const applyUrl = safeUrl(r.applicationUrl)

  const app = sanitizeApp(newApplication({
    title: r.title ?? '',
    organisationId,
    funder: r.funder ?? null,
    programme: r.programme ?? '',
    degreeLevel: r.degreeLevel ?? '',
    country: r.country ?? '',
    deadlines: r.deadlines.map((d) => ({ id: uid('dl'), kind: d.kind, date: d.date, time: d.time, tz: d.tz, label: d.label })),
    funding: { type: r.funding?.type ?? 'unknown', summary: r.funding?.summary, covers: r.funding?.covers ?? [], amount: r.funding?.amount, currency: r.funding?.currency },
    criteria: { ...emptyCriteria(), ...(r.criteria ?? {}), nationalities: r.criteria?.nationalities ?? [], degreeLevels: r.criteria?.degreeLevels ?? [], fields: r.criteria?.fields ?? [], other: r.criteria?.other ?? [] },
    requirements: [
      ...r.requirements.map((q) => ({ id: uid('rq'), label: q.label, kind: q.kind, done: false })),
      ...(applyUrl && !r.requirements.some((q) => /form|apply|application/i.test(q.label)) ? [{ id: uid('rq'), label: /form/i.test(applyUrl) ? 'Fill in the application form' : 'Open the application link', kind: 'other' as const, done: false, note: applyUrl }] : []),
    ],
    sourceUrl,
    officialUrl: r.officialUrl ?? '',
    sourceKind: kind,
    notes: r.notes ?? '',
    custom,
    confidence: r.confidence ?? {},
    evidence: r.evidence ?? {},
    scamFlags,
    hasThumb: ctx.thumbnail ? true : undefined,
    lastCheckedAt: new Date().toISOString(),
    captureId: ctx.capture?.id,
  }))!
  const main = app.deadlines.find((d) => d.kind !== 'opens')
  app.needsReview = !app.title || !main || (app.confidence.deadline ?? 1) < 0.7 || r.mode !== 'gemini' || scamFlags.some((f) => f.severity === 'high') || (r.dropped?.length ?? 0) > 0
  if (r.funder) upsertOrg(r.funder, 'funder')

  if (dup) {
    // Re-adding something that was never confirmed: take the fresh reading, keep what the user did.
    const doneLabels = new Set(dup.requirements.filter((q) => q.done).map((q) => q.label.toLowerCase()))
    patchApp(dup.id, {
      title: app.title, organisationId: app.organisationId ?? dup.organisationId, funder: app.funder, programme: app.programme || dup.programme, degreeLevel: app.degreeLevel || dup.degreeLevel,
      country: app.country || dup.country, deadlines: app.deadlines.length ? app.deadlines : dup.deadlines, funding: app.funding, criteria: app.criteria,
      requirements: [...app.requirements.map((q) => ({ ...q, done: doneLabels.has(q.label.toLowerCase()) })), ...dup.requirements.filter((q) => q.done && !app.requirements.some((n) => n.label.toLowerCase() === q.label.toLowerCase()))],
      officialUrl: app.officialUrl || dup.officialUrl, sourceUrl: dup.sourceUrl || app.sourceUrl, custom: { ...dup.custom, ...app.custom }, confidence: app.confidence, evidence: app.evidence,
      scamFlags: app.scamFlags, needsReview: app.needsReview, hasThumb: ctx.thumbnail ? true : dup.hasThumb, lastCheckedAt: app.lastCheckedAt, changeNote: undefined,
    })
    if (ctx.thumbnail) void putThumb(dup.id, ctx.thumbnail)
    return { id: dup.id, duplicate: true, refreshed: true }
  }
  addApp(app)
  if (ctx.thumbnail) void putThumb(app.id, ctx.thumbnail)
  if (main) setTasksForApp(app.id, generateTasks(app, tz))
  return { id: app.id, duplicate: false }
}

export function markVerified(id: string) { patchApp(id, { verified: true, needsReview: false }) }
