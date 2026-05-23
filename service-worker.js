// =============================================================
// The Amateurs — Service Worker
// -------------------------------------------------------------
// Strategy:
//   - Cache the static "app shell" (HTML, CSS, icons, JS) so the
//     app launches instantly + works briefly offline.
//   - NEVER cache Firebase/Firestore requests — those must always
//     hit the network so live scores stay fresh.
//   - Versioned cache name (CACHE_VERSION) — bump it when you ship
//     a meaningful change and the next page load wipes the old
//     cache automatically. Users don't have to do anything.
// =============================================================

const CACHE_VERSION = "amateurs-v4";  // ← bump on every meaningful release
const SHELL_FILES = [
  "./",
  "./index.html",
  "./Pages/about.html",
  "./Pages/rules.html",
  "./Pages/leaderboard.html",
  "./Pages/draft.html",
  "./Pages/history.html",
  "./Pages/admin.html",
  "./Pages/styles.css",
  "./js/firebase-init.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.png"
];

// ----- Install: pre-cache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting(); // activate new SW immediately on next load
});

// ----- Activate: wipe old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ----- Fetch handler
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1. Never touch Firebase/Firestore/Auth requests — go straight to network.
  if (
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("identitytoolkit.googleapis.com") ||
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("gstatic.com")
  ) {
    return; // let browser handle natively
  }

  // 2. For navigations (HTML pages): network-first so updates are picked up,
  //    cache fallback for offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
    );
    return;
  }

  // 3. For everything else (CSS, JS, icons, fonts): cache-first.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then(res => {
        // Only cache successful, same-origin or known-CDN responses.
        if (!res || res.status !== 200) return res;
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy));
        return res;
      }).catch(() => cached);
    })
  );
});
