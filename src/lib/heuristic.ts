// Offline fallback parser. Used when the server has no AI key or the AI call fails.
// It is deliberately conservative: low confidence everywhere, and anything uncertain goes to review.
import type { ParseResult, ParsedDeadline, RequirementKind } from './types'
import { findDates } from './dates'
import { extractUrls, isLikelyOfficial, isSocial, isShortener } from './url'

const FUNDERS = ['Chevening', 'Commonwealth', 'Fulbright', 'DAAD', 'Mastercard Foundation', 'Rhodes', 'Gates Cambridge', 'Schwarzman', 'Aga Khan', 'Erasmus Mundus', 'MEXT', 'Mandela Rhodes', 'Chinese Government Scholarship', 'CSC', 'Turkiye Burslari', 'Stipendium Hungaricum', 'Swedish Institute', 'Eiffel', 'Vanier', 'Australia Awards', 'Joint Japan World Bank', 'Clarendon', 'Wellcome', 'Google', 'Microsoft', 'Shell', 'Total', 'MTN Foundation', 'TETFund', 'Agbami', 'NLNG', 'Seplat']
const COUNTRIES: [RegExp, string][] = [
  [/\b(UK|United Kingdom|Britain|England|Scotland|Wales)\b/, 'United Kingdom'], [/\b(USA|United States|U\.S\.A?\.?)\b/, 'United States'], [/\bCanada\b/, 'Canada'],
  [/\bGermany\b/, 'Germany'], [/\bAustralia\b/, 'Australia'], [/\bChina\b/, 'China'], [/\bJapan\b/, 'Japan'], [/\bFrance\b/, 'France'], [/\bNetherlands\b/, 'Netherlands'],
  [/\bSweden\b/, 'Sweden'], [/\bTurkey|Türkiye\b/, 'Türkiye'], [/\bHungary\b/, 'Hungary'], [/\bSouth Africa\b/, 'South Africa'], [/\bIreland\b/, 'Ireland'], [/\bNew Zealand\b/, 'New Zealand'],
]
const TZ_ABBR: Record<string, string> = { WAT: 'Africa/Lagos', GMT: 'UTC', UTC: 'UTC', BST: 'Europe/London', CET: 'Europe/Berlin', CEST: 'Europe/Berlin', EST: 'America/New_York', EDT: 'America/New_York', PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles' }
const NATIONALITIES = ['Nigerian', 'Ghanaian', 'Kenyan', 'South African', 'Ugandan', 'Tanzanian', 'Cameroonian', 'Ethiopian', 'African', 'developing countries', 'all nationalities', 'international students']

const clean = (s: string) => s.replace(/^[\s\p{Extended_Pictographic}\p{Regional_Indicator}‍️*>\-–—•●:]+/u, '').replace(/\s+/g, ' ').trim()

export function heuristicParse(text: string, url?: string, now: Date = new Date()): ParseResult {
  const body = (text || '').slice(0, 20000)
  const lines = body.split(/\n+/).map(clean).filter((l) => l.length > 3)
  const confidence: Record<string, number> = {}
  const evidence: Record<string, string> = {}

  // title
  const keyword = /(scholarship|fellowship|grant|award|bursary|programme|program|call for|admission)/i
  // 1) A named award ("Bet9ja Foundation Scholarship 2027") beats any headline-looking line ("SCHOLARSHIP SPOTLIGHT OF THE DAY").
  const GENERIC = /^(?:the|a|an|this|our|new|fully|funded|full|free|top|best|latest|scholarship|scholarships|category|apply|official)$/i
  const named = /((?:[A-Z0-9][\w'’&.\/-]*[ \t]+){1,9}?(?:Scholarships?|Fellowships?|Bursary|Bursaries|Studentships?|Grants?|Awards?|SCHOLARSHIPS?|FELLOWSHIPS?)(?:[ \t]+(?:Program(?:me)?|PROGRAM(?:ME)?|Scheme|SCHEME|Fund|FUND))?(?:[ \t]+\(?[A-Z]{2,8}\)?(?=[ \t]|$))?(?:[ \t]+20\d{2}(?:[\/-]\d{2,4})?)?)/g
  let title: string | undefined
  for (const l of lines.filter((x) => !x.startsWith('#') && !/^https?:/i.test(x))) {
    for (const m of l.matchAll(named)) {
      let words = m[1].trim().split(/\s+/)
      while (words.length > 1 && GENERIC.test(words[0])) words = words.slice(1)
      const lead = words.slice(0, -1).filter((w) => !/^(?:20\d{2}(?:[\/-]\d{2,4})?|PhD|MSc|Masters?|Graduate|Undergraduate|Postgraduate|Program(?:me)?)$/i.test(w))
      const nameWords = words.filter((w) => !/^(?:scholarships?|fellowships?|grants?|awards?|program(?:me)?|scheme|fund|20\d{2}.*)$/i.test(w))
      if (nameWords.length >= 1 && lead.length >= 1 && !/\b(?:alert|spotlight|opportunit|of the day)\b/i.test(m[1])) { title = words.join(' '); break }
    }
    if (title) break
  }
  // 2) Otherwise the first headline-like line that mentions an award, skipping banners and hashtags.
  const banner = /(spotlight|of the day|alert\b|just in\s*$|:$)/i
  const usable = lines.filter((l) => !l.startsWith('#') && !/^https?:/i.test(l))
  title = title ?? usable.find((l) => l.length >= 10 && l.length <= 140 && keyword.test(l) && !banner.test(l)) ?? usable.find((l) => l.length >= 10 && l.length <= 140 && !banner.test(l))
  if (!title) {
    // one long paragraph: use its first sentence, trimmed at a word boundary
    const first = (lines.find((l) => !/^https?:/i.test(l)) ?? '').replace(/https?:\/\/\S+/g, '').trim()
    const sentence = first.split(/(?<=[.!?])\s+/)[0] ?? first
    if (sentence.length > 3) {
      title = sentence.length <= 100 ? sentence : sentence.slice(0, 100).replace(/\s+\S*$/, '') + '...'
    }
  }
  if (title) {
    const firstSentence = title.split(/(?<=[.!?])\s+/)[0]
    if (firstSentence && firstSentence.length >= 10 && firstSentence.length < title.length) title = firstSentence
  }
  if (title) { confidence.title = 0.45; evidence.title = title }

  // funder
  const funder = FUNDERS.find((f) => new RegExp(`\\b${f}\\b`, 'i').test(body))
  if (funder) confidence.funder = 0.5

  // university
  const uniRe = /\b(University of [A-Z][A-Za-z']+(?: (?:of |and )?[A-Z][A-Za-z']+){0,3}|[A-Z][A-Za-z']+(?: [A-Z][A-Za-z']+){0,2} University(?: of [A-Z][A-Za-z']+)?|Imperial College London|King's College London|London School of Economics|ETH Zurich|[A-Z][A-Za-z]+ Institute of Technology)\b/
  const uni = uniRe.exec(body)?.[1]
  if (uni) { confidence.university = 0.5; evidence.university = uni }

  // deadlines
  const found = findDates(body, now)
  const deadlines: ParsedDeadline[] = []
  const used = new Set<string>()
  for (const f of found) {
    const before = body.slice(Math.max(0, f.index - 70), f.index).toLowerCase()
    const after = body.slice(f.index, f.index + 70)
    const dl = /(deadline|clos(?:e|es|ing)|apply by|due|until|no later than|last date|submit(?:ted)? by)/.test(before)
    const opens = /(open(?:s|ed|ing)?|start(?:s|ing)?|begin(?:s)?)\b[^.\n]{0,25}$/.test(before)
    if (used.has(f.date)) continue
    let kind: ParsedDeadline['kind'] | undefined
    if (dl) kind = /admission/.test(before) ? 'admission' : 'scholarship'
    else if (opens) kind = 'opens'
    if (!kind) continue
    const near = after.slice(f.raw.length, f.raw.length + 40)
    const t = /(\d{1,2})[:.](\d{2})\s*(am|pm)?\s*([A-Z]{3,4})?/i.exec(near) ?? (() => { const x = /\b(\d{1,2})\s*(am|pm)\b\s*([A-Z]{3,4})?/i.exec(near); return x ? [x[0], x[1], '00', x[2], x[3]] as unknown as RegExpExecArray : /\bmidnight\b/i.test(near) ? ['', '23', '59', undefined, /\b(WAT|GMT|UTC|BST|CET|CEST|EST|EDT|PST|PDT)\b/.exec(near)?.[1]] as unknown as RegExpExecArray : undefined })()
    let time: string | undefined, tz: string | undefined
    if (t) {
      let h = +t[1]
      if (t[3]?.toLowerCase() === 'pm' && h < 12) h += 12
      if (t[3]?.toLowerCase() === 'am' && h === 12) h = 0
      if (h < 24) { time = `${String(h).padStart(2, '0')}:${t[2]}`; tz = t[4] ? TZ_ABBR[t[4].toUpperCase()] : undefined }
    }
    deadlines.push({ kind, date: f.date, time, tz })
    used.add(f.date)
    if (kind === 'scholarship' && !evidence.deadline) { evidence.deadline = body.slice(Math.max(0, f.index - 40), f.index + f.raw.length + 10).replace(/\s+/g, ' ').trim(); confidence.deadline = 0.55 }
  }
  if (!deadlines.length && found.length === 1) {
    deadlines.push({ kind: 'scholarship', date: found[0].date })
    confidence.deadline = 0.35
    evidence.deadline = body.slice(Math.max(0, found[0].index - 40), found[0].index + found[0].raw.length + 10).replace(/\s+/g, ' ').trim()
  }

  // degree level
  const levels: string[] = []
  if (/\b(master'?s?|msc|m\.sc|mba|postgraduate|pg\b)/i.test(body)) levels.push('masters')
  if (/\b(ph\.?d|doctora(?:l|te))\b/i.test(body)) levels.push('phd')
  // "a Bachelor's degree is required" describes the applicant, not the level being funded
  if (/\bundergraduate\b/i.test(body) || /\bbachelor'?s?\s+(?:scholarships?|program(?:me)?s?|students?|stud(?:y|ies))\b/i.test(body)) levels.push('undergraduate')

  // funding
  const covers: string[] = []
  if (/tuition/i.test(body)) covers.push('Tuition')
  if (/stipend|living allowance|monthly allowance/i.test(body)) covers.push('Stipend')
  if (/flight|airfare|air ticket|travel (?:cost|grant|allowance)/i.test(body)) covers.push('Flights')
  if (/visa/i.test(body)) covers.push('Visa costs')
  if (/health insurance|medical (?:cover|insurance)/i.test(body)) covers.push('Health insurance')
  if (/accommodation|housing/i.test(body)) covers.push('Accommodation')
  const full = /fully[- ]funded|full (?:scholarship|funding|tuition)/i.test(body)
  const money = /(USD|US\$|\$|£|GBP|€|EUR|NGN|₦)\s?([\d,]{3,}(?:\.\d+)?)/i.exec(body)
  const currencyOf = (s: string) => (/\$|usd/i.test(s) ? 'USD' : /£|gbp/i.test(s) ? 'GBP' : /€|eur/i.test(s) ? 'EUR' : 'NGN')

  // criteria
  const nationalities = NATIONALITIES.filter((n) => new RegExp(n, 'i').test(body))
  const gpa = /(?:minimum|min\.?|at least)\s+(?:cgpa|gpa|grade)[^\d]{0,15}(\d(?:\.\d+)?)/i.exec(body)
  const other: string[] = []
  if (/second class upper|2[:.]1|upper credit/i.test(body)) other.push('Second Class Upper (2:1) or better')
  if (/work experience|years? of (?:work )?experience/i.test(body)) other.push('Work experience required')
  const age = /(?:under|below|not (?:more|older) than|maximum age(?: of)?|age limit(?: of| is)?)\s*(\d{2})\s*(?:years|yrs)\b/i.exec(body) ?? /\b(?:age limit|maximum age)[^\d\n]{0,12}(\d{2})\b/i.exec(body)

  // requirements
  const reqs = new Map<string, RequirementKind>()
  const rule: [RegExp, string, RequirementKind][] = [
    [/transcript/i, 'Academic transcripts', 'document'], [/\b(cv|resume|curriculum vitae)\b/i, 'CV', 'document'],
    [/recommendation|reference letter|referee|references/i, 'Recommendation letters', 'referee'], [/ielts|toefl|pte|duolingo|english (?:language )?proficiency/i, 'English language test', 'test'],
    [/personal statement|statement of purpose|motivation letter|essay/i, 'Personal statement', 'essay'], [/research proposal/i, 'Research proposal', 'essay'],
    [/passport/i, 'Passport copy', 'document'], [/admission (?:letter|offer)|offer letter|letter of admission/i, 'Admission offer', 'document'],
    [/degree certificate|certificate of/i, 'Degree certificate', 'document'], [/(?<!\bno )(?<!\bwithout (?:an? )?)(?<!\bfree of )(?:application|processing) fee(?! is (?:not )?(?:required|charged|free))(?![^.\n]{0,20}\b(?:waived|not required|free)\b)/i, 'Application fee', 'fee'],
  ]
  for (const [re, label, kind] of rule) if (re.test(body)) reqs.set(label, kind)

  // official url
  const urls = extractUrls(body).concat(url ? [url] : [])
  const official = urls.find((u) => isLikelyOfficial(u) && !isSocial(u) && !isShortener(u))
  const country = COUNTRIES.find(([re]) => re.test(body))?.[1]

  return {
    title,
    university: uni,
    funder,
    degreeLevel: levels[0],
    country,
    deadlines,
    funding: { type: full ? 'full' : covers.length ? 'partial' : 'unknown', covers, amount: money ? Number(money[2].replace(/,/g, '')) : undefined, currency: money ? currencyOf(money[1]) : undefined },
    criteria: { nationalities, degreeLevels: levels, fields: [], minGpa: gpa ? Number(gpa[1]) : undefined, maxAge: age ? Number(age[1]) : undefined, other },
    requirements: Array.from(reqs, ([label, kind]) => ({ label, kind })),
    officialUrl: official,
    custom: {},
    confidence,
    evidence,
    mode: 'heuristic',
    sourceText: body,
  }
}
