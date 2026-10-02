// Minimal app-shell service worker (docs/04: no data in the device cache).
// - Caches ONLY the static app shell: the navigation page and hashed build assets (js, css, fonts).
// - NEVER touches /api/*: data responses go straight to the network and are never stored, so private
//   records do not linger in a device cache.
// - Offline: a page navigation falls back to the cached shell; the app then queues entries itself (IndexedDB).
const CACHE = "yj-shell-v1";
const SHELL_KEY = "/__shell";
const STATIC_PREFIXES = ["/assets/", "/fonts/"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return; // never cached

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok && res.type === "basic") {
            const cache = await caches.open(CACHE);
            await cache.put(SHELL_KEY, res.clone());
          }
          return res;
        } catch {
          const cached = await (await caches.open(CACHE)).match(SHELL_KEY);
          if (cached) return cached;
          throw new Error("offline");
        }
      })(),
    );
    return;
  }

  if (STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === "basic") await cache.put(req, res.clone());
        return res;
      })(),
    );
  }
});
