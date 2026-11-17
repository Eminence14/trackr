// OPTIONAL account + sync + email reminders, backed by Supabase (see supabase/schema.sql).
// Off unless VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set at build time.
// NOT YET RUN against a live Supabase project. Trackr works fully without it.
import { get, set, del } from 'idb-keyval'
import type { AppState } from './types'
import { exportAll, getState, importAll, subscribeStore } from './store'
import { toUserZone } from './dates'

const BASE = (import.meta.env?.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '')
const ANON = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined
export const cloudEnabled = !!(BASE && ANON)

interface Session { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string } }
const SKEY = 'cloud:session'
const VKEY = 'cloud:version'
let session: Session | null = null
let dirty = false
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
export let syncStatus: 'off' | 'idle' | 'syncing' | 'error' = 'off'
const setStatus = (s: typeof syncStatus) => { syncStatus = s; listeners.forEach((l) => l()) }
export const onCloudChange = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const cloudUser = () => session?.user ?? null

async function auth(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}/auth/v1/${path}`, { method: 'POST', headers: { apikey: ANON!, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.msg || j.error_description || j.message || `Sign-in failed (${res.status})`)
  return j
}
const toSession = (j: any): Session => ({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000, user: { id: j.user.id, email: j.user.email } })

/** Step 1: email a 6-digit code. Step 2: verifyCode. No passwords anywhere. */
export const requestCode = (email: string) => auth('otp', { email, create_user: true })
export async function verifyCode(email: string, token: string): Promise<void> {
  session = toSession(await auth('verify', { type: 'email', email, token: token.trim() }))
  await set(SKEY, session)
  setStatus('idle')
  await firstSync()
}
async function fresh(): Promise<Session | null> {
  if (!session) return null
  if (session.expires_at - Date.now() > 60_000) return session
  try { session = toSession(await auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token })); await set(SKEY, session) } catch { /* keep the old one; the next call will fail and surface it */ }
  return session
}
async function rest(path: string, init: RequestInit & { prefer?: string } = {}): Promise<Response> {
  const s = await fresh()
  if (!s) throw new Error('Not signed in')
  return fetch(`${BASE}/rest/v1/${path}`, { ...init, headers: { apikey: ANON!, authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json', ...(init.prefer ? { prefer: init.prefer } : {}) } })
}

const payload = (st: AppState) => ({ ...st, captures: [], shownReminders: [], dismissed: [] })
/** The rows the email job reads: one per open deadline, as a date in the user's own time zone. */
export function reminderRows(st: AppState, userId: string) {
  const rows = new Map<string, object>()
  for (const a of st.apps) for (const d of a.deadlines) {
    if (d.kind === 'opens') continue
    const due = toUserZone(d, st.profile.tz).date
    rows.set(`${a.id}|${due}`, { user_id: userId, application_id: a.id, title: (a.title || 'Untitled').slice(0, 200), due_on: due, status: a.status, url: a.officialUrl || a.sourceUrl || null })
  }
  return [...rows.values()]
}

async function push(): Promise<void> {
  if (!session) return
  setStatus('syncing')
  try {
    const st = getState()
    const version = Date.now()
    const id = session.user.id
    const a = await rest('tracker_state?on_conflict=user_id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: JSON.stringify({ user_id: id, version, state: payload(st), updated_at: new Date().toISOString() }) })
    if (!a.ok) throw new Error(String(a.status))
    await rest('profiles?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: JSON.stringify({ id, email: st.profile.email || session.user.email, name: st.profile.name, country: st.profile.country, tz: st.profile.tz, remind_days: st.profile.remindDays, email_reminders: st.profile.emailReminders, consent_at: st.profile.consentAt ?? null }) })
    await rest(`reminder_items?user_id=eq.${id}`, { method: 'DELETE' })
    const rows = reminderRows(st, id)
    if (rows.length) await rest('reminder_items', { method: 'POST', body: JSON.stringify(rows) })
    await set(VKEY, version)
    dirty = false
    setStatus('idle')
  } catch { setStatus('error') }
}
async function pull(): Promise<{ version: number; state: AppState } | null> {
  const res = await rest(`tracker_state?select=version,state&user_id=eq.${session!.user.id}`)
  if (!res.ok) throw new Error(String(res.status))
  const rows = (await res.json()) as { version: number; state: AppState }[]
  return rows[0] ?? null
}
const adopt = (state: AppState) => { importAll(JSON.stringify({ app: 'trackr', state: { ...state, profile: { ...state.profile, onboarded: true } } })); dirty = false }

async function firstSync() {
  const remote = await pull().catch(() => null)
  const local = getState()
  if (remote && remote.state?.apps?.length && local.apps.length) {
    // Both sides have data: never merge silently.
    if (confirm(`Your account already has ${remote.state.apps.length} application(s) and this device has ${local.apps.length}.\n\nOK = use the account copy on this device (a backup of this device downloads first).\nCancel = keep this device and replace the account copy.`)) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportAll()], { type: 'application/json' })); a.download = 'trackr-before-sync.json'; a.click()
      adopt(remote.state); await set(VKEY, remote.version)
    } else await push()
  } else if (remote && remote.state?.apps?.length) { adopt(remote.state); await set(VKEY, remote.version) } else await push()
}

export async function initCloud(): Promise<void> {
  if (!cloudEnabled) return
  session = (await get<Session>(SKEY)) ?? null
  subscribeStore(() => { if (!session) return; dirty = true; clearTimeout(timer); timer = setTimeout(() => void push(), 8000) })
  if (!session) return
  setStatus('idle')
  try {
    const remote = await pull()
    const seen = (await get<number>(VKEY)) ?? 0
    // Another device saved since we last synced, and nothing changed here meanwhile: take theirs. Otherwise the latest save wins.
    if (remote && remote.version > seen && !dirty) { adopt(remote.state); await set(VKEY, remote.version) }
  } catch { setStatus('error') }
}
export async function signOut() { session = null; clearTimeout(timer); await del(SKEY); await del(VKEY); setStatus('off') }
/** GDPR/NDPA erasure of the server copy. The on-device copy is removed by "Delete all my data". */
export async function deleteCloudData(): Promise<boolean> {
  if (!session) return false
  const id = session.user.id
  const all = await Promise.all([rest(`reminder_items?user_id=eq.${id}`, { method: 'DELETE' }), rest(`tracker_state?user_id=eq.${id}`, { method: 'DELETE' }), rest(`profiles?id=eq.${id}`, { method: 'DELETE' })])
  return all.every((r) => r.ok)
}
