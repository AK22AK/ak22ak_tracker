const CACHE_NAME = "ak-tracker-public-v10";
const OFFLINE_SHELL_URL = "/offline.html";
const APP_SHELL = [
  OFFLINE_SHELL_URL,
  "/offline.css",
  "/offline-contract.js",
  "/offline.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("ak-tracker-") && key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const offlineShell = await caches.match(OFFLINE_SHELL_URL);
        if (offlineShell) return offlineShell;
        return new Response("Offline shell unavailable", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }),
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) return;

  const isPublicAsset =
    url.pathname === OFFLINE_SHELL_URL ||
    url.pathname === "/offline.css" ||
    url.pathname === "/offline-contract.js" ||
    url.pathname === "/offline.js" ||
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest";
  if (
    isPublicAsset &&
    ["style", "script", "font", "image", "manifest"].includes(
      request.destination,
    )
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
