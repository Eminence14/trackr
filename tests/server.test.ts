// The server under load and under attack. Network calls are replaced with counters, so this runs offline.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { limiter, gate, singleFlight, breaker, memoryStore } from '../server/infra'
import { handleParse, handleTrending, _aiBreaker } from '../server/parse'
import { compareDeadline, dueForRecheck } from '../src/lib/recheck'
import { newApplication } from '../src/lib/ingest'
import { reminderRows } from '../src/lib/cloud'
import { defaultState } from '../src/lib/store'

const PAGE = `<html><head><title>Acme Scholarship 2027</title></head><body><h1>Acme Scholarship 2027</h1><p>${'The Acme Scholarship 2027 supports masters students at Acme University. '.repeat(6)}</p><p>Deadline: 30 November 2026.</p><p>Comments</p></body></html>`
const AI = { title: 'Acme Scholarship 2027', university: 'Acme University', deadlines: [{ kind: 'scholarship', date: '2026-11-30', confidence: 0.95, evidence: 'Deadline: 30 November 2026' }], fundingType: 'unknown', requirements: [] }
let calls: { page: number; ai: number; models: string[] }
let aiStatus: (model: string) => number
let aiDelay = 0
const post = (body: unknown, client = 'c1', store = memoryStore()) => handleParse(new Request('http://x/api/parse', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), { store, clientId: client, budgetMs: 8000 })

beforeEach(() => {
  calls = { page: 0, ai: 0, models: [] }
  aiStatus = () => 200
  aiDelay = 0
  _aiBreaker.reset()
  process.env.GEMINI_API_KEY = 'test-key'
  process.env.READER_FALLBACK = 'off'
  vi.stubGlobal('fetch', async (input: any, init?: RequestInit) => {
    const url = String(input?.url ?? input)
    if (url.includes('generativelanguage')) {
      calls.ai++
      const model = /models\/([^:]+):/.exec(url)![1]
      calls.models.push(model)
      if (aiDelay) await new Promise((r, rej) => { const t = setTimeout(r, aiDelay); init?.signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')) }) })
      const st = aiStatus(model)
      return st === 200 ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(AI) }] } }] }), { status: 200 }) : new Response('quota', { status: st })
    }
    calls.page++
    return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } })
  })
})
afterEach(() => { vi.unstubAllGlobals(); delete process.env.GEMINI_API_KEY })

describe('building blocks', () => {
  it('limiter allows a burst then says when to come back', () => {
    const l = limiter(3, 60_000)
    expect([1, 2, 3].map(() => l('a', 1000).ok)).toEqual([true, true, true])
    expect(l('a', 2000)).toMatchObject({ ok: false, retryAfter: 59 })
    expect(l('b', 2000).ok).toBe(true) // someone else is unaffected
    expect(l('a', 62_000).ok).toBe(true)
  })
  it('gate never runs more than its limit and gives up politely', async () => {
    const g = gate(2)
    let now = 0, peak = 0
    const job = () => g(async () => { now++; peak = Math.max(peak, now); await new Promise((r) => setTimeout(r, 20)); now-- }, 1000)
    await Promise.all(Array.from({ length: 10 }, job))
    expect(peak).toBe(2)
    const slow = gate(1)
    const hold = slow(() => new Promise((r) => setTimeout(r, 100)), 10)
    await expect(slow(async () => 1, 10)).rejects.toThrow('busy')
    await hold
  })
  it('single flight shares one result; breaker opens and closes; store expires and stays bounded', async () => {
    const f = singleFlight<number>()
    let n = 0
    const out = await Promise.all(Array.from({ length: 5 }, () => f('k', async () => { n++; await new Promise((r) => setTimeout(r, 10)); return 7 })))
    expect(out).toEqual([7, 7, 7, 7, 7]); expect(n).toBe(1)
    const b = breaker(); b.trip(1000, 0); expect(b.open(500)).toBe(true); expect(b.open(1500)).toBe(false)
    const s = memoryStore(2); await s.set('a', 1, 60); await s.set('b', 2, 60); await s.set('c', 3, 60)
    expect(await s.get('a')).toBeUndefined(); expect(await s.get('c')).toBe(3)
    await s.set('d', 4, -1); expect(await s.get('d')).toBeUndefined()
  })
})

