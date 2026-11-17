// The parsing pipeline, shared by the Netlify function (production) and the Vite dev middleware.
import { heuristicParse } from '../src/lib/heuristic'
import type { ParseResult } from '../src/lib/types'
import { breaker, gate, hash, limiter, memoryStore, singleFlight, type Store } from './infra'
import { canonicalUrl } from '../src/lib/url'
// It fetches the page (SSRF-guarded), follows through to the official page when it finds one, and asks Gemini
// for structured JSON. Without GEMINI_API_KEY it returns the fetched text so the client can run its offline parser.

const MAX_PAGE_BYTES = 1_500_000
const MAX_TEXT = 14_000
const MAX_BODY_BYTES = 8_000_000
const SOCIAL = /(^|\.)(x\.com|twitter\.com|t\.co|linkedin\.com|lnkd\.in|facebook\.com|fb\.com|instagram\.com|whatsapp\.com|wa\.me|t\.me)$/i
const SHORT = /^(t\.co|lnkd\.in|bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|buff\.ly|fb\.me|is\.gd|cutt\.ly|shorturl\.at|rebrand\.ly)$/i

interface FieldSpec { key: string; label: string; type: string; options?: string[] }
interface ParseRequest {
  url?: string
  text?: string
  image?: { mime: string; data: string }
  images?: { mime: string; data: string }[]
  fields?: FieldSpec[]
  today?: string
  tz?: string
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
  }
  if (h.includes(':')) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:')
  return false
}

export function htmlToText(html: string): { text: string; title: string; description: string } {
  const pick = (re: RegExp) => re.exec(html)?.[1]?.trim() ?? ''
  const title = decode(pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i) || pick(/<title[^>]*>([^<]*)<\/title>/i))
  const description = decode(pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) || pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i))
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/table)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
  return { text, title, description }
}
function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
}

/** A public-looking name can still point at a private address. Look it up and refuse if it does. */
async function resolvesPrivate(host: string): Promise<boolean> {
  if (/^[\d.]+$/.test(host) || host.includes(':')) return false // literal addresses were already checked
  try {
    const { lookup } = await import('node:dns/promises')
    const all = await Promise.race([lookup(host, { all: true }), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('dns timeout')), 1500))])
    return all.some((a) => isPrivateHost(a.address))
  } catch { return false } // cannot resolve: the fetch itself will fail
}

interface Page { ok: boolean; status: number; finalUrl: string; text: string; blocked?: string }

async function fetchPage(rawUrl: string, timeoutMs = 7000): Promise<Page> {
  const until = Date.now() + timeoutMs
  let url = rawUrl
  for (let hop = 0; hop < 5; hop++) {
    let u: URL
    try { u = new URL(url) } catch { return { ok: false, status: 0, finalUrl: url, text: '', blocked: 'That does not look like a valid link.' } }
    if (!/^https?:$/.test(u.protocol) || isPrivateHost(u.hostname) || (await resolvesPrivate(u.hostname))) return { ok: false, status: 0, finalUrl: url, text: '', blocked: 'That address cannot be fetched.' }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), Math.max(500, until - Date.now()))
    let res: Response
    try {
      res = await fetch(u, {
        redirect: 'manual', signal: ctrl.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'accept-language': 'en' },
      })
    } catch {
      clearTimeout(timer)
      return { ok: false, status: 0, finalUrl: url, text: '', blocked: 'The page did not respond in time.' }
    }
    clearTimeout(timer)
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, u).toString()
      continue
    }
    const type = res.headers.get('content-type') ?? ''
    if (!res.ok) return { ok: false, status: res.status, finalUrl: url, text: '', blocked: res.status === 401 || res.status === 403 || res.status === 999 ? 'The site blocks automatic readers (login wall).' : `The page returned status ${res.status}.` }
    if (!/text\/|html|xml|json/i.test(type)) return { ok: false, status: res.status, finalUrl: url, text: '', blocked: 'That link is not a web page (maybe a file or image).' }
    const reader = res.body?.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done || !value) break
        total += value.length
        chunks.push(value)
        if (total > MAX_PAGE_BYTES) { await reader.cancel(); break }
      }
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks))
    const { text, title, description } = htmlToText(html)
    const combined = [title, description, text].filter(Boolean).join('\n')
    const social = SOCIAL.test(new URL(url).hostname)
    const wall = /(log in|sign in|join now|sign up)\b[^\n]{0,60}(continue|view|see)/i.test(text) || /enable javascript|javascript is (?:disabled|not available)/i.test(text)
    if (social && (combined.length < 250 || (wall && combined.length < 1500))) return { ok: false, status: res.status, finalUrl: url, text: combined, blocked: 'This social post is not readable without signing in. Share the post text or a screenshot instead.' }
    return { ok: true, status: res.status, finalUrl: url, text: combined.slice(0, MAX_TEXT) }
  }
  return { ok: false, status: 0, finalUrl: url, text: '', blocked: 'Too many redirects.' }
}

