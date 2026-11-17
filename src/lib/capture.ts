import { addCapture, getState, patchApp, patchCapture } from './store'
import { parseInput } from './parseClient'
import { saveParsed } from './ingest'
import { extractUrls } from './url'
import { uid } from './ids'
import type { Capture, CaptureKind } from './types'
import type { PreparedImage } from './image'

export interface CaptureItem {
  kind: CaptureKind
  url?: string
  text?: string
  image?: PreparedImage
  images?: PreparedImage[] // several screenshots of one post, in order
}
export interface CaptureOutcome { id: string; duplicate: boolean; refreshed?: boolean; note?: string; failed?: boolean; queued?: boolean }

const URLS = /https?:\/\/\S+/g
/** Work out what the person pasted: one link, several links, one post with its link, or a digest of several opportunities. */
export function splitInput(raw: string): CaptureItem[] {
  const t = raw.trim().slice(0, 24000)
  if (!t) return []
  const urls = extractUrls(t)
  const rest = t.replace(URLS, '').trim()
  if (!urls.length) return [{ kind: 'paste', text: t }]
  if (rest.length < 30) return urls.slice(0, 10).map((u) => ({ kind: 'link' as const, url: u }))
  const blocks = t.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean)
  const linked = blocks.filter((b) => extractUrls(b).length)
  const described = linked.filter((b) => b.replace(URLS, '').trim().length > 25)
  if (linked.length >= 2 && described.length === linked.length && new Set(linked.map((b) => extractUrls(b)[0])).size === linked.length) {
    return described.slice(0, 10).map((b) => ({ kind: 'share' as const, url: extractUrls(b)[0], text: b }))
  }
  return [{ kind: rest.length > 40 ? 'share' : 'link', url: urls[0], text: rest.length > 40 ? t : undefined }]
}

/** Links added with no connection wait here and are read as soon as the device is back online. */
export function queueOffline(url: string) {
  addCapture({ id: uid('cp'), kind: 'link', payload: url.slice(0, 2000), state: 'queued', createdAt: new Date().toISOString() })
}
let retryTimer: ReturnType<typeof setTimeout> | undefined
function scheduleRetry(ms: number) { clearTimeout(retryTimer); retryTimer = setTimeout(() => void processQueue(), Math.min(Math.max(ms, 5000), 10 * 60_000)) }
let draining = false
export async function processQueue(): Promise<number> {
  if (draining || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 0
  draining = true
  let n = 0
  try {
    for (const c of getState().captures.filter((x) => x.state === 'queued').reverse().slice(0, 20)) {
      patchCapture(c.id, { state: 'done' })
      const o = await captureOne({ kind: 'link', url: c.payload })
      if (o.queued) break // still busy: the retry timer will pick it up
      if (!o.failed) n++
    }
  } finally { draining = false }
  return n
}

/** Run one link / pasted text / screenshot through the parser and store the result. Never throws. */
export async function captureOne(item: CaptureItem): Promise<CaptureOutcome> {
  const { fields, profile } = getState()
  const cap: Capture = { id: uid('cp'), kind: item.kind, payload: item.url ? item.url.slice(0, 2000) : (item.text ?? 'screenshot').slice(0, 300), state: 'parsing', createdAt: new Date().toISOString() }
  addCapture(cap)
  try {
    const r = await parseInput({ url: item.url, text: item.text, image: item.image ? { mime: item.image.mime, data: item.image.data } : undefined, images: item.images?.map((i) => ({ mime: i.mime, data: i.data })) }, fields, profile.tz)
    if (r.error === 'busy' && item.kind === 'link' && item.url && !item.text) {
      // keep it in the queue and come back when the rush has passed
      patchCapture(cap.id, { state: 'queued', payload: item.url })
      scheduleRetry((r.retryAfter ?? 60) * 1000)
      return { id: '', duplicate: false, queued: true, note: 'Trackr is busy. That link is saved and will be read automatically in a minute.' }
    }
    const unreadable = r.blocked && !r.title && !r.deadlines.length
    if (unreadable) {
      patchCapture(cap.id, { state: 'failed', error: r.blockedReason })
      return { id: '', duplicate: false, failed: true, note: (r.blockedReason ?? "Couldn't read that link.") + ' Paste the post text or add a screenshot instead.' }
    }
    const out = saveParsed(r, { sourceUrl: item.url ?? '', rawText: item.text ?? '', thumbnail: (item.image ?? item.images?.[0])?.thumb, capture: cap, fields })
    patchCapture(cap.id, { state: 'done', applicationId: out.id })
    const note = r.blocked ? r.blockedReason : r.error ? 'The AI reader was busy, so this was read the basic way. Please check it.' : r.dropped?.length ? 'Some details could not be confirmed in the post and were left blank.' : undefined
    return { id: out.id, duplicate: out.duplicate, refreshed: out.refreshed, note }
  } catch (e) {
    patchCapture(cap.id, { state: 'failed', error: String((e as Error).message ?? e) })
    return { id: '', duplicate: false, failed: true, note: 'Something went wrong reading that. Try pasting the text instead.' }
  }
}