describe('parse endpoint', () => {
  it('rejects junk without doing any work', async () => {
    expect((await post('not json')).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect((await post({ url: 5 })).status).toBe(400)
    expect((await post({ url: 'https://a.org/' + 'x'.repeat(3000) })).status).toBe(400)
    expect((await post({ images: Array.from({ length: 7 }, () => ({ mime: 'image/png', data: 'AA' })) })).status).toBe(400)
    expect((await post({ text: 'x'.repeat(9_000_000) })).status).toBe(413)
    expect(calls).toMatchObject({ page: 0, ai: 0 })
  })
  it('a link that goes viral is fetched and read once', async () => {
    const store = memoryStore()
    const all = await Promise.all(Array.from({ length: 25 }, (_, i) => post({ url: 'https://acme.example.org/s?utm_source=wa' + (i % 3) }, 'user' + i, store)))
    const bodies = await Promise.all(all.map((r) => r.json()))
    expect(bodies.every((b) => b.title === 'Acme Scholarship 2027')).toBe(true)
    expect(calls).toMatchObject({ page: 1, ai: 1 })
    const later = await (await post({ url: 'https://acme.example.org/s' }, 'late', store)).json()
    expect(later.cached).toBe(true); expect(calls.ai).toBe(1)
    // and it shows up as trending without any user identity attached
    const trend = await (await handleTrending(new Request('http://x'), { store })).json()
    expect(trend.items[0]).toMatchObject({ url: 'https://acme.example.org/s', title: 'Acme Scholarship 2027' })
    expect(JSON.stringify(trend)).not.toContain('user')
  })
  it('pasted text and screenshots are never cached on the server', async () => {
    const store = memoryStore()
    const text = 'Acme Scholarship 2027 at Acme University. '.repeat(8) + 'Deadline: 30 November 2026'
    await post({ text }, 'a', store); await post({ text }, 'b', store)
    expect(calls.ai).toBe(2)
  })
  it('one person cannot flood it, and others are not affected', async () => {
    const store = memoryStore()
    const res = []
    for (let i = 0; i < 25; i++) res.push(await post({ url: 'https://acme.example.org/p' + i }, 'spammer', store))
    expect(res.filter((r) => r.status === 429).length).toBe(5)
    expect(res.find((r) => r.status === 429)!.headers.get('retry-after')).toBeTruthy()
    expect((await post({ url: 'https://acme.example.org/other' }, 'someone-else', store)).status).toBe(200)
  })
  it('falls back to the lighter model, then pauses the AI and still answers', async () => {
    aiStatus = (m) => (m.includes('lite') ? 429 : 200)
    const ok = await (await post({ url: 'https://acme.example.org/a' })).json()
    expect(ok.mode).toBe('gemini'); expect(calls.models.length).toBe(4); expect(calls.models.at(-1)).not.toContain('lite') // three quick models, then the full one
    aiStatus = () => 429
    const degraded = await (await post({ url: 'https://acme.example.org/b' })).json()
    expect(degraded.mode).toBe('none'); expect(degraded.sourceText).toContain('Acme Scholarship') // the app reads this text itself
    const before = calls.ai
    await post({ url: 'https://acme.example.org/c' })
    expect(calls.ai).toBe(before) // breaker is open: no more hammering
  })
  it('gives up on a slow AI inside the time budget instead of hanging', async () => {
    aiDelay = 30_000
    const t = Date.now()
    const r = await (await handleParse(new Request('http://x', { method: 'POST', body: JSON.stringify({ url: 'https://acme.example.org/slow' }) }), { store: memoryStore(), clientId: 'z', budgetMs: 3000 })).json()
    expect(Date.now() - t).toBeLessThan(4500)
    expect(r.mode).toBe('none')
  }, 10_000)
  it('refuses private addresses', async () => {
    for (const url of ['http://localhost:8080/x', 'http://127.0.0.1/', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://2130706433/', 'file:///etc/passwd', 'ftp://x.org/a']) {
      const r = await (await post({ url }, 'p' + url)).json()
      expect(r.blocked).toBe(true)
    }
    expect(calls.page).toBe(0)
  })
})

describe('weekly re-check and email rows', () => {
  it('re-checks only open applications with a readable page, oldest first', () => {
    const old = new Date(Date.now() - 9 * 86_400_000).toISOString()
    const mk = (p: any) => newApplication({ createdAt: old, lastCheckedAt: old, officialUrl: 'https://acme.org/a', ...p })
    const list = [mk({ id: 'a' }), mk({ id: 'b', status: 'submitted' }), mk({ id: 'c', officialUrl: '', sourceUrl: 'https://lnkd.in/x' }), mk({ id: 'd', lastCheckedAt: new Date().toISOString() })]
    expect(dueForRecheck(list).map((a) => a.id)).toEqual(['a'])
  })
  it('a changed deadline is proposed, never applied silently', () => {
    const a = newApplication({ deadlines: [{ id: 'd', kind: 'scholarship', date: '2026-11-30' }] })
    expect(compareDeadline(a, { date: '2026-11-30' }, 'now').changeNote).toBeUndefined()
    const p = compareDeadline(a, { date: '2026-12-15' }, 'now')
    expect(p).toMatchObject({ pendingDeadline: { date: '2026-12-15' }, needsReview: true }); expect(p.deadlines).toBeUndefined()
    expect(compareDeadline(a, undefined, 'now')).toEqual({ lastCheckedAt: 'now' })
  })
  it('email rows use the date in the user\'s time zone', () => {
    const st = defaultState(); st.profile.tz = 'Africa/Lagos'
    st.apps = [newApplication({ id: 'a', title: 'S', deadlines: [{ id: 'd', kind: 'scholarship', date: '2026-11-30', time: '23:59', tz: 'America/Los_Angeles' }, { id: 'o', kind: 'opens', date: '2026-11-01' }] })]
    expect(reminderRows(st, 'u1')).toEqual([expect.objectContaining({ user_id: 'u1', application_id: 'a', due_on: '2026-12-01' })])
  })
})

import { backfill } from '../server/parse'
import { heuristicParse } from '../src/lib/heuristic'
describe('two readers', () => {
  const text = 'University of Oxford - The EIT Graduate Scholarships 2027 (Fully Funded)\n\nFull funding for doctoral study at the University of Oxford\n\nDeadline: February 01, 2027'
  const h = heuristicParse(text, undefined, new Date('2026-11-10T12:00:00Z'))
  const ai = (p: any) => ({ deadlines: [], requirements: [], custom: {}, confidence: {}, evidence: {}, ...p })
  it('fills a deadline the AI missed, marked as unsure', () => {
    const r = backfill(ai({ title: 'The EIT Graduate Scholarships 2027' }), h)
    expect(r.deadlines[0]).toMatchObject({ kind: 'scholarship', date: '2027-02-01' })
    expect(r.confidence.deadline).toBeLessThan(0.7)
    expect(r.criteria?.degreeLevels).toContain('phd'); expect(r.university).toMatch(/Oxford/)
  })
  it('keeps the AI answer but flags it when the readers disagree', () => {
    const r = backfill(ai({ title: 'T', deadlines: [{ kind: 'scholarship', date: '2027-01-02' }], confidence: { deadline: 0.95 } }), h)
    expect(r.deadlines).toHaveLength(1); expect(r.deadlines[0].date).toBe('2027-01-02')
    expect(r.confidence.deadline).toBeLessThan(0.7); expect(r.notes).toContain('2027-02-01')
  })
  it('changes nothing when they agree', () => {
    const r = backfill(ai({ title: 'T', deadlines: [{ kind: 'scholarship', date: '2027-02-01' }], confidence: { deadline: 0.95 } }), h)
    expect(r.confidence.deadline).toBe(0.95); expect(r.notes).toBeUndefined()
  })
})

import { fromModel, ground } from '../server/parse'
describe('cleaning the AI answer', () => {
  it('treats 0 as "not stated", drops filler requirements and rambling names', () => {
    const r = fromModel({ title: 'T', university: 'public universities in Nigeria', funder: 'x '.repeat(40), minGpa: 0, amount: 0, requirements: [{ label: 'Check the website for details' }, { label: 'Academic transcript' }], deadlines: [] }, [])
    expect(r.criteria.minGpa).toBeUndefined(); expect(r.funding.amount).toBeUndefined()
    expect(r.requirements.map((q: { label: string }) => q.label)).toEqual(["Academic transcript"])
    expect(r.university).toBeUndefined(); expect(r.funder).toBeUndefined()
    expect(fromModel({ university: 'University of Nottingham' }, []).university).toBe('University of Nottingham')
  })
  it('a short link is kept as the place to apply, not presented as the official page', () => {
    const src = 'Acme Scholarship 2027. More information and how to apply: https://lnkd.in/eVdZ2-vX'
    const { result } = ground({ title: 'Acme Scholarship 2027', officialUrl: 'https://lnkd.in/eVdZ2-vX', deadlines: [], requirements: [], custom: {}, confidence: {}, evidence: {} } as any, src, false)
    expect(result.applicationUrl).toBe('https://lnkd.in/eVdZ2-vX')
  })
})