const PRIVATE_REASON = /valid link|cannot be fetched/

/** Fallback for sites that refuse our server: a public reader service renders the page for us. Only the link is sent. */
function hostSafe(u: string): string { try { return new URL(u).hostname } catch { return '' } }

async function viaReader(url: string, timeoutMs = 9000): Promise<Page | null> {
  try {
    const res = await fetch('https://r.jina.ai/' + url, { headers: { accept: 'text/plain', 'x-return-format': 'text' }, signal: AbortSignal.timeout(Math.max(500, timeoutMs)) })
    if (!res.ok) return null
    const raw = (await res.text()).trim()
    const text = raw.replace(/^Title:[^\n]*\n(?:URL Source:[^\n]*\n)?(?:Published Time:[^\n]*\n)?(?:Markdown Content:\n)?/i, '').trim()
    if (text.length < 200) return null
    if (SOCIAL.test(new URL(url).hostname) && /(log in|sign in|join now)\b[^\n]{0,60}(continue|view|see)/i.test(text) && text.length < 1500) return null
    return { ok: true, status: 200, finalUrl: url, text: text.slice(0, MAX_TEXT) }
  } catch { return null }
}

async function readPage(url: string, left: () => number): Promise<Page> {
  const direct = await fetchPage(url, Math.min(7000, left() * 0.45))
  if (direct.ok || (direct.blocked && PRIVATE_REASON.test(direct.blocked))) return direct
  if (process.env.READER_FALLBACK === 'off' || left() < 4500) return direct
  return (await viaReader(direct.finalUrl || url, Math.min(9000, left() - 3500))) ?? direct
}

const SYSTEM = `You extract scholarship details for a tracking app used mainly by Nigerian and other African students.
Rules:
- Use ONLY the content provided. Never guess or invent.
- Return EVERY field of the schema. When something is not stated use an empty string or an empty list; do not skip the field.
- Read the whole text before answering: deadlines are often near the end ("Deadline: ...", "Closes ...", "Apply by ..."). Always return each one you find, plus any "opens" date.
- university is the name of one specific institution ("University of Oxford"). If the award is open to students of many institutions, or none is named, leave it empty. Never put a description there.
- funder is the organisation paying for the award (a foundation, company, government or research council), if named.
- A post may begin with the sharer's own introduction or slogan. Ignore it; extract the scholarship it announces.
- Dates must be ISO YYYY-MM-DD. If the year is missing, use the nearest future occurrence relative to TODAY.
- For every deadline give a short verbatim "evidence" quote (max 160 chars) and a confidence from 0 to 1. Use below 0.7 when the wording is ambiguous.
- Distinguish deadline kinds: scholarship, admission, referee, offer (offer acceptance), opens (applications open), other.
- If a time and time zone are stated, return time as HH:mm (24h) and an IANA time zone (WAT = Africa/Lagos, GMT = UTC, BST = Europe/London, CET = Europe/Berlin).
- If the content lists several scholarships, extract the one the post is mainly about and say so in notes.
- The content may include comments, replies, reactions, "people also viewed" and other unrelated posts. Use ONLY the main post written by the original author. Anything from a comment or reply must be ignored, even if it names a programme.
- Never output a title, funder, university or link that does not appear in the main post. If the post names no funder, leave funder empty (an online form host such as Microsoft Forms or Google Forms is NOT a funder).
- degreeLevels lists only the levels the post explicitly names ("Master's and PhD" gives masters and phd). Never add a level that is not stated.
- applicationUrl is the link where an applicant applies or fills in a form, if the post or its author's own follow-up gives one.
- officialUrl must be an absolute URL that appears in the content and belongs to the funder or a university (not social media, not a link shortener, not a news or blog site).
- requirements are the documents or steps an applicant must complete (transcripts, CV, referees, language test, essays, fee, etc.).
- degreeLevel is one of: masters, phd, undergraduate, postdoc, other.
- fundingType is one of: full, partial, unknown.
- Fill the user's custom fields in "custom" only when the content clearly states them.`

