// Real-world edge cases, feature by feature.
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { findDates, isValidISO, fmtDate, toUserZone, daysLeft } from '../src/lib/dates'
import { heuristicParse } from '../src/lib/heuristic'
import { safeUrl, tidyUrl, canonicalUrl } from '../src/lib/url'
import { sanitizeApp, sanitizeDeadlines, normalizeTz, normalizeTime } from '../src/lib/sanitize'
import { evaluate } from '../src/lib/eligibility'
import { newApplication, saveParsed, findDuplicate } from '../src/lib/ingest'
import { importAll, defaultState, getState, upsertOrg, patchApp, DEFAULT_FIELDS, setTasksForApp, toggleTask, addTask } from '../src/lib/store'
import { dueReminders } from '../src/lib/reminders'
import { splitInput } from '../src/lib/capture'
import { toCSV, parseCSV, rowsToApplications, guessMapping } from '../src/lib/csv'
import { buildICS } from '../src/lib/ics'
import { buildSnapshot, encodeSnapshot, decodeSnapshot } from '../src/lib/share'
import { generateTasks } from '../src/lib/planner'
import type { ParseResult, Profile } from '../src/lib/types'

const reset = (profile: Partial<Profile> = {}) => { const s = defaultState(); s.profile = { ...s.profile, onboarded: true, tz: 'Africa/Lagos', ...profile }; importAll(JSON.stringify({ app: 'trackr', version: 1, state: s })) }
const NOV10 = new Date('2026-11-10T12:00:00Z')
const pr = (p: Partial<ParseResult>): ParseResult => ({ deadlines: [], requirements: [], custom: {}, confidence: {}, evidence: {}, mode: 'gemini', ...p })
beforeEach(() => reset())

describe('dates people actually write', () => {
  it('a date with no year means the next one, not last January', () => {
    expect(findDates('Deadline: 15 January', NOV10)[0].date).toBe('2027-01-15')
    expect(findDates('Deadline: 30th November', NOV10)[0].date).toBe('2026-11-30')
  })
  it('reads US order when day-first is impossible, and two-digit years', () => {
    expect(findDates('closes 11/30/2026', NOV10)[0].date).toBe('2026-11-30')
    expect(findDates('closes 30/11/26', NOV10)[0].date).toBe('2026-11-30')
    expect(findDates('closes 05/12/2026', NOV10)[0].date).toBe('2026-12-05')
  })
  it('rejects dates that do not exist and the word "may"', () => {
    expect(findDates('due 31 February 2027', NOV10)).toHaveLength(0)
    expect(findDates('the top 12 may apply again', NOV10)).toHaveLength(0)
    expect(findDates('due 12 May 2027', NOV10)[0].date).toBe('2027-05-12')
    expect(isValidISO('2026-02-30')).toBe(false)
    expect(fmtDate('garbage')).toBe('garbage')
  })
  it('a midnight deadline abroad can be the next morning at home', () => {
    const d = { id: 'd', kind: 'scholarship' as const, date: '2026-11-30', time: '23:59', tz: 'America/Los_Angeles' }
    expect(toUserZone(d, 'Africa/Lagos')).toMatchObject({ date: '2026-12-01', time: '08:59' })
    expect(daysLeft(d, 'Africa/Lagos', NOV10)).toBe(21)
    // and an early-morning deadline in Tokyo is the evening before in Lagos
    expect(toUserZone({ ...d, time: '05:00', tz: 'Asia/Tokyo' }, 'Africa/Lagos')).toMatchObject({ date: '2026-11-29', time: '21:00' })
  })
  it('an unknown time zone never crashes anything', () => {
    const d = { id: 'd', kind: 'scholarship' as const, date: '2026-11-30', time: '23:59', tz: 'Mars/Olympus' }
    expect(toUserZone(d, 'Africa/Lagos').date).toBe('2026-11-30')
    expect(normalizeTz('WAT')).toBe('Africa/Lagos')
    expect(normalizeTz('Mars/Olympus')).toBeUndefined()
    expect(normalizeTime('11:59 PM')).toBe('23:59')
    expect(normalizeTime('25:00')).toBeUndefined()
    expect(() => buildICS([{ uid: 'a', title: 'x', date: '2026-11-30', time: '23:59', tz: 'Europe/London' }], 'Africa/Lagos')).not.toThrow()
  })
})

