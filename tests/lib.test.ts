import { describe, it, expect } from 'vitest'
import { findDates, zonedToInstant, diffDays, addDays, toUserZone } from '../src/lib/dates'
import { heuristicParse } from '../src/lib/heuristic'
import { detectScamFlags } from '../src/lib/scam'
import { extractUrls, canonicalUrl, sourceKindOf, isLikelyOfficial } from '../src/lib/url'
import { parseCSV, toCSV, guessMapping, statusFromText } from '../src/lib/csv'
import { buildICS } from '../src/lib/ics'

describe('dates', () => {
  it('finds several date formats', () => {
    const f = findDates('Deadline: 7 October 2026, also Nov 3, 2026 and 2026-12-01').map((x) => x.date)
    expect(f).toEqual(expect.arrayContaining(['2026-10-07', '2026-11-03', '2026-12-01']))
  })
  it('does arithmetic on date strings', () => {
    expect(diffDays('2026-10-07', '2026-10-01')).toBe(6)
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
  })
  it('converts deadlines between time zones', () => {
    expect(toUserZone({ id: 'x', kind: 'scholarship', date: '2026-10-07', time: '23:59', tz: 'America/New_York' }, 'Africa/Lagos')).toMatchObject({ date: '2026-10-08', time: '04:59' })
    expect(zonedToInstant('2026-01-01', '00:00', 'UTC')).toBe(Date.UTC(2026, 0, 1))
  })
})

describe('heuristic parser', () => {
  const post = `Chevening Scholarship 2027/28 for Nigerian students\nFully funded Master's scholarship at any UK university.\nCovers tuition, monthly stipend, flights and visa.\nApplications close on 7 October 2026 at 12:00 BST.\nRequirements: academic transcripts, 2 references, personal statement, IELTS.\nApply at https://www.chevening.org/scholarship/nigeria/`
  const r = heuristicParse(post)
  it('extracts the basics', () => {
    expect(r.title).toMatch(/Chevening/)
    expect(r.deadlines[0]).toMatchObject({ kind: 'scholarship', date: '2026-10-07' })
    expect(r.officialUrl).toContain('chevening.org')
  })
})

describe('scam flags', () => {
  it('flags payment requests', () => {
    const f = detectScamFlags('Apply now for this funded programme open to all students in Africa. '.repeat(4) + 'Pay a processing fee of $50 to secure your slot', 'https://x.com/a', '', 'x')
    expect(f.length).toBeGreaterThan(0)
  })
})

describe('urls', () => {
  it('extracts and canonicalises links', () => {
    expect(extractUrls('see https://example.com/a?utm_source=x, and (https://b.org/c).')).toHaveLength(2)
    expect(canonicalUrl('https://www.example.com/a/?utm_source=x&id=2#top')).toBe('https://example.com/a?id=2')
  })
  it('classifies sources', () => {
    expect(sourceKindOf('https://x.com/foo/status/1')).toBe('x')
    expect(sourceKindOf('https://www.linkedin.com/posts/abc')).toBe('linkedin')
    expect(isLikelyOfficial('https://some-random-blog.com/post')).toBe(false)
  })
})

describe('csv', () => {
  it('parses quoted cells and guesses columns', () => {
    const rows = parseCSV('Scholarship,University,Deadline,Status\n"Chevening, UK",Oxford,2026-10-07,Not applied\n')
    expect(rows[1][0]).toBe('Chevening, UK')
    expect(guessMapping(rows[0])).toMatchObject({ title: 0, institution: 1, deadline: 2, status: 3 })
    expect(toCSV(rows)).toContain('"Chevening, UK"')
    expect(statusFromText('Not applied')).toBe('saved')
    expect(statusFromText('Applied')).toBe('submitted')
  })
})

describe('ics', () => {
  it('builds all-day and timed events', () => {
    const ics = buildICS([{ uid: 'a', title: 'Closes', date: '2026-10-07' }, { uid: 'b', title: 'Timed', date: '2026-10-07', time: '12:00', tz: 'UTC' }], 'Africa/Lagos')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261007')
    expect(ics).toContain('DTEND;VALUE=DATE:20261008')
    expect(ics).toContain('DTSTART:20261007T120000Z')
  })
})

describe('heuristic title fallback', () => {
  it('uses the first sentence of a one-paragraph post', () => {
    const r = heuristicParse('Chevening Scholarship 2027/28 for Nigerian students at any UK university. Fully funded. Applications close on 7 October 2027.')
    expect(r.title).toBe('Chevening Scholarship 2027/28')
  })
})

describe('scam flags need real content', () => {
  it('raises nothing when nothing was read', () => {
    expect(detectScamFlags('', 'https://scholarshipregion.com', '', 'blog')).toEqual([])
  })
})

import { stripThread, coverage, ground } from '../server/parse'
import type { ParseResult } from '../src/lib/types'

describe('grounding against the source text', () => {
  const post = "I'm recruiting fully funded Master's and PhD students at McMaster University in Canada for Fall 2027. ".repeat(2) + 'Interested? Please fill out the form linked in the first comment.'
  const thread = post + '\n\nMost relevant\n\nDr. Ryan Ahmed\nAuthor\nPlease fill this form: https://forms.cloud.microsoft/r/abc\n\nSomeone Else\nI applied to the Ubuntu Rising Scholars Program (URSP) last year.'
  it('cuts comments off a thread', () => {
    const t = stripThread(thread)
    expect(t).not.toContain('Ubuntu')
    expect(t).toContain('McMaster')
  })
  it('measures how much of a claim is in the source', () => {
    expect(coverage('McMaster University', post)).toBe(1)
    expect(coverage('Ubuntu Rising Scholars Program (URSP)', post)).toBeLessThan(0.3)
  })
  it('drops an invented title and funder, keeps the real university', () => {
    const r = { title: 'Ubuntu Rising Scholars Program (URSP)', university: 'McMaster University', funder: 'Microsoft', deadlines: [], requirements: [], custom: {}, confidence: { title: 0.9 }, evidence: {} } as ParseResult
    const { result, dropped } = ground(r, stripThread(thread).replace('forms.cloud.microsoft', 'forms.example'), false)
    expect(dropped).toEqual(expect.arrayContaining(['title', 'funder']))
    expect(result.title).toBeUndefined()
    expect(result.university).toBe('McMaster University')
  })
  it('does not trust a link that is not in the text, and falls back to the application link', () => {
    const r = { title: 'McMaster recruiting', officialUrl: 'https://made-up.edu/apply', applicationUrl: 'https://forms.cloud.microsoft/r/abc', deadlines: [], requirements: [], custom: {}, confidence: {}, evidence: {} } as unknown as ParseResult
    const { result } = ground(r, thread.replace('Most relevant\n\nDr. Ryan Ahmed\nAuthor\n', ''), false)
    expect(result.officialUrl).toBe('https://forms.cloud.microsoft/r/abc')
  })
})

import { saveParsed } from '../src/lib/ingest'
import { DEFAULT_FIELDS, getState } from '../src/lib/store'
describe('application form link', () => {
  it('becomes a checklist item', () => {
    const r = { title: 'McMaster recruiting PhD students', deadlines: [], requirements: [], custom: {}, confidence: {}, evidence: {}, applicationUrl: 'https://forms.cloud.microsoft/r/abc' } as unknown as ParseResult
    const out = saveParsed(r, { sourceUrl: '', rawText: '', fields: DEFAULT_FIELDS })
    const app = getState().apps.find((a) => a.id === out.id)!
    expect(app.requirements.map((q) => q.label)).toContain('Fill in the application form')
  })
})
