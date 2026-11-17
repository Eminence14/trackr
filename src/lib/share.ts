import type { Application, Criteria, Deadline, Funding } from './types'
import { newApplication } from './ingest'
import { uid } from './ids'
import { sanitizeApp } from './sanitize'
import { addApp, upsertOrg } from './store'

export interface ShareSnapshot {
  v: 1
  mode: 'mentor' | 'friend'
  from?: string
  at: string
  title: string
  university?: string
  funder?: string
  programme: string
  degreeLevel: string
  country: string
  status?: string
  deadlines: Deadline[]
  funding: Funding
  criteria: Criteria
  requirements: { label: string; kind: Application['requirements'][number]['kind']; done?: boolean }[]
  sourceUrl: string
  officialUrl: string
  progress?: { done: number; total: number }
}

export function buildSnapshot(a: Application, mode: 'mentor' | 'friend', university: string | undefined, from?: string): ShareSnapshot {
  const done = a.requirements.filter((r) => r.done).length
  return {
    v: 1, mode, from, at: new Date().toISOString(), title: a.title, university, funder: a.funder ?? undefined, programme: a.programme, degreeLevel: a.degreeLevel, country: a.country,
    status: mode === 'mentor' ? a.status : undefined, deadlines: a.deadlines, funding: a.funding, criteria: a.criteria,
    requirements: a.requirements.map((r) => ({ label: r.label, kind: r.kind, done: mode === 'mentor' ? r.done : undefined })),
    sourceUrl: a.sourceUrl, officialUrl: a.officialUrl, progress: mode === 'mentor' ? { done, total: a.requirements.length } : undefined,
  }
}

const toB64Url = (bytes: Uint8Array) => {
  let s = ''
  bytes.forEach((b) => { s += String.fromCharCode(b) })
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64Url = (str: string) => {
  const pad = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)
  const bin = atob(pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const w = stream.writable.getWriter()
  void w.write(bytes as unknown as BufferSource)
  void w.close()
  return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

export async function encodeSnapshot(s: ShareSnapshot): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(s))
  if (typeof CompressionStream !== 'undefined') return 'g.' + toB64Url(await pipe(raw, new CompressionStream('gzip')))
  return 'p.' + toB64Url(raw)
}

export async function decodeSnapshot(token: string): Promise<ShareSnapshot | null> {
  try {
    const kind = token.slice(0, 2)
    const bytes = fromB64Url(token.slice(2))
    const raw = kind === 'g.' ? await pipe(bytes, new DecompressionStream('gzip')) : bytes
    const j = JSON.parse(new TextDecoder().decode(raw))
    if (!j || j.v !== 1 || typeof j.title !== 'string' || !j.title.trim()) return null
    // A share link is untrusted input: rebuild it field by field.
    const a = sanitizeApp({ ...j, id: 'x', requirements: Array.isArray(j.requirements) ? j.requirements : [] })!
    const str = (v: unknown, n = 160) => (typeof v === 'string' ? v.slice(0, n) : undefined)
    return {
      v: 1, mode: j.mode === 'mentor' ? 'mentor' : 'friend', from: str(j.from, 60), at: typeof j.at === 'string' && !Number.isNaN(Date.parse(j.at)) ? j.at : new Date().toISOString(),
      title: a.title, university: str(j.university), funder: a.funder ?? undefined, programme: a.programme, degreeLevel: a.degreeLevel, country: a.country,
      status: j.mode === 'mentor' ? a.status : undefined, deadlines: a.deadlines, funding: a.funding, criteria: a.criteria,
      requirements: a.requirements.map((r) => ({ label: r.label, kind: r.kind, done: j.mode === 'mentor' ? r.done : undefined })),
      sourceUrl: a.sourceUrl, officialUrl: a.officialUrl,
      progress: j.mode === 'mentor' ? { done: a.requirements.filter((r) => r.done).length, total: a.requirements.length } : undefined,
    }
  } catch {
    return null
  }
}

export function importSnapshot(s: ShareSnapshot): string {
  const app = newApplication({
    title: s.title, organisationId: s.university ? upsertOrg(s.university, 'university', { country: s.country }) : null, funder: s.funder ?? null,
    programme: s.programme, degreeLevel: s.degreeLevel, country: s.country,
    deadlines: s.deadlines.map((d) => ({ ...d, id: uid('dl') })), funding: s.funding, criteria: s.criteria,
    requirements: s.requirements.map((r) => ({ id: uid('rq'), label: r.label, kind: r.kind, done: false })),
    sourceUrl: s.sourceUrl, officialUrl: s.officialUrl, sourceKind: 'shared', notes: s.from ? `Shared by ${s.from}` : '', verified: false, needsReview: true,
  })
  addApp(app)
  return app.id
}