describe('offline reader on messy posts', () => {
  it('"Bachelor\'s degree required" does not make it an undergraduate award', () => {
    const r = heuristicParse("Fully funded Master's and PhD positions at McMaster University in Canada.\nRequirements: Bachelor's in Mechanical Engineering.")
    expect(r.criteria?.degreeLevels).toEqual(['masters', 'phd'])
  })
  it('does not turn "under 50 applicants" into an age limit', () => {
    expect(heuristicParse('Scholarship for under 50 applicants this year').criteria?.maxAge).toBeUndefined()
    expect(heuristicParse('Applicants must be under 35 years old. Scholarship.').criteria?.maxAge).toBe(35)
  })
  it('reads times like 5pm WAT and midnight', () => {
    const a = heuristicParse('XYZ Scholarship. Deadline: 30 November 2026, 5pm WAT.').deadlines[0]
    expect(a).toMatchObject({ date: '2026-11-30', time: '17:00', tz: 'Africa/Lagos' })
    expect(heuristicParse('XYZ Scholarship closes 30 November 2026 at midnight GMT').deadlines[0]).toMatchObject({ time: '23:59', tz: 'UTC' })
  })
  it('survives empty, emoji-only and enormous input', () => {
    expect(() => heuristicParse('')).not.toThrow()
    expect(() => heuristicParse('🎓🎓🎓')).not.toThrow()
    expect(() => heuristicParse('scholarship '.repeat(50000))).not.toThrow()
  })
})

