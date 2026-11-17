import type { Application, Profile } from './types'
import { AFRICA as AFRICA_COUNTRIES, NATIONALITY } from './countries'

export type Verdict = 'eligible' | 'check' | 'not_eligible'
export interface EligibilityLine { ok: boolean | null; text: string }
export interface EligibilityResult { verdict: Verdict; lines: EligibilityLine[] }

const low = (s: string) => s.toLowerCase().trim()
const ANY = /(all nationalit|any nationalit|international|worldwide|all countries|open to all|any country)/i
const AFRICA = /\bafrican?\b/i
const DEVELOPING = /(developing|low[- ]and[- ]middle|lmic)/i
const isAfrican = (nat: string) => Object.entries(NATIONALITY).some(([country, n]) => low(n) === nat && AFRICA_COUNTRIES.includes(country))

export function evaluate(app: Application, p: Profile): EligibilityResult {
  const c = app.criteria
  const lines: EligibilityLine[] = []
  let hardFail = false
  let unknown = false

  if (c.nationalities.length) {
    const mine = low(p.nationality)
    if (!mine) { lines.push({ ok: null, text: `Listed for ${c.nationalities.join(', ')}. Add your country in Settings to check` }); unknown = true }
    else {
      const hit = c.nationalities.some((n) => {
        const x = low(n)
        if (x.length < 3) return false
        if (ANY.test(x) || x.includes(mine) || mine.includes(x)) return true
        if (/south africa/.test(x)) return false // a country, not the continent
        return (AFRICA.test(x) || DEVELOPING.test(x)) && isAfrican(mine)
      })
      if (hit) lines.push({ ok: true, text: `Open to ${p.nationality} applicants` })
      else { lines.push({ ok: false, text: `Listed for ${c.nationalities.join(', ')}. Your nationality is ${p.nationality}` }); hardFail = true }
    }
  } else { lines.push({ ok: null, text: 'No nationality rule found. Check the official page' }); unknown = true }

  if (c.degreeLevels.length) {
    const want = low(p.degreeLevel)
    const lv = c.degreeLevels.map(low)
    const alias: Record<string, string[]> = { masters: ['masters', "master's", 'msc', 'postgraduate'], phd: ['phd', 'doctoral', 'doctorate', 'postgraduate'], undergraduate: ['undergraduate', 'bachelors', "bachelor's"], postdoc: ['postdoc', 'postdoctoral'] }
    if (!want || want === 'any') lines.push({ ok: null, text: `For ${c.degreeLevels.join(' / ')} study` })
    else if (lv.some((l) => (alias[want] ?? [want]).some((a) => l.includes(a)))) lines.push({ ok: true, text: `Covers ${p.degreeLevel} study` })
    else { lines.push({ ok: false, text: `For ${c.degreeLevels.join(' / ')}. You are targeting ${p.degreeLevel}` }); hardFail = true }
  } else { lines.push({ ok: null, text: 'No degree level found' }); unknown = true }

  if (c.fields.length) {
    const mine = p.fields.map(low)
    const hit = c.fields.some((f) => mine.some((m) => low(f).includes(m) || m.includes(low(f))))
    if (!mine.length) { lines.push({ ok: null, text: `Fields: ${c.fields.join(', ')}. Add your field in Settings to check` }); unknown = true }
    else if (hit) lines.push({ ok: true, text: 'Matches your field of study' })
    else { lines.push({ ok: null, text: `Fields: ${c.fields.join(', ')}. This may not match your field` }); unknown = true }
  }

  if (c.minGpa !== undefined) {
    if (p.gpa === undefined) { lines.push({ ok: null, text: `Needs a minimum GPA of ${c.minGpa}. Add your GPA in Settings to check` }); unknown = true }
    else if (p.gpa >= c.minGpa) lines.push({ ok: true, text: `Your GPA ${p.gpa} meets the ${c.minGpa} minimum` })
    // Grades use different scales (4.0, 5.0, percentages), so a lower number is a prompt to check, never an automatic no.
    else { lines.push({ ok: null, text: `Asks for a minimum of ${c.minGpa}. Yours is ${p.gpa}. Check both are on the same scale` }); unknown = true }
  }
  if (c.maxAge !== undefined) { lines.push({ ok: null, text: `Age limit of ${c.maxAge}. Confirm you are within it` }); unknown = true }
  for (const o of c.other) { lines.push({ ok: null, text: o }); unknown = true }

  const verdict: Verdict = hardFail ? 'not_eligible' : unknown ? 'check' : 'eligible'
  return { verdict, lines }
}

export const verdictLabel: Record<Verdict, string> = { eligible: 'Eligible', check: 'Check', not_eligible: 'Not eligible' }
