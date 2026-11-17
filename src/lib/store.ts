import { useSyncExternalStore } from 'react'
import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from 'idb-keyval'
import type { Mentee, AppState, Application, Capture, Essay, FieldDef, Organisation, PlanTask, Profile, Referee, Status, VaultDocMeta } from './types'
import { uid } from './ids'
import { addDays, defaultTz, isValidISO, isValidTz } from './dates'
import { sanitizeApp } from './sanitize'
import { generateTasks } from './planner'
import { delThumb, putThumb } from './thumbs'

const KEY = 'trackr:v1'

export const DEFAULT_FIELDS: FieldDef[] = [
  { id: 'f_title', key: 'title', label: 'Scholarship', type: 'text', isDefault: true, order: 0 },
  { id: 'f_institution', key: 'institution', label: 'University', type: 'text', isDefault: true, order: 1 },
  { id: 'f_funder', key: 'funder', label: 'Funder', type: 'text', isDefault: true, order: 2 },
  { id: 'f_deadline', key: 'deadline', label: 'Deadline', type: 'date', isDefault: true, order: 3 },
  { id: 'f_status', key: 'status', label: 'Status', type: 'select', isDefault: true, order: 4 },
  { id: 'f_country', key: 'country', label: 'Country', type: 'text', isDefault: true, order: 5, hidden: true },
  { id: 'f_programme', key: 'programme', label: 'Programme', type: 'text', isDefault: true, order: 6, hidden: true },
  { id: 'f_funding', key: 'funding', label: 'Funding', type: 'text', isDefault: true, order: 7, hidden: true },
]

export function defaultProfile(): Profile {
  return {
    name: '', email: '', country: 'Nigeria', nationality: 'Nigerian', degreeLevel: 'masters', fields: [], sources: [],
    view: 'list', groupBy: 'university', currency: 'NGN', tz: defaultTz(), fx: {}, remindDays: [14, 7, 3, 1],
    emailReminders: false, onboarded: false, createdAt: new Date().toISOString(),
  }
}

export function defaultState(): AppState {
  return {
    profile: defaultProfile(), fields: DEFAULT_FIELDS, orgs: [], apps: [], captures: [], essays: [], referees: [],
    vault: [], tasks: [], shownReminders: [], dismissed: [], mentees: [],
  }
}

let state: AppState = defaultState()
let loaded = false
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

// Other tabs of the same browser reload when one of them saves, so two open tabs never overwrite each other.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('trackr-sync') : null
const tabId = Math.random().toString(36).slice(2)
let persistError: ((msg: string) => void) | null = null
export const onPersistError = (cb: (msg: string) => void) => { persistError = cb }

