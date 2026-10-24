const CACHE = "qrdrop-optical-v2";
const CORE = ["./", "./index.html", "./style.css", "./app.js", "./qrcode.min.js", "./manifest.webmanifest"];
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // All runtime dependencies are same-origin assets; there is no CDN request.
    await cache.addAll(CORE);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request, {ignoreSearch:true});
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response && response.ok) {
        try { await cache.put(event.request, response.clone()); } catch {}
      }
      return response;
    } catch {
      return new Response("Offline resource unavailable. Reconnect once to load QRDrop, then retry.", {status:503, headers:{"Content-Type":"text/plain; charset=utf-8"}});
    }
  })());
});
