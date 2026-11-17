// Shared plumbing that keeps the parse endpoint standing when many people use it at once:
// a pluggable key-value store (memory in dev, Netlify Blobs in production), a per-client limiter,
// a concurrency gate for the AI, and a circuit breaker for when the AI quota runs out.
import { createHash } from 'node:crypto'

export interface Store {
  get<T>(key: string): Promise<T | undefined>
  set<T>(key: string, value: T, ttlSec: number): Promise<void>
}

/** Bounded in-memory store. Fine for one dev server; in production each instance has its own, so pass a shared one. */
export function memoryStore(max = 1000): Store {
  const m = new Map<string, { exp: number; v: unknown }>()
  return {
    async get<T>(key: string) {
      const hit = m.get(key)
      if (!hit) return undefined
      if (hit.exp < Date.now()) { m.delete(key); return undefined }
      m.delete(key); m.set(key, hit) // refresh recency
      return hit.v as T
    },
    async set<T>(key: string, value: T, ttlSec: number) {
      m.delete(key)
      m.set(key, { exp: Date.now() + ttlSec * 1000, v: value })
      while (m.size > max) m.delete(m.keys().next().value as string)
    },
  }
}

/** Wraps any blob-like store (get/setJSON) with expiry, because blob stores keep things for ever by default. */
export function blobStore(blobs: { get(key: string, o: { type: 'json' }): Promise<unknown>; setJSON(key: string, v: unknown): Promise<unknown> }): Store {
  return {
    async get<T>(key: string) {
      try { const hit = (await blobs.get(key, { type: 'json' })) as { exp: number; v: T } | null; return hit && hit.exp > Date.now() ? hit.v : undefined } catch { return undefined }
    },
    async set<T>(key: string, value: T, ttlSec: number) {
      try { await blobs.setJSON(key, { exp: Date.now() + ttlSec * 1000, v: value }) } catch { /* cache is best effort */ }
    },
  }
}

export const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32)

/** Sliding-window limiter per client. A backstop: on Netlify the platform limiter in the function config runs first. */
export function limiter(limit: number, windowMs: number, maxClients = 5000) {
  const hits = new Map<string, number[]>()
  return (client: string, now = Date.now()): { ok: boolean; retryAfter: number } => {
    const list = (hits.get(client) ?? []).filter((t) => now - t < windowMs)
    if (list.length >= limit) { hits.set(client, list); return { ok: false, retryAfter: Math.ceil((windowMs - (now - list[0])) / 1000) } }
    list.push(now)
    hits.delete(client); hits.set(client, list)
    while (hits.size > maxClients) hits.delete(hits.keys().next().value as string)
    return { ok: true, retryAfter: 0 }
  }
}

/** At most `max` jobs at once; the rest wait their turn, but never longer than `waitMs`. */
export function gate(max: number) {
  let active = 0
  const waiting: (() => void)[] = []
  return async function run<T>(job: () => Promise<T>, waitMs: number): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => { const i = waiting.indexOf(go); if (i >= 0) waiting.splice(i, 1); reject(new Error('busy')) }, waitMs)
        const go = () => { clearTimeout(t); resolve() }
        waiting.push(go)
      })
    }
    active++
    try { return await job() } finally { active--; waiting.shift()?.() }
  }
}

/** One piece of work per key at a time: ten people sharing the same viral link cost one fetch and one AI call. */
export function singleFlight<T>() {
  const inflight = new Map<string, Promise<T>>()
  return (key: string, job: () => Promise<T>): Promise<T> => {
    const existing = inflight.get(key)
    if (existing) return existing
    const p = job().finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  }
}

/** After the AI says "quota exhausted", stop calling it for a while instead of hammering it. */
export function breaker() {
  let until = 0
  return { open: (now = Date.now()) => now < until, trip: (ms: number, now = Date.now()) => { until = Math.max(until, now + ms) }, reset: () => { until = 0 } }
}