function persistNow() {
  const snapshot = state
  timer = undefined
  idbSet(KEY, snapshot).then(() => channel?.postMessage({ from: tabId })).catch(() => {
    try { localStorage.setItem(KEY, JSON.stringify(snapshot)); channel?.postMessage({ from: tabId }) } catch {
      persistError?.('Your device storage is full or blocked, so recent changes are not being saved. Free some space or download a backup from Settings.')
    }
  })
}
if (channel) channel.onmessage = async (e) => {
  if (!loaded || e.data?.from === tabId || timer) return
  try { const raw = await idbGet<Partial<AppState>>(KEY); if (raw) { state = migrate(raw); listeners.forEach((l) => l()) } } catch { /* ignore */ }
}
function commit(next: AppState) {
  state = next
  if (loaded) {
    clearTimeout(timer)
    timer = setTimeout(persistNow, 200)
  }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snap = () => state
const loadedSnap = () => loaded

export const getState = () => state
export const subscribeStore = subscribe
export const useAppState = (): AppState => useSyncExternalStore(subscribe, snap, snap)
export const useStoreReady = (): boolean => useSyncExternalStore(subscribe, loadedSnap, loadedSnap)

function migrate(raw: Partial<AppState> | undefined): AppState {
  const base = defaultState()
  if (!raw) return base
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as T[]) : [])
  const profile = { ...base.profile, ...(raw.profile && typeof raw.profile === 'object' ? raw.profile : {}) }
  if (!isValidTz(profile.tz)) profile.tz = base.profile.tz
  if (!Array.isArray(profile.remindDays)) profile.remindDays = base.profile.remindDays
  profile.remindDays = profile.remindDays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 365)
  if (!Array.isArray(profile.fields)) profile.fields = []
  if (!Array.isArray(profile.sources)) profile.sources = []
  if (!['list', 'table', 'board'].includes(profile.view)) profile.view = 'list'
  if (!['university', 'funder'].includes(profile.groupBy)) profile.groupBy = 'university'
  const fields = arr<FieldDef>(raw.fields).filter((f) => typeof f.key === 'string' && typeof f.label === 'string')
  // built-in columns can never be lost, whatever a backup contains
  for (const d of base.fields) if (!fields.some((f) => f.key === d.key)) fields.push(d)
  const apps = arr<unknown>(raw.apps).map(sanitizeApp).filter((a): a is Application => !!a)
  const ids = new Set<string>()
  const uniqueApps = apps.filter((a) => (ids.has(a.id) ? false : (ids.add(a.id), true)))
  const orgs = arr<Organisation>(raw.orgs).filter((o) => typeof o.id === 'string' && typeof o.name === 'string' && o.name.trim())
  const orgIds = new Set(orgs.map((o) => o.id))
  for (const a of uniqueApps) if (a.organisationId && !orgIds.has(a.organisationId)) a.organisationId = null
  return {
    ...base,
    profile, fields, orgs, apps: uniqueApps,
    captures: arr<Capture>(raw.captures).slice(0, 200),
    essays: arr<Essay>(raw.essays).filter((e) => typeof e.id === 'string').map((e) => ({ ...e, title: String(e.title ?? ''), prompt: String(e.prompt ?? ''), body: String(e.body ?? ''), tags: Array.isArray(e.tags) ? e.tags : [], applicationIds: Array.isArray(e.applicationIds) ? e.applicationIds : [] })),
    referees: arr<Referee>(raw.referees).filter((r) => typeof r.id === 'string').map((r) => ({ ...r, name: String(r.name ?? ''), email: String(r.email ?? ''), org: String(r.org ?? ''), notes: String(r.notes ?? ''), asks: Array.isArray(r.asks) ? r.asks.filter((k) => k && typeof k.applicationId === 'string' && typeof k.askedAt === 'string') : [] })),
    vault: arr<VaultDocMeta>(raw.vault).filter((v) => typeof v.id === 'string' && typeof v.name === 'string'),
    tasks: arr<PlanTask>(raw.tasks).filter((t) => typeof t.id === 'string' && ids.has(t.applicationId) && isValidISO(t.due) && typeof t.label === 'string'),
    shownReminders: Array.isArray(raw.shownReminders) ? raw.shownReminders.filter((x) => typeof x === 'string').slice(-500) : [],
    dismissed: Array.isArray(raw.dismissed) ? raw.dismissed.filter((x) => typeof x === 'string').slice(-500) : [],
    mentees: arr<Mentee>(raw.mentees).filter((m) => typeof m.id === 'string' && typeof m.token === 'string' && m.token.length < 20000).slice(0, 500),
  }
}

export async function initStore(): Promise<void> {
  if (loaded) return
  let raw: Partial<AppState> | undefined
  try { raw = await idbGet(KEY) } catch { /* fall through */ }
  if (!raw) { try { const ls = localStorage.getItem(KEY); if (ls) raw = JSON.parse(ls) } catch { /* ignore */ } }
  loaded = true
  commit(migrate(raw))
  // Move thumbnails that older versions stored inline out of the main record.
  const inline = state.apps.filter((a) => a.thumbnail)
  if (inline.length) {
    for (const a of inline) void putThumb(a.id, a.thumbnail!)
    commit({ ...state, apps: state.apps.map((a) => (a.thumbnail ? { ...a, thumbnail: undefined, hasThumb: true } : a)) })
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => { if (loaded) persistNow() })
  document.addEventListener('visibilitychange', () => { if (loaded && document.visibilityState === 'hidden') persistNow() })
}

