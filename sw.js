/* ---------------------------------------------------------------
   sw.js — the service worker.

   Caches the app itself so it opens instantly and works offline.
   Your papers and notes are NOT here — those live in IndexedDB and
   your sync folder, which need no help from this file.

   Bump CACHE_VERSION whenever you change any app file, or browsers
   will keep serving the old one.
   --------------------------------------------------------------- */

const CACHE_VERSION = "marginalia-v4";

/* Only the entry point is precached. Everything else is fetched on
   demand with a ?v= query string, which is what actually forces a
   refresh: a changed query means a different URL, so no browser and
   no cache anywhere can hand back the old file. Bump the version in
   index.html when you change something and the problem cannot
   happen. */
const SHELL = [
  "./",
  "./index.html",
  "./icon.svg",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // never touch API calls — they must always go to the network
  if (url.hostname === "api.anthropic.com") return;
  if (event.request.method !== "GET") return;

  // PDF.js from the CDN: cache it the first time, then serve locally
  if (url.hostname === "cdnjs.cloudflare.com") {
    event.respondWith(
      caches.match(event.request).then((hit) =>
        hit || fetch(event.request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
      )
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  /* Network first, cache as the fallback. The other way round is
     faster but means you keep seeing a stale app after every
     change, which is maddening while you're still building it. */
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only keep successful responses. Caching a 404 means the
        // browser keeps serving that 404 long after the file is
        // fixed, which is maddening and hard to diagnose.
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
