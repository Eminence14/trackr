import type { Application, PlanTask, Profile } from './types'
import { daysLeft, diffDays, todayIn, toUserZone } from './dates'
import { primaryDeadline } from './deadlines'

export interface ReminderItem {
  id: string
  appId: string
  title: string
  days: number
  level: 'urgent' | 'soon' | 'info'
  text: string
}

const rel = (d: number) => (d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`)

/** Reminders due today: deadlines hitting the user's chosen lead times, plus opening dates. */
export function dueReminders(apps: Application[], p: Profile, now = new Date()): ReminderItem[] {
  const out: ReminderItem[] = []
  for (const a of apps) {
    if (!['saved', 'preparing'].includes(a.status)) continue
    for (const d of a.deadlines) {
      const days = daysLeft(d, p.tz, now)
      if (d.kind === 'opens') {
        if (days === 0 || days === 1) out.push({ id: `${a.id}:${d.id}:${days}`, appId: a.id, title: a.title, days, level: 'info', text: `Applications open ${rel(days)}` })
        continue
      }
      // Fire once per lead time, even if the app was not opened on the exact day: 5 days left still counts as the "7 day" reminder.
      if (days < 0) continue
      const bracket = [...new Set([...p.remindDays, 0])].sort((x, y) => x - y).find((t) => days <= t)
      if (bracket === undefined) continue
      const left = a.requirements.filter((r) => !r.done).length
      out.push({
        id: `${a.id}:${d.id}:${d.date}:${bracket}`, appId: a.id, title: a.title || 'Untitled', days,
        level: days <= 1 ? 'urgent' : days <= 3 ? 'soon' : 'info',
        text: `Closes ${rel(days)}${left ? `. ${left} item${left > 1 ? 's' : ''} left on the checklist` : ''}`,
      })
    }
  }
  return out.sort((x, y) => x.days - y.days)
}

export interface WeekView {
  dueSoon: { app: Application; days: number }[]
  blocked: { app: Application; days: number; left: number }[]
  opening: { app: Application; days: number }[]
  cycles: { app: Application; days: number }[]
  overdueTasks: PlanTask[]
  suggestMissed: Application[]
}

export function weekView(apps: Application[], tasks: PlanTask[], p: Profile, now = new Date()): WeekView {
  const today = todayIn(p.tz, now)
  const open = apps.filter((a) => ['saved', 'preparing'].includes(a.status))
  const dueSoon: WeekView['dueSoon'] = []
  const blocked: WeekView['blocked'] = []
  const opening: WeekView['opening'] = []
  const cycles: WeekView['cycles'] = []
  const suggestMissed: Application[] = []
  for (const a of open) {
    const d = primaryDeadline(a, p.tz, now)
    if (d) {
      const days = daysLeft(d, p.tz, now)
      if (days >= 0 && days <= 7) dueSoon.push({ app: a, days })
      const left = a.requirements.filter((r) => !r.done).length
      if (days >= 0 && days <= 14 && left > 0) blocked.push({ app: a, days, left })
      if (days < 0) suggestMissed.push(a)
    }
    const o = a.deadlines.find((x) => x.kind === 'opens')
    if (o) { const days = diffDays(toUserZone(o, p.tz).date, today); if (days >= 0 && days <= 14) opening.push({ app: a, days }) }
  }
  for (const a of apps) if (a.nextCycleOn) { const days = diffDays(a.nextCycleOn, today); if (days >= 0 && days <= 30) cycles.push({ app: a, days }) }
  const appIds = new Set(apps.map((a) => a.id))
  const overdueTasks = tasks.filter((t) => !t.done && appIds.has(t.applicationId) && t.due < today)
  const byDays = <T extends { days: number }>(l: T[]) => l.sort((a, b) => a.days - b.days)
  return { dueSoon: byDays(dueSoon), blocked: byDays(blocked), opening: byDays(opening), cycles: byDays(cycles), overdueTasks, suggestMissed }
}
