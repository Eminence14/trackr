import { Suspense, lazy, useEffect, useMemo } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Flame, GraduationCap, BookOpen, CalendarDays, ClipboardCheck, FileLock2, LayoutGrid, MoreHorizontal, Plus, Settings as Cog, Users, BarChart3 } from 'lucide-react'
import { useAppState, useStoreReady, markShown, onPersistError } from './lib/store'
import { processQueue } from './lib/capture'
import { recheckSome } from './lib/recheck'
import { get as idbGet } from 'idb-keyval'
import { toast } from './components/ui'
import { dueReminders } from './lib/reminders'
import { ToastHost } from './components/ui'
import { AddSheet } from './components/AddSheet'
import { openAdd } from './components/addBus'
import { Onboarding } from './pages/Onboarding'
import { Home } from './pages/Home'
import { Detail } from './pages/Detail'
import { Week } from './pages/Week'
import { Review } from './pages/Review'

// Screens used less often load on demand, so the first visit downloads less. They are fetched quietly once the app is idle.
const loaders = {
  './pages/SharePage': () => import('./pages/SharePage'),
  './pages/Shared': () => import('./pages/Shared'),
  './pages/Vault': () => import('./pages/Vault'),
  './pages/Essays': () => import('./pages/Essays'),
  './pages/Referees': () => import('./pages/Referees'),
  './pages/Stats': () => import('./pages/Stats'),
  './pages/ImportPage': () => import('./pages/ImportPage'),
  './pages/Settings': () => import('./pages/Settings'),
  './pages/Legal': () => import('./pages/Legal'),
  './pages/Trending': () => import('./pages/Trending'),
  './pages/Counsellor': () => import('./pages/Counsellor'),
}
const SharePage = lazy(() => loaders['./pages/SharePage']().then((m) => ({ default: m.SharePage })))
const Shared = lazy(() => loaders['./pages/Shared']().then((m) => ({ default: m.Shared })))
const Vault = lazy(() => loaders['./pages/Vault']().then((m) => ({ default: m.Vault })))
const Essays = lazy(() => loaders['./pages/Essays']().then((m) => ({ default: m.Essays })))
const Referees = lazy(() => loaders['./pages/Referees']().then((m) => ({ default: m.Referees })))
const Stats = lazy(() => loaders['./pages/Stats']().then((m) => ({ default: m.Stats })))
const ImportPage = lazy(() => loaders['./pages/ImportPage']().then((m) => ({ default: m.ImportPage })))
const Settings = lazy(() => loaders['./pages/Settings']().then((m) => ({ default: m.Settings })))
const More = lazy(() => loaders['./pages/Settings']().then((m) => ({ default: m.More })))
const Terms = lazy(() => loaders['./pages/Legal']().then((m) => ({ default: m.Terms })))
const Privacy = lazy(() => loaders['./pages/Legal']().then((m) => ({ default: m.Privacy })))
const Trending = lazy(() => loaders['./pages/Trending']().then((m) => ({ default: m.Trending })))
const Counsellor = lazy(() => loaders['./pages/Counsellor']().then((m) => ({ default: m.Counsellor })))
export function prefetchScreens() { for (const load of Object.values(loaders)) void load().catch(() => {}) }
const idle = (f: () => void) => ('requestIdleCallback' in window ? (window as unknown as { requestIdleCallback: (f: () => void, o: object) => void }).requestIdleCallback(f, { timeout: 4000 }) : setTimeout(f, 1500))

function ScreenSkeleton() {
  return (
    <div className="stack lg" aria-busy="true" aria-label="Loading">
      <div className="skel" style={{ height: 34, width: '40%' }} />
      <div className="skel" style={{ height: 90 }} />
      <div className="skel" style={{ height: 90 }} />
      <div className="skel" style={{ height: 90, width: '70%' }} />
    </div>
  )
}

const PUBLIC = ['/terms', '/privacy', '/s/']