describe('links and untrusted input', () => {
  it('never lets a script link through', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('')
    expect(safeUrl('data:text/html,<script>')).toBe('')
    expect(tidyUrl('chevening.org/apply')).toBe('https://chevening.org/apply')
    expect(tidyUrl('javascript:alert(1)')).toBe('')
    const a = sanitizeApp({ title: 'X', officialUrl: 'javascript:alert(1)', sourceUrl: 'https://ok.org/a', deadlines: [{ date: '2026-13-45' }, { date: '2026-12-01', time: '9:5', tz: 'Nope' }], status: 'hacked', requirements: 'no', thumbnail: 'data:text/html;base64,AAAA' })!
    expect(a.officialUrl).toBe(''); expect(a.sourceUrl).toBe('https://ok.org/a'); expect(a.status).toBe('saved'); expect(a.thumbnail).toBeUndefined()
    expect(a.deadlines).toHaveLength(1); expect(a.deadlines[0].time).toBeUndefined()
  })
  it('a tampered share link cannot crash or inject', async () => {
    const good = await encodeSnapshot(buildSnapshot(newApplication({ title: 'Chevening', deadlines: [{ id: 'd', kind: 'scholarship', date: '2026-12-01' }] }), 'friend', 'Oxford', 'Ada'))
    expect((await decodeSnapshot(good))?.title).toBe('Chevening')
    expect(await decodeSnapshot('g.not-base64!!')).toBeNull()
    expect(await decodeSnapshot('')).toBeNull()
    const evil = 'p.' + btoa(JSON.stringify({ v: 1, title: 'T', mode: 'friend', deadlines: 'x', requirements: [{ label: 5 }], officialUrl: 'javascript:alert(1)', funding: null, criteria: 7 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const s = await decodeSnapshot(evil)
    expect(s).toMatchObject({ title: 'T', deadlines: [], requirements: [], officialUrl: '' })
  })
  it('a broken or hostile backup is repaired, not trusted', () => {
    importAll(JSON.stringify({ app: 'trackr', state: { apps: [{ id: 'a1', title: 'Old', deadlines: null }, null, 'x', { id: 'a1', title: 'dupe id' }], fields: [], orgs: 'no', tasks: [{ id: 't', applicationId: 'gone', due: '2026-01-01', label: 'x' }], profile: { tz: 'Nope/Zone', remindDays: 'x', view: 'weird' } } }))
    const st = getState()
    expect(st.apps).toHaveLength(1); expect(st.apps[0].deadlines).toEqual([])
    expect(st.fields.length).toBeGreaterThanOrEqual(DEFAULT_FIELDS.length)
    expect(st.tasks).toEqual([]); expect(st.profile.view).toBe('list'); expect(st.profile.tz).not.toBe('Nope/Zone')
    expect(() => importAll('{"app":"other"}')).toThrow()
    expect(() => importAll('not json')).toThrow()
  })
})

describe('universities', () => {
  it('matches word order but never merges a campus into its parent', () => {
    const a = upsertOrg('University of Cambridge', 'university')
    expect(upsertOrg('Cambridge University', 'university')).toBe(a)
    expect(upsertOrg('university of cambridge ', 'university')).toBe(a)
    const b = upsertOrg('University of California', 'university')
    expect(upsertOrg('University of California, Berkeley', 'university')).not.toBe(b)
    expect(upsertOrg('Lagos State University', 'university')).not.toBe(upsertOrg('University of Lagos', 'university'))
  })
})

describe('eligibility', () => {
  const app = (c: any) => newApplication({ criteria: { nationalities: [], degreeLevels: [], fields: [], other: [], ...c } })
  it('unknown nationality is "check", never an automatic yes', () => {
    reset({ nationality: '' })
    expect(evaluate(app({ nationalities: ['Kenyan'], degreeLevels: ['masters'] }), { ...getState().profile, degreeLevel: 'Masters' }).verdict).toBe('check')
  })
  it('"South African citizens" is not "all Africans"; "Sub-Saharan Africa" is', () => {
    const p = { ...getState().profile, nationality: 'Nigerian', degreeLevel: 'Masters' }
    expect(evaluate(app({ nationalities: ['South African citizens'], degreeLevels: ['masters'] }), p).verdict).toBe('not_eligible')
    expect(evaluate(app({ nationalities: ['Sub-Saharan Africa'], degreeLevels: ['masters'] }), p).verdict).toBe('eligible')
    expect(evaluate(app({ nationalities: ['Nigeria'], degreeLevels: ["Master's"] }), p).verdict).toBe('eligible')
    expect(evaluate(app({ nationalities: ['Malawian', 'Liberian'], degreeLevels: ['masters'] }), { ...p, nationality: 'Liberian' }).verdict).toBe('eligible')
  })
  it('"Any" level and a higher GPA requirement', () => {
    const p = { ...getState().profile, nationality: 'Nigerian', degreeLevel: 'Any', gpa: 3.2 }
    // 3.2 against "3.5" might be different scales (4.0 vs 5.0), so it is a prompt to check, never an automatic no
    expect(evaluate(app({ nationalities: ['international students'], degreeLevels: ['phd'], minGpa: 3.5 }), p).verdict).toBe('check')
    expect(evaluate(app({ nationalities: ['international students'], degreeLevels: ['phd'] }), { ...p, degreeLevel: 'Masters' }).verdict).toBe('not_eligible')
  })
})

describe('adding things', () => {
  it('splits a pasted digest into separate opportunities but keeps one post whole', () => {
    expect(splitInput('https://a.org/x')).toEqual([{ kind: 'link', url: 'https://a.org/x' }])
    expect(splitInput('https://a.org/x\nhttps://b.org/y').map((i) => i.url)).toEqual(['https://a.org/x', 'https://b.org/y'])
    const digest = '1. Chevening Scholarship for UK masters, fully funded.\nApply: https://chevening.org/a\n\n2. DAAD EPOS scholarships for development courses in Germany.\nApply: https://daad.de/b'
    expect(splitInput(digest)).toHaveLength(2)
    const one = 'Great news! The Chevening Scholarship is open.\n\nRead more: https://chevening.org/a\n\nForm: https://forms.gle/zz'
    expect(splitInput(one)).toHaveLength(1)
    expect(splitInput('   ')).toEqual([])
    expect(splitInput('just some text with no link at all')[0].kind).toBe('paste')
  })
  it('re-adding an unchecked entry refreshes it and keeps ticks, status and notes', () => {
    const first = saveParsed(pr({ title: 'Wrong Name From A Comment', requirements: [{ label: 'CV', kind: 'document' }] }), { sourceUrl: 'https://lnkd.in/p/abc', rawText: '', fields: DEFAULT_FIELDS })
    const a0 = getState().apps[0]
    patchApp(first.id, { notes: 'mine', status: 'preparing', requirements: a0.requirements.map((r) => ({ ...r, done: true })) })
    const again = saveParsed(pr({ title: 'McMaster funded MSc and PhD positions', university: 'McMaster University', requirements: [{ label: 'CV', kind: 'document' }, { label: 'Transcripts', kind: 'document' }] }), { sourceUrl: 'https://lnkd.in/p/abc', rawText: '', fields: DEFAULT_FIELDS })
    expect(again).toMatchObject({ id: first.id, duplicate: true, refreshed: true })
    const a = getState().apps
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ title: 'McMaster funded MSc and PhD positions', notes: 'mine', status: 'preparing' })
    expect(a[0].requirements.find((r) => r.label === 'CV')?.done).toBe(true)
  })
  it('a confirmed entry is never overwritten, and tracking junk in links does not create duplicates', () => {
    const one = saveParsed(pr({ title: 'Chevening' }), { sourceUrl: 'https://www.chevening.org/apply/?utm_source=wa', rawText: '', fields: DEFAULT_FIELDS })
    patchApp(one.id, { verified: true, needsReview: false })
    const two = saveParsed(pr({ title: 'Something else' }), { sourceUrl: 'https://chevening.org/apply?fbclid=123', rawText: '', fields: DEFAULT_FIELDS })
    expect(two).toMatchObject({ id: one.id, duplicate: true }); expect(two.refreshed).toBeUndefined()
    expect(getState().apps[0].title).toBe('Chevening')
    expect(canonicalUrl('https://M.Example.com/a/?utm_medium=x#frag')).toBe('https://example.com/a')
  })
  it('a short link is stored as the real address and matched next time', () => {
    const one = saveParsed(pr({ title: 'Post A', fetchedUrl: 'https://www.linkedin.com/posts/someone_abc-123/?utm_source=share' }), { sourceUrl: 'https://lnkd.in/p/abc', rawText: '', fields: DEFAULT_FIELDS })
    expect(getState().apps[0].sourceUrl).toContain('linkedin.com/posts/someone_abc-123')
    expect(findDuplicate('https://www.linkedin.com/posts/someone_abc-123/', '', '')?.id).toBe(one.id)
  })
  it('junk from the model is cleaned before it is stored', () => {
    saveParsed(pr({ title: 'T'.repeat(500), deadlines: [{ kind: 'scholarship', date: '2026-02-31' }, { kind: 'scholarship', date: '2026-12-01', time: '11:59 PM', tz: 'WAT' }, { kind: 'scholarship', date: '2026-12-01' }], officialUrl: 'javascript:alert(1)', applicationUrl: 'ftp://x' }), { sourceUrl: '', rawText: '', fields: DEFAULT_FIELDS })
    const a = getState().apps[0]
    expect(a.title.length).toBeLessThanOrEqual(200); expect(a.officialUrl).toBe('')
    expect(a.deadlines).toEqual([expect.objectContaining({ date: '2026-12-01', time: '23:59', tz: 'Africa/Lagos' })])
    expect(a.requirements).toEqual([])
  })
})

