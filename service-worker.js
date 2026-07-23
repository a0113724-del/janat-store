const CACHE_NAME = "janat-store-cache-v1";
const CORE_ASSETS = [
  "./index.html",
  "./products.json",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// Cache the core files so the app shell still opens (with last-known data)
// even with no internet connection.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Network-first for HTML/JSON so prices & products stay fresh when online,
// falling back to cache when offline. Cache-first for images/fonts.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const isDataOrPage = req.destination === "document" || req.url.endsWith(".json");

  if (isDataOrPage) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match(req))
    );
  } else {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
  }
});