const STR = { type: 'STRING' } as const
const NUM = { type: 'NUMBER' } as const
const arr = (items: unknown) => ({ type: 'ARRAY', items })
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: STR, university: STR, funder: STR, programme: STR, degreeLevel: STR, country: STR,
    deadlines: arr({ type: 'OBJECT', properties: { kind: STR, date: STR, time: STR, timezone: STR, evidence: STR, confidence: NUM }, required: ['kind', 'date'] }),
    fundingType: STR, fundingSummary: STR, covers: arr(STR), amount: NUM, currency: STR,
    nationalities: arr(STR), degreeLevels: arr(STR), fields: arr(STR), minGpa: NUM, maxAge: NUM, otherCriteria: arr(STR),
    requirements: arr({ type: 'OBJECT', properties: { label: STR, kind: STR }, required: ['label'] }),
    officialUrl: STR, applicationUrl: STR,
    custom: arr({ type: 'OBJECT', properties: { key: STR, value: STR }, required: ['key', 'value'] }),
    fieldConfidence: arr({ type: 'OBJECT', properties: { field: STR, confidence: NUM, evidence: STR } }),
    notes: STR,
  },
  // Without this the lighter model returns a title and little else. Empty string / empty list means "not stated".
  required: ['title', 'university', 'funder', 'country', 'degreeLevels', 'deadlines', 'fundingType', 'fundingSummary', 'covers', 'nationalities', 'fields', 'otherCriteria', 'requirements', 'officialUrl', 'applicationUrl', 'notes'],
  propertyOrdering: ['title', 'funder', 'university', 'programme', 'degreeLevel', 'degreeLevels', 'country', 'deadlines', 'fundingType', 'fundingSummary', 'covers', 'amount', 'currency', 'nationalities', 'fields', 'minGpa', 'maxAge', 'otherCriteria', 'requirements', 'officialUrl', 'applicationUrl', 'custom', 'fieldConfidence', 'notes'],
}

const KINDS = new Set(['scholarship', 'admission', 'referee', 'offer', 'opens', 'other'])
const REQ_KINDS = new Set(['document', 'essay', 'referee', 'test', 'fee', 'other'])
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const sa = (v: unknown) => (Array.isArray(v) ? v.map(s).filter((x): x is string => !!x) : [])
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)

export function fromModel(j: any, fields: FieldSpec[]) {
  const confidence: Record<string, number> = {}
  const evidence: Record<string, string> = {}
  const deadlines = (Array.isArray(j?.deadlines) ? j.deadlines : [])
    .filter((d: any) => typeof d?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date))
    .map((d: any) => ({ kind: KINDS.has(d.kind) ? d.kind : 'other', date: d.date, time: /^\d{2}:\d{2}$/.test(d.time ?? '') ? d.time : undefined, tz: s(d.timezone), label: undefined }))
  const mainIdx = (Array.isArray(j?.deadlines) ? j.deadlines : []).findIndex((d: any) => d?.kind === 'scholarship' || d?.kind === 'admission')
  const main = (Array.isArray(j?.deadlines) ? j.deadlines : [])[mainIdx >= 0 ? mainIdx : 0]
  if (main) { confidence.deadline = n(main.confidence) ?? 0.7; if (s(main.evidence)) evidence.deadline = s(main.evidence)! }
  for (const fc of Array.isArray(j?.fieldConfidence) ? j.fieldConfidence : []) {
    const f = s(fc?.field)
    if (f) { if (n(fc.confidence) !== undefined) confidence[f] = fc.confidence; if (s(fc.evidence)) evidence[f] = s(fc.evidence)! }
  }
  const allowed = new Set(fields.map((f) => f.key))
  const custom: Record<string, string> = {}
  for (const c of Array.isArray(j?.custom) ? j.custom : []) if (allowed.has(c?.key) && s(c?.value)) custom[c.key] = s(c.value)!
  // A "name" that runs on for a paragraph, or a university that is really a description, is the model rambling. Drop it.
  const name = (v: unknown, max: number) => { const x = s(v)?.replace(/\s+/g, ' '); return x && x.length <= max && x.split(' ').length <= 14 ? x : undefined }
  const INSTITUTION = /\b(universit|college|institut|polytechnic|school|academy|academ|hochschule|universidad|université|ecole|école|eth\b|mit\b|kaist|\bkit\b|conservator)/i
  const uni = name(j?.university, 110)
  return {
    title: s(j?.title)?.replace(/\s+/g, ' ').slice(0, 200), university: uni && INSTITUTION.test(uni) && /^[A-Z\u00C0-\u024F]/.test(uni) ? uni : undefined, funder: name(j?.funder, 110), programme: name(j?.programme, 160), degreeLevel: s(j?.degreeLevel)?.toLowerCase(), country: s(j?.country),
    deadlines,
    funding: { type: ['full', 'partial', 'unknown'].includes(j?.fundingType) ? j.fundingType : 'unknown', summary: s(j?.fundingSummary), covers: sa(j?.covers), amount: n(j?.amount), currency: s(j?.currency)?.toUpperCase() },
    criteria: { nationalities: sa(j?.nationalities), degreeLevels: sa(j?.degreeLevels).map((x) => x.toLowerCase()), fields: sa(j?.fields), minGpa: n(j?.minGpa), maxAge: n(j?.maxAge), other: sa(j?.otherCriteria) },
    requirements: (Array.isArray(j?.requirements) ? j.requirements : []).filter((r: any) => s(r?.label) && !/^(check|see|visit|refer to|read|click|go to)\b/i.test(s(r.label)!)).map((r: any) => ({ label: s(r.label)!.slice(0, 160), kind: REQ_KINDS.has(r.kind) ? r.kind : 'other' })),
    officialUrl: s(j?.officialUrl), applicationUrl: s(j?.applicationUrl),
    custom, confidence, evidence, notes: s(j?.notes),
  }
}