describe('plan and reminders', () => {
  const withDeadline = (date: string) => { saveParsed(pr({ title: 'S', deadlines: [{ kind: 'scholarship', date }] }), { sourceUrl: '', rawText: '', fields: DEFAULT_FIELDS }); return getState().apps[0] }
  it('a reminder still fires if the app was not opened on the exact day, and only once per stage', () => {
    const a = withDeadline('2026-11-15') // 5 days after NOV10
    const p = getState().profile
    const r = dueReminders([a], p, NOV10)
    expect(r).toHaveLength(1); expect(r[0].text).toContain('in 5 days')
    expect(dueReminders([a], p, new Date('2026-11-11T12:00:00Z'))[0].id).toBe(r[0].id) // same "7 day" stage
    expect(dueReminders([a], p, new Date('2026-11-12T12:00:00Z'))[0].id).not.toBe(r[0].id) // 3 day stage
    expect(dueReminders([a], p, new Date('2026-11-20T12:00:00Z'))).toHaveLength(0) // passed
    expect(dueReminders([{ ...a, status: 'submitted' }], p, NOV10)).toHaveLength(0)
    expect(dueReminders([{ ...a, deadlines: [{ ...a.deadlines[0], date: '2026-11-16' }] }], p, NOV10)[0].id).not.toBe(r[0].id) // moved date reminds again
  })
  it('the plan never lands in the past and keeps the user\'s own work on rebuild', () => {
    const near = newApplication({ deadlines: [{ id: 'd', kind: 'scholarship', date: '2026-11-13' }] })
    const t = generateTasks(near, 'Africa/Lagos', NOV10)
    expect(t.length).toBeGreaterThan(0); expect(t.every((x) => x.due >= '2026-11-10')).toBe(true)
    expect(generateTasks(newApplication({ deadlines: [{ id: 'd', kind: 'scholarship', date: '2026-11-01' }] }), 'Africa/Lagos', NOV10)).toEqual([])
    const a = withDeadline('2027-06-01')
    const mine = getState().tasks.filter((x) => x.applicationId === a.id)
    toggleTask(mine[0].id)
    addTask({ id: 'own', applicationId: a.id, label: 'Email Prof', due: '2027-01-01', done: false, auto: false })
    setTasksForApp(a.id, generateTasks(a, 'Africa/Lagos'))
    const after = getState().tasks.filter((x) => x.applicationId === a.id)
    expect(after.find((x) => x.id === 'own')).toBeTruthy()
    expect(after.find((x) => x.label === mine[0].label)?.done).toBe(true)
  })
  it('adding the first deadline by hand builds the plan', () => {
    const one = saveParsed(pr({ title: 'No date yet' }), { sourceUrl: '', rawText: '', fields: DEFAULT_FIELDS })
    expect(getState().tasks).toHaveLength(0)
    patchApp(one.id, { deadlines: [{ id: 'd', kind: 'scholarship', date: '2027-09-01' }] })
    expect(getState().tasks.length).toBeGreaterThan(0)
  })
})

