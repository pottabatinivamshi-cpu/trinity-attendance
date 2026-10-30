// Offline support: keeps a copy of the site's own files so it opens with no network.
// The lists themselves are kept by the page (see app.js), not here.
const CACHE = "trinity-shell-v1";
const SHELL = [
  "./", "index.html", "style.css", "config.js",
  "js/common.js", "js/letter.js", "js/app.js", "js/records.js", "js/timing.js",
  "vendor/jspdf.umd.min.js", "vendor/jspdf.plugin.autotable.min.js", "vendor/qrcode.js",
  "logo.png", "letterhead.jpg", "favicon.png", "icon-180.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Keep one copy per file: drop older versions (other ?v=) of the same path.
async function keep(cache, req, res) {
  const path = new URL(req.url).pathname;
  for (const k of await cache.keys()) if (new URL(k.url).pathname === path && k.url !== req.url) await cache.delete(k);
  await cache.put(req, res);
}

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const own = url.origin === location.origin;
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!own && !fonts) return; // the database and everything else go straight to the network

  // Pages: try the network first so updates show up, fall back to the saved copy.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) keep(cache, new Request(url.origin + url.pathname), res.clone());
        return res;
      } catch (err) {
        return (await cache.match(url.origin + url.pathname)) || (await cache.match(req, { ignoreSearch: true })) || (await cache.match("index.html")) || Response.error();
      }
    })());
    return;
  }

  // Files: the exact version if saved, otherwise the network, otherwise any saved version.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") keep(cache, req, res.clone());
      return res;
    } catch (err) {
      return (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
