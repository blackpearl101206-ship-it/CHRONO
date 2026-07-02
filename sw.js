/* Chrono · basic offline service worker */
const CACHE = "chrono-v2-1";
const ASSETS = [
  "Chrono App.html",
  "daily-schedule.css",
  "chrono-app.css",
  "chrono-alarm.js",
  "chrono-app.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        // Stash a copy for next time
        if (res.ok && new URL(req.url).origin === location.origin) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
