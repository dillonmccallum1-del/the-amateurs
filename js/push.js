// =============================================================
// The Amateurs — Push notification subscription
// -------------------------------------------------------------
// Runs on the phone. When someone taps "Enable notifications",
// this module:
//   1. Asks the browser for notification permission
//   2. Gets a unique "device token" from Firebase Cloud Messaging
//   3. Saves that token to Firestore (collection: pushTokens)
// The GitHub Action later reads every saved token and sends the
// notification to each device.
//
// ONE-TIME SETUP (see PUSH_SETUP.md):
//   Paste your Web Push certificate key (VAPID key) below. Get it
//   from Firebase Console → Project settings → Cloud Messaging →
//   Web Push certificates → Generate key pair.
// =============================================================

import { db } from "./firebase-init.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getMessaging,
  getToken,
  isSupported
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ⬇️ PASTE YOUR VAPID KEY HERE (long string starting with "B...")
const VAPID_KEY = "PASTE_YOUR_VAPID_KEY_HERE";

/** What can this device do right now?
 *  Returns one of:
 *   "unsupported"     — browser can't do web push at all
 *   "needs-install"   — iPhone/iPad browsing in Safari: must Add to
 *                       Home Screen first (iOS only allows push for
 *                       installed web apps, iOS 16.4+)
 *   "denied"          — user previously blocked notifications
 *   "granted"         — already allowed
 *   "ready"           — supported, just needs the user to tap Enable
 */
export async function pushStatus() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
  if (isIOS && !standalone) return "needs-install";
  if (!("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window)) {
    return "unsupported";
  }
  if (!(await isSupported().catch(() => false))) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted") return "granted";
  return "ready";
}

/** Ask permission, get the FCM device token, save it to Firestore.
 *  Must be called from a user tap (browsers require a gesture).
 *  Returns the token string. Throws with a friendly message on failure. */
export async function enablePush() {
  if (!VAPID_KEY || VAPID_KEY.startsWith("PASTE")) {
    throw new Error("Push isn't configured yet — the VAPID key is missing in js/push.js.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications were not allowed. You can change this in your phone's settings.");
  }

  // Reuse the app's existing service worker registration.
  const reg = await navigator.serviceWorker.ready;

  const messaging = getMessaging(getApp());
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: reg
  });
  if (!token) throw new Error("Couldn't get a push token — try again in a moment.");

  // Save the token. Doc ID = the token itself, so re-subscribing the
  // same phone just refreshes the existing doc (no duplicates).
  await setDoc(doc(db, "pushTokens", token), {
    createdAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
    userAgent: navigator.userAgent.slice(0, 200)
  }, { merge: true });

  return token;
}

/** Call on page load when permission is already granted: silently
 *  refreshes the token in Firestore (tokens can rotate over time). */
export async function refreshPushToken() {
  try {
    if ((await pushStatus()) !== "granted") return;
    await enablePush();
  } catch (_) { /* silent — this is just housekeeping */ }
}