// ---- profile & fields
export const updateProfile = (patch: Partial<Profile>) => commit({ ...state, profile: { ...state.profile, ...patch } })
export const addField = (f: Omit<FieldDef, 'id' | 'order' | 'isDefault'>) =>
  commit({ ...state, fields: [...state.fields, { ...f, id: uid('f'), isDefault: false, order: state.fields.length }] })
export const updateField = (id: string, patch: Partial<FieldDef>) =>
  commit({ ...state, fields: state.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) })
export const removeField = (id: string) => commit({ ...state, fields: state.fields.filter((f) => f.id !== id || f.isDefault) })

// ---- organisations
const norm = (s: string) => s.toLowerCase().replace(/\b(the|of|and|&)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
export function findOrg(name: string, kind: Organisation['kind'], orgs = state.orgs): Organisation | undefined {
  const n = norm(name)
  if (!n) return undefined
  // Same words in any order ("Cambridge University" = "University of Cambridge"), but never a prefix match:
  // "University of California" and "University of California, Berkeley" are different places.
  const key = (x: string) => x.split(' ').map((w) => (w === 'univ' || w === 'uni' ? 'university' : w)).sort().join(' ')
  return orgs.find((o) => o.kind === kind && key(norm(o.name)) === key(n))
}
export function upsertOrg(name: string, kind: Organisation['kind'], extra: Partial<Organisation> = {}): string {
  const hit = findOrg(name, kind)
  if (hit) {
    const patch = Object.fromEntries(Object.entries(extra).filter(([k, v]) => v && !(hit as any)[k]))
    if (Object.keys(patch).length) commit({ ...state, orgs: state.orgs.map((o) => (o.id === hit.id ? { ...o, ...patch } : o)) })
    return hit.id
  }
  const org: Organisation = { id: uid('org'), name: name.trim(), kind, ...extra }
  commit({ ...state, orgs: [...state.orgs, org] })
  return org.id
}
export const updateOrg = (id: string, patch: Partial<Organisation>) => commit({ ...state, orgs: state.orgs.map((o) => (o.id === id ? { ...o, ...patch } : o)) })

// ---- applications
export const addApp = (app: Application) => commit({ ...state, apps: [app, ...state.apps] })
export const addApps = (apps: Application[]) => commit({ ...state, apps: [...apps, ...state.apps] })
const hasMain = (a: Application) => a.deadlines.some((d) => d.kind !== 'opens')
export function patchApp(id: string, patch: Partial<Application>) {
  const before = state.apps.find((a) => a.id === id)
  commit({ ...state, apps: state.apps.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a)) })
  // First real deadline just arrived: build the step-by-step plan so reminders and "This week" have something to show.
  const after = state.apps.find((a) => a.id === id)
  if (patch.deadlines && before && after && !hasMain(before) && hasMain(after) && !state.tasks.some((t) => t.applicationId === id)) {
    const tasks = generateTasks(after, state.profile.tz)
    if (tasks.length) commit({ ...state, tasks: [...state.tasks, ...tasks] })
  }
}
export const removeApp = (id: string) => {
  void delThumb(id)
  commit({
    ...state,
    apps: state.apps.filter((a) => a.id !== id),
    tasks: state.tasks.filter((t) => t.applicationId !== id),
    referees: state.referees.map((r) => ({ ...r, asks: r.asks.filter((k) => k.applicationId !== id) })),
    essays: state.essays.map((e) => ({ ...e, applicationIds: e.applicationIds.filter((x) => x !== id) })),
  })
}
export function setStatus(id: string, status: Status) {
  const a = state.apps.find((x) => x.id === id)
  if (!a || a.status === status) return
  // Most awards run every year. When this round is over without a win, note roughly when the next one should open
  // (about ten months after this deadline) so "This week" can bring it back in time.
  const main = a.deadlines.find((d) => d.kind === 'scholarship') ?? a.deadlines.find((d) => d.kind !== 'opens')
  const next = ['missed', 'rejected', 'withdrawn'].includes(status) && !a.nextCycleOn && main ? addDays(main.date, 305) : a.nextCycleOn
  patchApp(id, { status, nextCycleOn: next, history: [...a.history, { at: new Date().toISOString(), from: a.status, to: status }].slice(-100) })
}
export function toggleRequirement(appId: string, reqId: string) {
  const a = state.apps.find((x) => x.id === appId)
  if (!a) return
  patchApp(appId, { requirements: a.requirements.map((r) => (r.id === reqId ? { ...r, done: !r.done } : r)) })
}