/** Cut comments, replies and sidebars off a social page so another person's words never reach the model. */
export function stripThread(text: string): string {
  const m = /\n\s*(Most relevant|Add a comment|Write a comment|See previous replies|Load more comments|Top comments|All comments)\b/i.exec(text)
  return m && m.index > 200 ? text.slice(0, m.index).trim() : text
}

const norm = (t: string) => t.toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
const STOP = new Set(['the', 'and', 'for', 'with', 'program', 'programme', 'scholarship', 'scholarships', 'scholars', 'university', 'fund', 'funded', 'fully', 'award', 'grant'])
/** Share of the meaningful words in `value` that really occur in `source`. */
export function coverage(value: string, source: string): number {
  const toks = norm(value).split(' ').filter((t) => t.length > 2 && !STOP.has(t))
  if (!toks.length) return 1
  const hay = ' ' + norm(source) + ' '
  return toks.filter((t) => hay.includes(t)).length / toks.length
}
const urlIn = (u: string | undefined, source: string) => !!u && source.replace(/[)\].,;]+(?=\s|$)/g, '').includes(u.replace(/[)\].,;/]+$/, ''))

/** Drop anything the model claims that the source text does not support. Screenshots cannot be checked, so they are left as read. */
export function ground(r: ParseResult, source: string, hasImage: boolean): { result: ParseResult; dropped: string[] } {
  const dropped: string[] = []
  if (hasImage) return { result: r, dropped }
  const out: ParseResult = { ...r, confidence: { ...r.confidence }, evidence: { ...r.evidence } }
  for (const f of ['title', 'university', 'funder', 'programme'] as const) {
    const v = out[f]
    if (v && coverage(v, source) < 0.6) { dropped.push(f); delete out[f]; delete out.confidence[f]; delete out.evidence[f] }
  }
  const dlEvidence = out.evidence.deadline
  if (out.deadlines.length && dlEvidence && coverage(dlEvidence, source) < 0.7) { dropped.push('deadline'); out.deadlines = []; delete out.confidence.deadline; delete out.evidence.deadline }
  // A short link or a social post is where to click, not the funder's own page.
  const notOfficial = (u?: string) => !!u && (SOCIAL.test(hostSafe(u)) || SHORT.test(hostSafe(u)))
  if (notOfficial(out.officialUrl)) { out.applicationUrl = out.applicationUrl || out.officialUrl; out.officialUrl = undefined }
  const off = urlIn(out.officialUrl, source) ? out.officialUrl : undefined
  const apply = urlIn(out.applicationUrl, source) ? out.applicationUrl as string : undefined
  if (out.officialUrl && !off) dropped.push('officialUrl')
  out.applicationUrl = apply
  out.officialUrl = off ?? (apply && !notOfficial(apply) ? apply : undefined)
  return { result: out, dropped }
}

const THINKING: object[] = [{ thinkingConfig: { thinkingLevel: 'low' } }, { thinkingConfig: { thinkingLevel: 'minimal' } }, { thinkingConfig: { thinkingBudget: 0 } }, {}]
const thinkingChoice = new Map<string, number>()
const lastShape = new Map<string, string>()

