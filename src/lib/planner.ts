import type { Application, PlanTask } from './types'
import { uid } from './ids'
import { addDays, diffDays, todayIn } from './dates'
import { primaryDeadline } from './deadlines'
import { toUserZone } from './dates'

/** Backward plan from the main deadline. Offsets are defaults the user can edit afterwards. */
const STEPS: { offset: number; label: string; when?: (a: Application) => boolean }[] = [
  { offset: 42, label: 'Request official transcripts', when: (a) => a.requirements.some((r) => /transcript/i.test(r.label)) || a.requirements.length === 0 },
  { offset: 35, label: 'Check eligibility and gather documents' },
  { offset: 28, label: 'Ask referees for recommendation letters', when: (a) => a.requirements.some((r) => r.kind === 'referee') || a.requirements.length === 0 },
  { offset: 21, label: 'Book or confirm language test results', when: (a) => a.requirements.some((r) => r.kind === 'test') },
  { offset: 14, label: 'Finish first draft of essays', when: (a) => a.requirements.some((r) => r.kind === 'essay') || a.requirements.length === 0 },
  { offset: 7, label: 'Final draft done. Ask someone to proofread' },
  { offset: 3, label: 'Upload everything and review the form' },
  { offset: 1, label: 'Submit the application' },
]

export function generateTasks(app: Application, tz = 'Africa/Lagos', now = new Date()): PlanTask[] {
  const d = primaryDeadline(app, tz, now)
  if (!d) return []
  const date = toUserZone(d, tz).date
  const today = todayIn(tz, now)
  const total = diffDays(date, today)
  if (total < 1) return []
  return STEPS.filter((s) => !s.when || s.when(app))
    .map((s) => {
      // Squeeze the plan when the deadline is close so nothing lands in the past.
      const offset = total >= 42 ? s.offset : Math.max(1, Math.round((s.offset / 42) * total))
      return { id: uid('t'), applicationId: app.id, label: s.label, due: addDays(date, -offset), done: false, auto: true }
    })
    .filter((t, i, all) => all.findIndex((x) => x.due === t.due && x.label === t.label) === i)
}
