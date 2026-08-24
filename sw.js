/*
  THE ROOM — service worker.

  Precaches the app shell (room HTML + shared CSS/JS) on install, then
  runs a network-first strategy for everything same-origin: try the
  network so you always get the latest version while online, fall back
  to whatever's cached when you're not. Every successful same-origin GET
  gets cached opportunistically, so a room's data (curriculum JSON,
  prayer content, audio, worksheets, travel-world destinations, the
  Video Log's published snapshot) becomes available offline the first
  time you actually open it -- nothing is bulk-precached beyond the
  shell, since some of that (audio in particular) is large and
  shouldn't be forced onto every device on install.

  Deliberately untouched: any non-GET request (form posts, OAuth token
  exchanges) and any cross-origin request (Spotify, Anthropic, GitHub
  APIs) -- those pass straight through to the network, never cached.

  Bump CACHE_VERSION when the app-shell file list changes; the old
  caches get swept on the next activate.
*/
const CACHE_VERSION = "the-room-v1";
const SHELL_CACHE = CACHE_VERSION + "-shell";
const RUNTIME_CACHE = CACHE_VERSION + "-runtime";

const APP_SHELL = [
  "home.html",
  "room.html",
  "language-hub.html",
  "finance-hub.html",
  "knowledge-center.html",
  "content-hub.html",
  "beat-maker.html",
  "nest-of-knowledge.html",
  "the-archive.html",
  "video-log/index.html",
  "video-log/editor.html",
  "travel-world/index.html",
  "travel-world/app.js",
  "travel-world/style.css",
  "design-system/tokens.css",
  "design-system/patterns.css",
  "design-system/utils.js",
  "manifest.json",
  "icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") {
          const shellFallback = await caches.match("home.html");
          if (shellFallback) return shellFallback;
        }
        return new Response("Offline, and this hasn't been cached yet -- open it once while online first.", {
          status: 503,
          statusText: "Offline",
          headers: { "Content-Type": "text/plain" },
        });
      })
  );
});