async function callModel(parts: unknown[], fields: FieldSpec[], today: string, key: string, model: string, timeoutMs: number) {
  const customList = fields.length ? `\nUser's custom fields (use these exact keys in "custom"): ${fields.map((f) => `${f.key} (${f.label}, ${f.type}${f.options?.length ? ', options: ' + f.options.join('/') : ''})`).join('; ')}` : ''
  // Extraction needs no deliberation, and "thinking" is what makes a read take 20 seconds instead of 3.
  // Models disagree on how to ask for less of it, so try each spelling once and remember which one this model accepts.
  const call = (variant: object) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${SYSTEM}\nTODAY is ${today}.${customList}` }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json', responseSchema: SCHEMA, ...variant },
    }),
    signal: AbortSignal.timeout(Math.floor(Math.max(1000, timeoutMs - (Date.now() - began)))),
  })
  const began = Date.now()
  let idx = thinkingChoice.get(model) ?? 0
  let res = await call(THINKING[idx])
  while (res.status === 400 && idx < THINKING.length - 1) { idx++; res = await call(THINKING[idx]) }
  if (res.ok) thinkingChoice.set(model, idx)
  // "High demand" is usually over in a moment: up to two quick retries before giving up on this model.
  for (const wait of [500, 1200]) {
    if (res.status !== 503 || timeoutMs - (Date.now() - began) < wait + 2500) break
    await new Promise((r) => setTimeout(r, wait + Math.random() * 300))
    res = await call(THINKING[idx])
  }
  if (!res.ok) throw Object.assign(new Error(`Gemini returned ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status })
  const data: any = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? ''
  lastShape.set(model, `${data?.candidates?.[0]?.finishReason ?? '?'}/${text.length}c`)
  if (!text) throw new Error('Gemini returned no content')
  try { return JSON.parse(text) } catch { throw new Error('Gemini returned an incomplete answer') }
}

/**
 * Two readers are better than one. The rule-based reader goes over the same text, fills anything the AI left blank,
 * and where the two disagree about the deadline the entry is marked unsure so a person looks at it.
 */
export function backfill(ai: ParseResult, h: ParseResult): ParseResult {
  const out: ParseResult = { ...ai, confidence: { ...ai.confidence }, evidence: { ...ai.evidence }, deadlines: [...ai.deadlines] }
  const main = (r: ParseResult) => r.deadlines.find((d) => d.kind === 'scholarship') ?? r.deadlines.find((d) => d.kind !== 'opens')
  const a = main(out), b = main(h)
  if (!a && b && (h.confidence.deadline ?? 0) >= 0.5) {
    out.deadlines.push(...h.deadlines.filter((d) => d.kind !== 'opens'))
    out.confidence.deadline = 0.6
    if (h.evidence.deadline) out.evidence.deadline = h.evidence.deadline
  } else if (a && b && a.date !== b.date && (h.confidence.deadline ?? 0) >= 0.5 && !ai.deadlines.some((d) => d.date === b.date)) {
    out.confidence.deadline = Math.min(out.confidence.deadline ?? 1, 0.6)
    out.notes = [out.notes, `Check the deadline: the text also mentions ${b.date}.`].filter(Boolean).join(' ')
  }
  if (!out.deadlines.some((d) => d.kind === 'opens')) out.deadlines.push(...h.deadlines.filter((d) => d.kind === 'opens' && !out.deadlines.some((x) => x.date === d.date)))
  out.title = out.title || h.title
  out.university = out.university || h.university
  out.country = out.country || h.country
  out.degreeLevel = out.degreeLevel || h.degreeLevel
  out.officialUrl = out.officialUrl || h.officialUrl
  const c = out.criteria ?? {}, hc = h.criteria ?? {}
  out.criteria = { ...c, nationalities: c.nationalities ?? [], degreeLevels: c.degreeLevels?.length ? c.degreeLevels : hc.degreeLevels ?? [], fields: c.fields ?? [], other: c.other ?? [], minGpa: c.minGpa ?? hc.minGpa, maxAge: c.maxAge ?? hc.maxAge }
  const f = out.funding ?? {}, hf = h.funding ?? {}
  // Funding type and nationality wording are left to the AI: posts often open with the sharer's own slogan ("fully funded opportunities for Africans"), which the rule-based reader cannot tell apart from the award itself.
  out.funding = { ...f, type: f.type ?? 'unknown', covers: f.covers ?? [], amount: f.amount ?? hf.amount, currency: f.currency ?? hf.currency }
  if (!out.requirements.length) out.requirements = h.requirements
  return out
}

