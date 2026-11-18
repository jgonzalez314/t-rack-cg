// Service worker: keeps a copy of the app's pages and files so it opens and
// works with no connection. Data lives in browser storage (see
// src/lib/data), so only the app itself needs caching here.

const CACHE = "t-rack-cg-v1";
const PAGES = ["/", "/folder"];

// Saves a page and the scripts and styles it loads.
async function cachePage(cache, path) {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok || res.redirected) return;
  await cache.put(path, res.clone());
  const html = await res.text();
  const assets = new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []);
  await Promise.all(
    [...assets].map((url) => cache.add(url).catch(() => {})),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all([
          ...PAGES.map((p) => cachePage(cache, p).catch(() => {})),
          cache.addAll(["/manifest.webmanifest", "/icons/icon-192.png"]).catch(() => {}),
        ]),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Pages: use the network, fall back to the saved copy when offline.
  // /folder?id=… is one page for every folder, so the query is ignored.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected && PAGES.includes(url.pathname)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(url.pathname)) ||
            (await cache.match("/")) ||
            new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
          );
        }),
    );
    return;
  }

  // Build files have a hash in their name, so a saved copy never goes stale.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Icons and the manifest: saved copy first, refreshed in the background.
  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.match(req).then((hit) => {
        const update = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => hit);
        return hit || update;
      }),
    );
  }
});
