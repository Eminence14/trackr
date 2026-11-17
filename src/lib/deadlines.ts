import type { Application, Deadline } from './types'
import { daysLeft, toUserZone } from './dates'

/** The deadline that matters most right now: the nearest upcoming one, else the latest past one. */
export function primaryDeadline(app: Application, tz: string, now = new Date()): Deadline | undefined {
  const real = app.deadlines.filter((d) => d.kind !== 'opens')
  if (!real.length) return undefined
  const scored = real.map((d) => ({ d, days: daysLeft(d, tz, now) }))
  const upcoming = scored.filter((x) => x.days >= 0).sort((a, b) => a.days - b.days)
  if (upcoming.length) {
    const scholarship = upcoming.find((x) => x.d.kind === 'scholarship')
    return (scholarship && scholarship.days - upcoming[0].days <= 400 ? upcoming[0] : upcoming[0]).d
  }
  return scored.sort((a, b) => b.days - a.days)[0].d
}

export function deadlineDays(app: Application, tz: string, now = new Date()): number | undefined {
  const d = primaryDeadline(app, tz, now)
  return d ? daysLeft(d, tz, now) : undefined
}

export const deadlineDateLocal = (d: Deadline, tz: string) => toUserZone(d, tz).date

export function opensOn(app: Application): Deadline | undefined {
  return app.deadlines.find((d) => d.kind === 'opens')
}

/** Reasons the parsed details should be double-checked by the user. */
export function reviewReasons(app: Application): string[] {
  const out: string[] = []
  const main = app.deadlines.find((d) => d.kind !== 'opens')
  if (!app.title) out.push('No scholarship name found')
  if (!main) out.push('No deadline found')
  else if ((app.confidence.deadline ?? 1) < 0.7) out.push('Deadline is a low-confidence guess')
  if (!app.officialUrl && app.sourceKind !== 'official' && app.sourceKind !== 'manual' && app.sourceKind !== 'import') out.push('No official page linked yet')
  if (app.scamFlags.some((f) => f.severity === 'high')) out.push('Warning signs found in the post')
  if (app.changeNote) out.push(app.changeNote)
  return out
}