const aiGate = gate(Number(process.env.AI_CONCURRENCY) || 4)
const aiBreaker = breaker()
export const _aiBreaker = aiBreaker

const modelCooldown = new Map<string, number>()
/** Ask the main model; if it is out of quota or overloaded, try the lighter fallback model; if both are, pause AI calls briefly. */
async function callGemini(parts: unknown[], fields: FieldSpec[], today: string, key: string, model: string, left: () => number, diag?: object[]) {
  if (aiBreaker.open()) throw Object.assign(new Error('AI paused: quota'), { status: 429 })
  // Main model, then quick pinned models (each has its own capacity and free quota), then the slower fallback.
  // A model that just ran out of quota is skipped for a minute instead of being asked again.
  const extra = (process.env.GEMINI_EXTRA_MODELS ?? 'gemini-2.5-flash-lite,gemini-2.0-flash-lite').split(',').map((x) => x.trim())
  const models = [model, ...extra, process.env.GEMINI_FALLBACK_MODEL || (model.includes('lite') ? 'gemini-flash-latest' : 'gemini-flash-lite-latest')]
    .filter((m, i, all) => m && all.indexOf(m) === i && (modelCooldown.get(m) ?? 0) < Date.now())
  let lastErr: unknown
  let allQuota = models.length > 0
  for (const [i, m] of models.entries()) {
    if (left() < 2500) break
    // The first model may not use the whole budget: leave the fallback enough time to answer.
    const share = i < models.length - 1 ? Math.min(left() * 0.55, m.includes('lite') ? 6_000 : 12_000) : left() - 400
    const t0 = Date.now()
    try {
      const out = await aiGate(() => callModel(parts, fields, today, key, m, share), Math.max(200, left() - 2500))
      diag?.push({ model: m, ms: Date.now() - t0, status: 200, thinking: thinkingChoice.get(m), shape: lastShape.get(m), deadlines: Array.isArray(out?.deadlines) ? out.deadlines.length : -1 })
      return Object.assign(out ?? {}, { __model: m })
    } catch (e) {
      lastErr = e
      const status = (e as { status?: number }).status
      const timedOut = (e as Error)?.name === 'TimeoutError' || /timeout|aborted/i.test(String((e as Error)?.message))
      diag?.push({ model: m, ms: Date.now() - t0, status: status ?? (timedOut ? 'timeout' : String((e as Error)?.message).slice(0, 60)) })
      if (status === 429) modelCooldown.set(m, Date.now() + 60_000)
      else if (status !== 404) allQuota = false
      if (status === 404) modelCooldown.set(m, Date.now() + 3_600_000) // not offered to this key
      if (status !== 429 && status !== 503 && status !== 500 && status !== 404 && !timedOut) break // a different model will not fix a bad request
    }
  }
  // Pause all AI calls only when every model is out of quota; one busy model is not a reason to stop asking the others.
  if (allQuota && (lastErr as { status?: number })?.status === 429) aiBreaker.trip(45_000)
  throw lastErr ?? new Error('No time left for the AI reader')
}

