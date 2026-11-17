import type { Application, Status } from './types'
import { STATUSES } from './types'

export interface Stats {
  total: number
  byStatus: Record<Status, number>
  sent: number
  awarded: number
  rejected: number
  winRate: number | null
  avgPrepDays: number | null
  fees: number
  fundingWon: Record<string, number>
  fundingOpen: Record<string, number>
}

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)

export function computeStats(apps: Application[]): Stats {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s.id, 0])) as Record<Status, number>
  for (const a of apps) byStatus[a.status]++
  const sent = apps.filter((a) => ['submitted', 'interview', 'awarded', 'rejected'].includes(a.status)).length
  const decided = byStatus.awarded + byStatus.rejected
  const prep: number[] = []
  for (const a of apps) {
    const sub = a.history.find((h) => h.to === 'submitted')
    if (sub) prep.push(Math.max(0, days(a.createdAt, sub.at)))
  }
  const sum = (list: Application[]) => {
    const out: Record<string, number> = {}
    for (const a of list) if (a.funding.amount && a.funding.currency) out[a.funding.currency] = (out[a.funding.currency] ?? 0) + a.funding.amount
    return out
  }
  return {
    total: apps.length, byStatus, sent, awarded: byStatus.awarded, rejected: byStatus.rejected,
    winRate: decided ? byStatus.awarded / decided : null,
    avgPrepDays: prep.length ? Math.round(prep.reduce((x, y) => x + y, 0) / prep.length) : null,
    fees: apps.reduce((t, a) => t + (a.fee ?? 0), 0),
    fundingWon: sum(apps.filter((a) => a.status === 'awarded')),
    fundingOpen: sum(apps.filter((a) => ['saved', 'preparing', 'submitted', 'interview'].includes(a.status))),
  }
}
