// The offline reader against real posts. If the fixtures folder is absent (it is git-ignored) these are skipped.
import { describe, it, expect } from 'vitest'
import { heuristicParse } from '../src/lib/heuristic'
import { detectScamFlags } from '../src/lib/scam'
// The path is held in a variable so type checks pass on machines (and servers) without the fixtures.
const fixtures = './fixtures/real/posts'
const mod = (await import(/* @vite-ignore */ fixtures).catch(() => null)) as { POSTS: Record<string, string> } | null
const P: Record<string, string> = mod?.POSTS ?? {}
const NOW = new Date('2026-11-10T12:00:00Z')
const cases: [string, { title: RegExp; deadline?: string; time?: string; opens?: string; uni?: RegExp; levels?: string[]; country?: string }][] = [
  ['nottingham', { title: /PhD Scholarships/, deadline: '2027-01-08', time: '17:00', uni: /Nottingham/, levels: ['phd'] }],
  ['agrictech', { title: /AGRICTECH SCHOLARSHIP PROGRAM 2026\/2027/i, deadline: '2026-11-30', opens: '2026-11-01', levels: ['undergraduate'] }],
  ['bet9ja', { title: /BET9JA FOUNDATION SCHOLARSHIP 2027/i, deadline: '2026-12-20', opens: '2026-11-10', levels: ['undergraduate'] }],
  ['oxford', { title: /EIT Graduate Scholarships 2027/, deadline: '2027-02-01', uni: /Oxford/ }],
  ['jads', { title: /Japan Africa Dream Scholarship/, deadline: '2026-11-17', uni: /Tokyo/, levels: ['masters'], country: 'Japan' }],
  ['liu', { title: /Liu Shiming Art Scholarship/, deadline: '2026-11-22' }],
  ['mcmaster', { title: /recruiting fully funded/, uni: /McMaster/, levels: ['masters', 'phd'], country: 'Canada' }],
]
describe.skipIf(!mod)('real LinkedIn posts, offline reader', () => {
  for (const [key, want] of cases) {
    it(key, () => {
      const r = heuristicParse(P[key], undefined, NOW)
      expect(r.title ?? '').toMatch(want.title)
      const main = r.deadlines.find((d) => d.kind !== 'opens')
      expect(main?.date).toBe(want.deadline)
      if (want.time) expect(main?.time).toBe(want.time)
      if (want.opens) expect(r.deadlines.find((d) => d.kind === 'opens')?.date).toBe(want.opens)
      if (want.uni) expect(r.university ?? '').toMatch(want.uni)
      if (want.levels) expect(r.criteria?.degreeLevels).toEqual(want.levels)
      if (want.country) expect(r.country).toBe(want.country)
      // none of these genuine posts should be accused of asking for money
      expect(detectScamFlags(P[key], 'https://www.linkedin.com/posts/x', '', 'linkedin').filter((f) => f.severity === 'high')).toEqual([])
    })
  }
})
