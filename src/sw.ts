/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL, cleanupOutdatedCaches } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { get as idbGet, set as idbSet } from 'idb-keyval'
import { dueReminders } from './lib/reminders'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/share-target/] }))

self.addEventListener('install', () => { void self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

// Web Share Target: other apps (WhatsApp, X, LinkedIn, Chrome...) POST here. We stash any shared
// images in a cache and redirect to the /share route, which hands everything to the parser.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith((async () => {
      try {
        const form = await event.request.formData()
        const params = new URLSearchParams()
        for (const key of ['title', 'text', 'url']) {
          const v = form.get(key)
          if (typeof v === 'string' && v) params.set(key, v)
        }
        const files = form.getAll('media').filter((f): f is File => typeof f !== 'string')
        if (files.length) {
          const cache = await caches.open('trackr-shared')
          await Promise.all(files.map((f, i) => cache.put('/shared-media/' + i, new Response(f, { headers: { 'Content-Type': f.type || 'image/jpeg' } }))))
          params.set('media', String(files.length))
        }
        return Response.redirect('/share?' + params.toString(), 303)
      } catch {
        return Response.redirect('/share', 303)
      }
    })())
  }
})

// ---- Reminders
// Tapping a notification opens that application.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && (event.notification.data as { url?: string }).url) || '/'
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const win = wins[0] as WindowClient | undefined
    if (win) { try { await win.navigate(target) } catch { /* cross-scope */ } return win.focus() }
    return self.clients.openWindow(target)
  })())
})

// Where the browser allows it (installed app on Android Chrome), check deadlines about twice a day
// even when Trackr is closed. Everything is read from this device; nothing is sent anywhere.
async function checkReminders() {
  const state = await idbGet<{ profile?: any; apps?: any[]; shownReminders?: string[] }>('trackr:v1')
  if (!state?.profile?.onboarded || !Array.isArray(state.apps)) return
  const already = new Set<string>([...(state.shownReminders ?? []), ...((await idbGet<string[]>('trackr:notified')) ?? [])])
  const due = dueReminders(state.apps, state.profile).filter((r) => !already.has(r.id)).slice(0, 4)
  if (!due.length) return
  await Promise.all(due.map((r) => self.registration.showNotification(r.title, { body: r.text, tag: r.id, icon: '/icon-192.png', data: { url: `/app/${r.appId}` } })))
  await idbSet('trackr:notified', [...already, ...due.map((r) => r.id)].slice(-500))
}
self.addEventListener('periodicsync', ((event: ExtendableEvent & { tag?: string }) => {
  if (event.tag === 'trackr-reminders') event.waitUntil(checkReminders().catch(() => undefined))
}) as EventListener)