// ---- captures
export const addCapture = (c: Capture) => commit({ ...state, captures: [c, ...state.captures].slice(0, 200) })
export const patchCapture = (id: string, patch: Partial<Capture>) => commit({ ...state, captures: state.captures.map((c) => (c.id === id ? { ...c, ...patch } : c)) })

// ---- essays, referees, tasks, vault
export const upsertEssay = (e: Essay) =>
  commit({ ...state, essays: state.essays.some((x) => x.id === e.id) ? state.essays.map((x) => (x.id === e.id ? e : x)) : [e, ...state.essays] })
export const removeEssay = (id: string) => commit({ ...state, essays: state.essays.filter((e) => e.id !== id) })
export const upsertReferee = (r: Referee) =>
  commit({ ...state, referees: state.referees.some((x) => x.id === r.id) ? state.referees.map((x) => (x.id === r.id ? r : x)) : [r, ...state.referees] })
export const removeReferee = (id: string) => commit({ ...state, referees: state.referees.filter((r) => r.id !== id) })
/** Replace the automatic plan for one application. Tasks the user added stay, and steps already ticked stay ticked. */
export function setTasksForApp(appId: string, tasks: PlanTask[]) {
  const done = new Set(state.tasks.filter((t) => t.applicationId === appId && t.auto && t.done).map((t) => t.label))
  commit({ ...state, tasks: [...state.tasks.filter((t) => t.applicationId !== appId || !t.auto), ...tasks.map((t) => (done.has(t.label) ? { ...t, done: true } : t))] })
}
export const addTask = (t: PlanTask) => commit({ ...state, tasks: [...state.tasks, t] })
export const toggleTask = (id: string) => commit({ ...state, tasks: state.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })
export const removeTask = (id: string) => commit({ ...state, tasks: state.tasks.filter((t) => t.id !== id) })
export const addVaultMeta = (m: VaultDocMeta) => commit({ ...state, vault: [m, ...state.vault] })
export const patchVaultMeta = (id: string, patch: Partial<VaultDocMeta>) => commit({ ...state, vault: state.vault.map((v) => (v.id === id ? { ...v, ...patch } : v)) })
export const removeVaultMeta = (id: string) => commit({ ...state, vault: state.vault.filter((v) => v.id !== id) })

export const addMentee = (token: string) => { if (!state.mentees.some((m) => m.token === token)) commit({ ...state, mentees: [{ id: uid('mt'), token, addedAt: new Date().toISOString() }, ...state.mentees].slice(0, 500) }) }
export const removeMentee = (id: string) => commit({ ...state, mentees: state.mentees.filter((m) => m.id !== id) })
export const markShown = (ids: string[]) => commit({ ...state, shownReminders: Array.from(new Set([...state.shownReminders, ...ids])).slice(-500) })
export const dismiss = (id: string) => commit({ ...state, dismissed: Array.from(new Set([...state.dismissed, id])) })

// ---- data portability
export function exportAll(): string {
  return JSON.stringify({ app: 'trackr', version: 1, exportedAt: new Date().toISOString(), state }, null, 2)
}
export function importAll(json: string): void {
  const parsed = JSON.parse(json)
  if (parsed?.app !== 'trackr' || !parsed.state) throw new Error('This is not a Trackr export.')
  commit(migrate(parsed.state))
}
export async function resetAll(): Promise<void> {
  clearTimeout(timer)
  try { for (const k of await idbKeys()) await idbDel(k) } catch { /* ignore */ }
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
  try { await caches.delete('trackr-shared') } catch { /* ignore */ }
  commit(defaultState())
  persistNow()
}
