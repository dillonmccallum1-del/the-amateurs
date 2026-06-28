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

const CACHE_VERSION = "amateurs-v8.16.0";  // ← bump on every meaningful release
const SHELL_FILES = [
  "./",
  "./index.html",
  "./Pages/about.html",
  "./Pages/rules.html",
  "./Pages/leaderboard.html",
  "./Pages/draft.html",
  "./Pages/history.html",
  "./Pages/admin.html",
  "./Pages/archive.html",
  "./Pages/styles.css",
  "./js/firebase-init.js",
  "./js/push.js",
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

// =============================================================
// PUSH NOTIFICATIONS
// -------------------------------------------------------------
// A push message arrives here even when the app is closed.
// The GitHub Action sends it through Firebase Cloud Messaging;
// the payload looks like { notification: {title, body}, data: {...} }.
// We MUST show a notification for every push (browsers require it).
// =============================================================
self.addEventListener("push", (event) => {
  let title = "The Amateurs";
  let body  = "";
  let url   = "./index.html";
  try {
    const payload = event.data ? event.data.json() : {};
    const n = payload.notification || {};
    const d = payload.data || {};
    title = n.title || d.title || title;
    body  = n.body  || d.body  || "";
    url   = (payload.fcmOptions && payload.fcmOptions.link) || d.url || url;
  } catch (_) {
    body = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:  "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      data:  { url }
    })
  );
});

// Tapping the notification opens (or focuses) the app.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./index.html";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) return w.focus();
      }
      return clients.openWindow(url);
    })
  );
});
