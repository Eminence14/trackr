import { get as idbGet, set as idbSet } from 'idb-keyval'
import type { FieldDef, ParseResult } from './types'
import { heuristicParse } from './heuristic'
import { canonicalUrl } from './url'
import { todayIn } from './dates'

export interface ParseInput {
  url?: string
  text?: string
  image?: { mime: string; data: string }
  images?: { mime: string; data: string }[]
}
const TTL = 7 * 24 * 3600 * 1000

type ServerReply = { r: ParseResult | null; status: number; retryAfter?: number }
async function callServer(body: unknown): Promise<ServerReply> {
  try {
    const res = await fetch('/api/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(35_000) })
    if (res.status === 429) return { r: null, status: 429, retryAfter: Number(res.headers.get('retry-after')) || 60 }
    if (!res.ok) return { r: null, status: res.status }
    const j = (await res.json()) as ParseResult
    return { r: j && typeof j === 'object' && Array.isArray(j.deadlines) ? j : null, status: 200 }
  } catch {
    return { r: null, status: 0 }
  }
}

/** Parse a link, pasted text or screenshot. Always resolves: weak results simply land in the review queue. */
export async function parseInput(input: ParseInput, fields: FieldDef[], tz: string, opts: { fresh?: boolean } = {}): Promise<ParseResult> {
  const cacheKey = input.url && !input.text && !input.image && !input.images?.length ? 'src:' + canonicalUrl(input.url) : undefined
  if (cacheKey && !opts.fresh) {
    try {
      const hit = await idbGet<{ at: number; r: ParseResult }>(cacheKey)
      if (hit && Date.now() - hit.at < TTL && hit.r.deadlines.length) return hit.r
    } catch { /* ignore cache errors */ }
  }
  const body = {
    ...input,
    fields: fields.filter((f) => !f.isDefault).map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options })),
    today: todayIn(tz),
    tz,
  }
  const reply = await callServer(body)
  let r = reply.r
  if (!r) {
    const base = heuristicParse(input.text ?? '', input.url)
    const linkOnly = !!input.url && !input.text
    const why = reply.status === 429 ? 'Trackr is very busy right now.' : reply.status === 413 ? 'That was too large to send. Try fewer or smaller screenshots.' : 'Could not reach the reader service.'
    return { ...base, error: reply.status === 429 ? 'busy' : undefined, retryAfter: reply.retryAfter, blocked: linkOnly || (!!input.images?.length || !!input.image) && !input.text, blockedReason: linkOnly || !input.text ? why : undefined }
  }
  if (r.mode === 'none') {
    // No AI key on the server: use the offline parser on whatever text we got.
    const text = [input.text, r.sourceText].filter(Boolean).join('\n')
    const h = heuristicParse(text, input.url ?? r.fetchedUrl)
    r = { ...h, blocked: r.blocked && !text, blockedReason: r.blockedReason, fetchedUrl: r.fetchedUrl, mode: 'heuristic' }
  }
  if (cacheKey && r.mode === 'gemini' && r.deadlines.length) idbSet(cacheKey, { at: Date.now(), r }).catch(() => {})
  return r
}