describe('spreadsheets', () => {
  it('defuses formulas on export and reads awkward files on import', () => {
    expect(toCSV([['=HYPERLINK("http://evil")', '-5', 'ok']])).toBe(`"'=HYPERLINK(""http://evil"")",-5,ok`)
    const rows = parseCSV('﻿Name;School;Due;Stage\r\n"Line1\nLine2";Oxford;46300;Applied\r\n;;;\r\nOnly title;;;\r\n')
    expect(rows).toHaveLength(3)
    const apps = rowsToApplications(rows.slice(1), guessMapping(rows[0]), DEFAULT_FIELDS)
    expect(apps[0]).toMatchObject({ title: 'Line1\nLine2', status: 'submitted' })
    expect(apps[0].deadlines[0].date).toBe('2026-10-05')
    expect(apps[1].deadlines).toEqual([])
    expect(rowsToApplications([['x', 'javascript:alert(1)']], { title: 0, link: 1, institution: -1, funder: -1, deadline: -1, status: -1, country: -1, notes: -1 }, DEFAULT_FIELDS)[0].sourceUrl).toBe('')
  })
})

describe('offline reader: fees', () => {
  it('"There is no application fee" is not a fee requirement', () => {
    expect(heuristicParse('Acme Scholarship 2027. There is no application fee.').requirements.map((r) => r.label)).not.toContain('Application fee')
    expect(heuristicParse('Acme Scholarship 2027. An application fee of $50 applies.').requirements.map((r) => r.label)).toContain('Application fee')
  })
})