async function parseOnce(req: Request, budgetMs: number): Promise<Response> {
  const startedAt = Date.now()
  const left = () => budgetMs - (Date.now() - startedAt)
  const diag: object[] = [] // which models were tried and how long each took; no secrets
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  // Only real web origins count, so a stray comment or typo in the setting cannot lock everyone out.
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((x) => x.trim().replace(/\/$/, '')).filter((x) => /^https?:\/\/[^\s/]+$/.test(x))
  const origin = req.headers.get('origin')
  if (allowed.length && origin && !allowed.includes(origin)) return json(403, { error: 'Origin not allowed' })

  let body: ParseRequest
  try { body = (await req.json()) as ParseRequest } catch { return json(400, { error: 'Invalid JSON' }) }
  const fields = (body.fields ?? []).slice(0, 30)
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today ?? '') ? body.today! : new Date().toISOString().slice(0, 10)
  const key = process.env.GEMINI_API_KEY
  const model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest'

  let pageText = ''
  let fetchedUrl: string | undefined
  let blockedReason: string | undefined
  const preShared = (body.text ?? '').length > 300
  if (body.url && !(preShared && (SOCIAL.test(hostSafe(body.url)) || SHORT.test(hostSafe(body.url))))) {
    const page = await readPage(body.url, left)
    fetchedUrl = page.finalUrl
    pageText = stripThread(page.text)
    if (!page.ok) blockedReason = page.blocked
  }
  const shared = stripThread((body.text ?? '').slice(0, MAX_TEXT))
  const source = [shared && `SHARED TEXT FROM THE USER:\n${shared}`, pageText && `PAGE CONTENT (${fetchedUrl}):\n${pageText}`].filter(Boolean).join('\n\n')
  const imgs = [...(body.images ?? []), ...(body.image ? [body.image] : [])].filter((i) => i?.data && /^image\//.test(i.mime ?? '')).slice(0, 6)
  const hasImage = imgs.length > 0
  const blocked = !!blockedReason && !shared && !hasImage

  if (!key) return json(200, { mode: 'none', blocked, blockedReason, sourceText: source.slice(0, 8000), fetchedUrl, deadlines: [], requirements: [], custom: {}, confidence: {}, evidence: {} })
  if (!source && !hasImage) return json(200, { mode: 'gemini', blocked: true, blockedReason: blockedReason ?? 'Nothing to read yet.', sourceText: '', fetchedUrl, deadlines: [], requirements: [], custom: {}, confidence: {}, evidence: {} })

  try {
    const parts: unknown[] = []
    if (source) parts.push({ text: source })
    if (hasImage) {
      parts.push({ text: imgs.length > 1 ? `The following ${imgs.length} images are consecutive screenshots of ONE post or flyer, in order. Read them together as a single opportunity.` : 'The following image is a screenshot of the post or flyer.' })
      for (const i of imgs) parts.push({ inline_data: { mime_type: i.mime, data: i.data } })
    }
    const answer = await callGemini(parts, fields, today, key, model, left, diag)
    const usedModel: string = answer?.__model ?? model
    let result: ParseResult = fromModel(answer, fields)
    const grounded = ground(result, source, hasImage)
    result = grounded.result
    const plain = `${shared}\n${pageText}`.trim()
    if (plain) result = backfill(result, heuristicParse(plain, undefined, new Date(`${today}T12:00:00Z`)))

    // Follow through: if the post points to an official page and the details are weak, read that page too. Official wins.
    const off = result.officialUrl
    if (off && left() > 8000 && (!result.deadlines.length || (result.confidence.deadline ?? 1) < 0.8)) {
      try {
        const host = new URL(off).hostname
        if (!SOCIAL.test(host) && !SHORT.test(host) && host !== (fetchedUrl ? new URL(fetchedUrl).hostname : '')) {
          const official = await fetchPage(off, Math.min(5000, left() - 4000))
          if (official.ok && official.text) {
            const merged = [...parts, { text: `OFFICIAL PAGE (${official.finalUrl}). Where it conflicts with the post, the official page wins:\n${official.text}` }]
            const second = fromModel(await callGemini(merged, fields, today, key, model, left, diag), fields)
            result = { ...result, ...second, officialUrl: official.finalUrl, deadlines: second.deadlines.length ? second.deadlines : result.deadlines }
            pageText = `${pageText}\n${official.text}`.slice(0, MAX_TEXT)
          }
        }
      } catch { /* keep first result */ }
    }
    return json(200, { ...result, mode: 'gemini', model: usedModel, blocked: false, blockedReason: undefined, dropped: grounded.dropped, diag, sourceText: `${shared}\n${pageText}`.trim().slice(0, 8000), fetchedUrl })
  } catch (e) {
    return json(200, { mode: 'none', blocked, blockedReason, diag, error: String((e as Error).message ?? e), sourceText: source.slice(0, 8000), fetchedUrl, deadlines: [], requirements: [], custom: {}, confidence: {}, evidence: {} })
  }
}


// ---------------------------------------------------------------------------------------------
// Public entry point: validation, per-client limits, shared cache and de-duplication around parseOnce.
export interface ParseDeps { store?: Store; clientId?: string; budgetMs?: number }
const defaultStore = memoryStore()
const perClient = limiter(Number(process.env.RATE_LIMIT_PER_MIN) || 20, 60_000)
const perClientImages = limiter(Number(process.env.IMAGE_LIMIT_PER_MIN) || 8, 60_000)
const flights = singleFlight<{ status: number; body: string }>()
const EMPTY = { deadlines: [], requirements: [], custom: {}, confidence: {}, evidence: {} }