export function App() {
  const ready = useStoreReady()
  const state = useAppState()
  const loc = useLocation()
  const { profile, apps } = state
  const reviewCount = useMemo(() => apps.filter((a) => a.needsReview).length, [apps])

  useEffect(() => {
    const t = profile.theme
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
    else delete document.documentElement.dataset.theme
  }, [profile])

  useEffect(() => {
    if (!ready || !profile.onboarded) return
    const due = dueReminders(apps, profile).filter((r) => !state.shownReminders.includes(r.id))
    if (!due.length) return
    markShown(due.map((r) => r.id))
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    void (async () => {
      try {
        // the background check may already have announced some of these while the app was closed
        const told = new Set((await idbGet<string[]>('trackr:notified')) ?? [])
        const reg = await navigator.serviceWorker?.ready
        if (!reg) return
        for (const r of due.filter((x) => !told.has(x.id)).slice(0, 4)) await reg.showNotification(r.title, { body: r.text, tag: r.id, icon: '/icon-192.png', data: { url: `/app/${r.appId}` } })
        await (reg as unknown as { periodicSync?: { register: (tag: string, o: { minInterval: number }) => Promise<void> } }).periodicSync?.register('trackr-reminders', { minInterval: 12 * 3600 * 1000 })
      } catch { /* notifications are a bonus; never break the app over them */ }
    })()
  }, [ready, profile, apps, state.shownReminders])

  useEffect(() => {
    let warned = false
    onPersistError((msg) => { if (!warned) { warned = true; toast(msg) } })
    const drain = () => { void processQueue().then((n) => { if (n) toast(`${n} saved link${n > 1 ? 's' : ''} read now that you are online`) }) }
    window.addEventListener('online', drain)
    return () => window.removeEventListener('online', drain)
  }, [])
  useEffect(() => { if (ready && profile.onboarded) void processQueue() }, [ready, profile.onboarded])
  useEffect(() => { if (ready) idle(prefetchScreens) }, [ready])
  useEffect(() => { document.querySelector('.main')?.scrollTo?.({ top: 0 }); window.scrollTo?.({ top: 0 }) }, [loc.pathname])
  useEffect(() => {
    if (!ready || !profile.onboarded) return
    // quietly re-read a couple of open applications a week after they were last checked
    const t = setTimeout(() => { if (document.visibilityState === 'visible') void recheckSome(2).then((n) => { if (n) toast(`${n} deadline${n > 1 ? 's' : ''} may have changed. See Review.`) }) }, 20_000)
    return () => clearTimeout(t)
  }, [ready, profile.onboarded])

  if (!ready) return <div className="boot"><img src="/icon.svg" alt="" /><span>Trackr</span></div>
  const isPublic = PUBLIC.some((p) => loc.pathname.startsWith(p))
  if (!profile.onboarded && !isPublic) return <><Onboarding /><ToastHost /></>

  const links = [
    { to: '/', label: 'Tracker', icon: <LayoutGrid size={18} />, end: true },
    { to: '/week', label: 'This week', icon: <CalendarDays size={18} /> },
    { to: '/review', label: 'Review', icon: <ClipboardCheck size={18} />, badge: reviewCount },
  ]
  const discover = [{ to: '/trending', label: 'Trending', icon: <Flame size={18} /> }]
  const tools = [
    { to: '/vault', label: 'Documents', icon: <FileLock2 size={18} /> },
    { to: '/essays', label: 'Essays', icon: <BookOpen size={18} /> },
    { to: '/referees', label: 'Referees', icon: <Users size={18} /> },
    { to: '/stats', label: 'Insights', icon: <BarChart3 size={18} /> },
    { to: '/counsellor', label: 'Counsellor view', icon: <GraduationCap size={18} /> },
    { to: '/settings', label: 'Settings', icon: <Cog size={18} /> },
  ]
  const item = (l: { to: string; label: string; icon: React.ReactNode; end?: boolean; badge?: number }) => (
    <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? 'active' : '')}>
      {l.icon}<span>{l.label}</span>{!!l.badge && <span className="badge">{l.badge}</span>}
    </NavLink>
  )

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><img src="/icon.svg" alt="" />Trackr</div>
        <button className="btn primary block" onClick={() => openAdd()} style={{ marginBottom: 10 }}><Plus size={16} /> Add opportunity</button>
        <nav className="nav" aria-label="Main">
          {links.map(item)}
          {discover.map(item)}
          <div className="sep" />
          {tools.map(item)}
        </nav>
      </aside>
      <main className="main">
        <Suspense fallback={<ScreenSkeleton />}>
        <div className="page" key={loc.pathname}>
        <Routes location={loc}>
          <Route path="/" element={<Home />} />
          <Route path="/app/:id" element={<Detail />} />
          <Route path="/week" element={<Week />} />
          <Route path="/review" element={<Review />} />
          <Route path="/share" element={<SharePage />} />
          <Route path="/s/:token" element={<Shared />} />
          <Route path="/vault" element={<Vault />} />
          <Route path="/essays" element={<Essays />} />
          <Route path="/referees" element={<Referees />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/trending" element={<Trending />} />
          <Route path="/counsellor" element={<Counsellor />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/more" element={<More />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<Home />} />
        </Routes>
        </div>
        </Suspense>
      </main>
      <nav className="tabbar" aria-label="Main">
        {links.map(item)}
        <NavLink to="/more" className={({ isActive }) => (isActive ? 'active' : '')}><MoreHorizontal size={18} /><span>More</span></NavLink>
      </nav>
      <button className="btn primary lg fab" onClick={() => openAdd()} aria-label="Add opportunity"><Plus size={18} /> Add</button>
      <AddSheet />
      <ToastHost />
    </div>
  )
}
