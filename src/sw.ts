/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
declare const self: ServiceWorkerGlobalScope
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/\/share-target$/] }))
self.addEventListener('message', (e) => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting() })
self.addEventListener('fetch', (e: FetchEvent) => {
  const url = new URL(e.request.url)
  if (e.request.method === 'POST' && url.pathname === new URL('share-target', self.registration.scope).pathname) {
    e.respondWith((async () => {
      const fd = await e.request.formData()
      const f = fd.get('image') as File | null
      if (f) { const c = await caches.open('local-editor-share'); await c.put(new URL('shared-image', self.registration.scope).href, new Response(f, { headers: { 'Content-Type': f.type, 'X-Name': encodeURIComponent(f.name) } })) }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303)
    })())
  }
})

// Runtime cache (not precached): AI worker chunk, ONNX Runtime wasm (same-origin or jsDelivr). Models are cached by the worker itself.
const RT = 'local-editor-runtime'
self.addEventListener('fetch', (e: FetchEvent) => {
  if (e.request.method !== 'GET') return
  const u = new URL(e.request.url)
  const same = u.origin === self.location.origin && /\/assets\/.*(ai\.worker|ort|\.wasm)/.test(u.pathname)
  if (!same && u.hostname !== 'cdn.jsdelivr.net') return
  e.respondWith((async () => {
    const c = await caches.open(RT), hit = await c.match(e.request)
    if (hit) return hit
    const r = await fetch(e.request)
    if (r.ok) c.put(e.request, r.clone())
    return r
  })())
})