export async function handleParse(req: Request, deps: ParseDeps = {}): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'POST only' })
  const store = deps.store ?? defaultStore
  const budgetMs = deps.budgetMs ?? (Number(process.env.PARSE_BUDGET_MS) || 25_000)
  const client = deps.clientId ?? req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local'

  // Read the body ourselves so the size limit cannot be dodged by leaving out Content-Length.
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return json(413, { error: 'Too large' })
  let raw: string
  try { raw = await req.text() } catch { return json(400, { error: 'Unreadable body' }) }
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'Too large' })
  let body: ParseRequest
  try { body = JSON.parse(raw) as ParseRequest } catch { return json(400, { error: 'Invalid JSON' }) }
  if (!body || typeof body !== 'object') return json(400, { error: 'Invalid request' })
  if (body.url !== undefined && (typeof body.url !== 'string' || body.url.length > 2000)) return json(400, { error: 'Invalid link' })
  if (body.text !== undefined && typeof body.text !== 'string') return json(400, { error: 'Invalid text' })
  const images = [...(Array.isArray(body.images) ? body.images : []), ...(body.image ? [body.image] : [])]
  if (images.length > 6) return json(400, { error: 'Up to 6 screenshots at a time' })
  if (!body.url && !body.text?.trim() && !images.length) return json(400, { error: 'Nothing to read' })

  const gateCheck = (images.length ? perClientImages : perClient)(client)
  if (!gateCheck.ok) return new Response(JSON.stringify({ ...EMPTY, mode: 'none', blocked: true, retryAfter: gateCheck.retryAfter, blockedReason: 'You are adding things very quickly. Give it a minute.' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': String(gateCheck.retryAfter) } })

  // Cache key: the same public link (or the same forwarded message) read with the same custom columns gives the same answer.
  const fieldSig = (body.fields ?? []).map((f) => f.key).sort().join(',')
    // Only plain public links are cached. Pasted text and screenshots may be private, so they are never stored on the server.
  const cacheable = !images.length && !!body.url && !body.text?.trim() && !!process.env.GEMINI_API_KEY
  const key = cacheable ? 'parse:v2:' + hash([canonicalUrl(body.url!), fieldSig, body.today ?? ''].join('|')) : ''
  if (key) {
    const hit = await store.get<ParseResult>(key)
    if (hit) { void bumpTrend(store, hit, canonicalUrl(body.url!)); return json(200, { ...hit, cached: true }) }
  }

  const run = async () => {
    const res = await parseOnce(new Request(req.url, { method: 'POST', headers: req.headers, body: raw }), budgetMs)
    const text = await res.text()
    if (key && res.status === 200) {
      try {
        const j = JSON.parse(text)
        // Good answers are kept for a day, "could not read it" for ten minutes so a retry storm costs nothing.
        if (j.mode === 'gemini' && !j.blocked) { await store.set(key, j, j.deadlines?.length ? 86_400 : 3_600); void bumpTrend(store, j, canonicalUrl(body.url!)) }
        else if (j.blocked) await store.set(key, j, 600)
      } catch { /* not cacheable */ }
    }
    return { status: res.status, body: text }
  }
  const out = key ? await flights(key, run) : await run()
  return new Response(out.body, { status: out.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

// ---- Trending: which public links are being added most. Only links, never pasted text or screenshots, and no user identity.
export interface TrendItem { url: string; title: string; university?: string; funder?: string; deadline?: string; country?: string; count: number; last: number }
const TREND_KEY = 'trend:v1'
async function bumpTrend(store: Store, r: ParseResult, url: string) {
  try {
    if (!r.title || SOCIAL.test(hostSafe(url)) || SHORT.test(hostSafe(url))) return
    const list = (await store.get<TrendItem[]>(TREND_KEY)) ?? []
    const now = Date.now()
    const main = r.deadlines?.find((d) => d.kind !== 'opens')?.date
    const hit = list.find((x) => x.url === url)
    if (hit) { hit.count++; hit.last = now; hit.title = r.title; hit.deadline = main }
    else list.push({ url, title: r.title, university: r.university, funder: r.funder, deadline: main, country: r.country, count: 1, last: now })
    const fresh = list.filter((x) => now - x.last < 21 * 86_400_000).sort((a, b) => b.count - a.count || b.last - a.last).slice(0, 300)
    await store.set(TREND_KEY, fresh, 30 * 86_400)
  } catch { /* best effort */ }
}
export async function handleTrending(_req: Request, deps: ParseDeps = {}): Promise<Response> {
  const list = (await (deps.store ?? defaultStore).get<TrendItem[]>(TREND_KEY)) ?? []
  const today = new Date().toISOString().slice(0, 10)
  const top = list.filter((x) => x.count >= 2 && (!x.deadline || x.deadline >= today)).slice(0, 30)
  return new Response(JSON.stringify({ items: top }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } })
}
