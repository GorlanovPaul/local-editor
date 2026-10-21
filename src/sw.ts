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
