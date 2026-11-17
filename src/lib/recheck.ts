// Weekly re-check: deadlines get extended and pages get corrected. For applications still open, re-read the
// page about once a week and, if it now shows a different deadline, ask the user. Nothing is changed silently.
import { getState, patchApp } from './store'
import { parseInput } from './parseClient'
import { isSocial, isShortener } from './url'
import { fmtDate } from './dates'
import type { Application } from './types'

const WEEK = 7 * 86_400_000
export function dueForRecheck(apps: Application[], now = Date.now()): Application[] {
  return apps
    .filter((a) => ['saved', 'preparing'].includes(a.status))
    .filter((a) => { const u = a.officialUrl || a.sourceUrl; return !!u && !isSocial(u) && !isShortener(u) })
    .filter((a) => now - Date.parse(a.lastCheckedAt ?? a.createdAt) > WEEK)
    .sort((a, b) => Date.parse(a.lastCheckedAt ?? a.createdAt) - Date.parse(b.lastCheckedAt ?? b.createdAt))
}

/** Compare what the page says now with what is stored. Returns the patch to apply. */
export function compareDeadline(a: Application, found: { date: string; time?: string; tz?: string } | undefined, nowIso: string): Partial<Application> {
  const mine = a.deadlines.find((d) => d.kind === 'scholarship') ?? a.deadlines.find((d) => d.kind !== 'opens')
  if (!found || (mine && mine.date === found.date)) return { lastCheckedAt: nowIso }
  return {
    lastCheckedAt: nowIso, pendingDeadline: found, needsReview: true,
    changeNote: mine ? `The page now shows ${fmtDate(found.date)}. You have ${fmtDate(mine.date)}.` : `The page now shows a deadline: ${fmtDate(found.date)}.`,
  }
}

let running = false
export async function recheckSome(max = 2): Promise<number> {
  if (running || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 0
  running = true
  let changed = 0
  try {
    const { apps, fields, profile } = getState()
    for (const a of dueForRecheck(apps).slice(0, max)) {
      const r = await parseInput({ url: a.officialUrl || a.sourceUrl }, fields, profile.tz, { fresh: true })
      const nowIso = new Date().toISOString()
      // only trust a confident AI reading for this; a failed or basic read just resets the clock
      const ok = r.mode === 'gemini' && !r.blocked && (r.confidence.deadline ?? 0) >= 0.7
      const found = ok ? r.deadlines.find((d) => d.kind === 'scholarship') ?? r.deadlines.find((d) => d.kind !== 'opens') : undefined
      const patch = compareDeadline(a, found, nowIso)
      if (patch.changeNote) changed++
      patchApp(a.id, patch)
    }
  } finally { running = false }
  return changed
}
