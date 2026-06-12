// =============================================================
// The Amateurs — push sender (runs inside GitHub Actions)
// -------------------------------------------------------------
// 1. Reads the `notifications` queue from Firestore
// 2. Finds anything with status "scheduled" whose sendAt time
//    has arrived
// 3. Sends it to every device token in `pushTokens` via Firebase
//    Cloud Messaging
// 4. Marks the notification "sent" and cleans up dead tokens
//
// Auth: the FIREBASE_SERVICE_ACCOUNT env var holds a service
// account JSON key (a GitHub Actions secret). The admin SDK
// bypasses Firestore security rules, which is why phones can't
// read each other's tokens but this script can.
// =============================================================

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const APP_URL = "https://dillonmccallum1-del.github.io/the-amateurs/";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error("Missing FIREBASE_SERVICE_ACCOUNT secret — see PUSH_SETUP.md step 2.");
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();
const messaging = getMessaging();

const nowMs = Date.now();

// ----- 1. Find due notifications
const queue = await db.collection("notifications")
  .where("status", "==", "scheduled")
  .get();

const due = queue.docs.filter(d => {
  const t = d.get("sendAt");
  return t && t.toMillis() <= nowMs;
});

if (due.length === 0) {
  console.log("Nothing due. ✅");
  process.exit(0);
}
console.log(`${due.length} notification(s) due.`);

// ----- 2. Claim them first (so an overlapping run can't double-send)
const claimed = [];
for (const d of due) {
  try {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(d.ref);
      if (fresh.get("status") !== "scheduled") throw new Error("already claimed");
      tx.update(d.ref, { status: "sending" });
    });
    claimed.push(d);
  } catch {
    console.log(`Skipping ${d.id} — already being handled by another run.`);
  }
}

if (claimed.length === 0) process.exit(0);

// ----- 3. Load every subscribed device token
const tokenSnap = await db.collection("pushTokens").get();
const tokens = tokenSnap.docs.map(t => t.id);
console.log(`${tokens.length} device token(s) on file.`);

// ----- 4. Send each claimed notification
for (const d of claimed) {
  const title = d.get("title") || "The Amateurs";
  const body  = d.get("body")  || "";

  if (tokens.length === 0) {
    await d.ref.update({ status: "sent", sentAt: Timestamp.now(), successCount: 0, failureCount: 0 });
    console.log(`"${title}" — no subscribers yet, marked sent.`);
    continue;
  }

  // FCM allows up to 500 tokens per multicast call.
  let success = 0, failure = 0;
  const dead = new Set();
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const res = await messaging.sendEachForMulticast({
      tokens: batch,
      notification: { title, body },
      webpush: {
        headers: { Urgency: "high", TTL: "86400" },
        fcmOptions: { link: APP_URL }
      }
    });
    success += res.successCount;
    failure += res.failureCount;
    res.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error?.code || "";
        // Token no longer valid (app uninstalled, permission revoked…)
        if (code.includes("registration-token-not-registered") ||
            code.includes("invalid-argument")) {
          dead.add(batch[idx]);
        } else {
          console.warn(`Send error for one device: ${code}`);
        }
      }
    });
  }

  await d.ref.update({
    status: "sent",
    sentAt: Timestamp.now(),
    successCount: success,
    failureCount: failure
  });
  console.log(`"${title}" → delivered to ${success}, failed ${failure}.`);

  // ----- 5. Prune dead tokens so future sends stay clean
  for (const t of dead) {
    await db.collection("pushTokens").doc(t).delete().catch(() => {});
  }
  if (dead.size) console.log(`Pruned ${dead.size} dead token(s).`);
}

console.log("Done. ✅");
