// =============================================================
// The Amateurs — Firebase connection + helpers
// -------------------------------------------------------------
// This module is the single source of truth for talking to
// Firebase. Every page that needs live data or admin actions
// imports from here.
//
// NOTE on the config below: Firebase web config values are
// considered PUBLIC. They identify your project, but they do
// not grant access on their own. Protection comes from:
//   1. Firebase Authentication (who is signed in)
//   2. Firestore Security Rules (what they can read/write)
// So it is safe to commit this file to GitHub.
// =============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// -------------------------------------------------------------
// 1. CONFIG — replace the placeholder values below with the
//    real ones from your Firebase project settings.
//    (Firebase Console → Project Settings → General → Your apps
//     → Web app → "SDK setup and configuration" → "Config")
// -------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyA_9Z6B31mIo2eDNJxO_RRZiiBHPjSOFtk",
  authDomain: "the-amateurs-app.firebaseapp.com",
  projectId: "the-amateurs-app",
  storageBucket: "the-amateurs-app.firebasestorage.app",
  messagingSenderId: "1028630250964",
  appId: "1:1028630250964:web:ccafee517e9ff1866d4241",
  measurementId: "G-9RSYBEDFZC"
};

// -------------------------------------------------------------
// 2. INITIALIZE
// -------------------------------------------------------------
const app     = initializeApp(firebaseConfig);
const auth    = getAuth(app);
const db      = getFirestore(app);
const storage = getStorage(app);

// -------------------------------------------------------------
// 3. AUTH HELPERS
// -------------------------------------------------------------

/** Sign in with email + password. Returns the User on success. */
export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/** Sign the current user out. */
export async function signOutNow() {
  await signOut(auth);
}

/** Subscribe to auth changes. callback(user|null) fires immediately
 *  with the current state and again on every sign-in/sign-out. */
export function onAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

/** Is the signed-in user an admin?
 *  Admins are users whose UID has a doc in the `admins` collection. */
export async function isAdmin(user) {
  if (!user) return false;
  const snap = await getDoc(doc(db, "admins", user.uid));
  return snap.exists();
}

// -------------------------------------------------------------
// 4. EVENT CONFIG — single doc at  event/current
//    Holds tournament-wide state: year, status, par per hole,
//    whether the leaderboard is publicly visible, etc.
// -------------------------------------------------------------

/** Listen for live changes to the event config doc. */
export function onEventConfig(callback) {
  return onSnapshot(doc(db, "event", "current"), (snap) => {
    callback(snap.exists() ? snap.data() : null);
  });
}

/** One-shot read of event config. */
export async function getEventConfig() {
  const snap = await getDoc(doc(db, "event", "current"));
  return snap.exists() ? snap.data() : null;
}

/** Admin: update event config (merges with existing fields). */
export async function updateEventConfig(patch) {
  await setDoc(
    doc(db, "event", "current"),
    { ...patch, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// -------------------------------------------------------------
// 5. TEAMS — collection `teams`, one doc per team.
//    Doc shape:
//    {
//      name:        "Team Birdie Hunters",
//      captain:     "Dillon McCallum",
//      partner:     "Andrea McCallum",
//      draftPick:   1,                   // 1 = first picked
//      strokes:     [3,3,2,null,...],    // length = numHoles
//      bonusPoints: [{ label, points }],
//      updatedAt:   <serverTimestamp>
//    }
// -------------------------------------------------------------

/** Listen for live changes to the teams list (ordered by draft pick). */
export function onTeams(callback) {
  const q = query(collection(db, "teams"), orderBy("draftPick", "asc"));
  return onSnapshot(q, (snap) => {
    const teams = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(teams);
  });
}

/** Admin: create or replace a team doc. id is your choice
 *  (e.g. "team-a"). */
export async function saveTeam(id, data) {
  await setDoc(
    doc(db, "teams", id),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/** Admin: delete a team doc entirely. */
export async function deleteTeam(id) {
  await deleteDoc(doc(db, "teams", id));
}

/** Admin: upload a team logo image. `file` is a File from an <input type=file>.
 *  Stored at  team-logos/<teamId>.<ext>  and the resulting download URL is
 *  written back onto the team doc as `logoUrl`. Returns the URL. */
export async function uploadTeamLogo(teamId, file) {
  if (!file) throw new Error("No file provided");
  if (!file.type || !file.type.startsWith("image/")) {
    throw new Error("File must be an image (PNG, JPG, etc).");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Image too large — keep it under 5 MB.");
  }
  // Strip extension out of original filename to keep storage paths predictable.
  const extMatch = file.name.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : "png";
  const path = `team-logos/${teamId}.${ext}`;
  const ref = storageRef(storage, path);
  await uploadBytes(ref, file, { contentType: file.type });
  const url = await getDownloadURL(ref);
  await updateDoc(doc(db, "teams", teamId), {
    logoUrl: url,
    logoPath: path,
    updatedAt: serverTimestamp()
  });
  return url;
}

/** Admin: remove a team's logo (clears the URL and deletes the stored file). */
export async function removeTeamLogo(teamId, logoPath) {
  if (logoPath) {
    try { await deleteObject(storageRef(storage, logoPath)); } catch (_) { /* file may already be gone */ }
  }
  await updateDoc(doc(db, "teams", teamId), {
    logoUrl: null,
    logoPath: null,
    updatedAt: serverTimestamp()
  });
}

/** Admin: update one hole's strokes for a team.
 *  We store the whole strokes array on the doc; pass the new array. */
export async function setTeamStrokes(teamId, strokesArray) {
  await updateDoc(doc(db, "teams", teamId), {
    strokes: strokesArray,
    updatedAt: serverTimestamp()
  });
}

/** Admin: update bonus points for a team. */
export async function setTeamBonus(teamId, bonusArray) {
  await updateDoc(doc(db, "teams", teamId), {
    bonusPoints: bonusArray,
    updatedAt: serverTimestamp()
  });
}

/** Record (or clear) a team's hole-5 "longest throw-in" answer.
 *  Stored on the team doc as a nested `farthestThrow` object so it
 *  rides along with the rest of the team data and we don't need a
 *  separate collection. The Farthest Throw leaderboard sorts by the
 *  `submittedAt` server timestamp inside this object so the newest
 *  submission naturally bumps everyone else down a spot.
 *
 *  payload shape:
 *    { thrownFarther: true,  thrower: "Dillon McCallum" }  → adds/updates the entry
 *    { thrownFarther: false }                              → marks them out of the running
 *    null                                                  → clears the entry entirely
 */
export async function setTeamFarthestThrow(teamId, payload) {
  if (payload === null) {
    await setDoc(
      doc(db, "teams", teamId),
      { farthestThrow: null, updatedAt: serverTimestamp() },
      { merge: true }
    );
    return;
  }
  const data = {
    thrownFarther: payload.thrownFarther === true,
    thrower: payload.thrownFarther === true ? (payload.thrower || null) : null,
    submittedAt: serverTimestamp()
  };
  await setDoc(
    doc(db, "teams", teamId),
    { farthestThrow: data, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/** Record (or clear) a team's hole-8 "closest to the pin" answer.
 *  Same shape as setTeamFarthestThrow but with an `inches` measurement
 *  the captain types in when they beat the current marker. The Closest
 *  to the Pin leaderboard sorts by `submittedAt` desc so the newest
 *  beat-the-marker submission bumps everyone else down.
 *
 *  payload shape:
 *    { closerThanMarker: true,  player: "Dillon McCallum", inches: 24 }
 *    { closerThanMarker: false }                                          → out of the running
 *    null                                                                 → clears the entry entirely
 */
export async function setTeamClosestToPin(teamId, payload) {
  if (payload === null) {
    await setDoc(
      doc(db, "teams", teamId),
      { closestToPin: null, updatedAt: serverTimestamp() },
      { merge: true }
    );
    return;
  }
  const yes = payload.closerThanMarker === true;
  // Inches: accept either a number-typed value or a string. Round to one
  // decimal place so the leaderboard doesn't show ugly float noise.
  let inches = null;
  if (yes) {
    const raw = (typeof payload.inches === "string")
      ? payload.inches.trim()
      : payload.inches;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) inches = Math.round(n * 10) / 10;
  }
  const data = {
    closerThanMarker: yes,
    player:  yes ? (payload.player || null) : null,
    inches:  yes ? inches : null,
    submittedAt: serverTimestamp()
  };
  await setDoc(
    doc(db, "teams", teamId),
    { closestToPin: data, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// -------------------------------------------------------------
// 6. SCORING MATH — modified Stableford, high score wins.
//    Default points (matches rules.html intent — confirm with
//    Dillon if values need tweaking):
//      eagle or better : +8
//      birdie          : +5
//      par             : +2
//      bogey           : +1
//      double+         :  0
// -------------------------------------------------------------
export const STABLEFORD_POINTS = {
  eaglePlus: 8,
  birdie:    5,
  par:       2,
  bogey:     1,
  doublePlus: 0
};

export function pointsForHole(strokes, par) {
  if (strokes == null || par == null) return null;
  const diff = strokes - par;
  if (diff <= -2) return STABLEFORD_POINTS.eaglePlus;
  if (diff === -1) return STABLEFORD_POINTS.birdie;
  if (diff === 0)  return STABLEFORD_POINTS.par;
  if (diff === 1)  return STABLEFORD_POINTS.bogey;
  return STABLEFORD_POINTS.doublePlus;
}

/** Compute team totals from raw strokes + course par + bonuses. */
export function computeTeamTotals(team, coursePar) {
  const strokes = team.strokes || [];
  const bonuses = team.bonusPoints || [];
  let totalPoints = 0;
  let holesCompleted = 0;
  const perHolePoints = strokes.map((s, i) => {
    const pts = pointsForHole(s, coursePar[i]);
    if (pts != null) {
      totalPoints += pts;
      holesCompleted += 1;
    }
    return pts;
  });
  const bonusTotal = bonuses.reduce((sum, b) => sum + (b.points || 0), 0);
  return {
    perHolePoints,
    holePointsTotal: totalPoints,
    bonusTotal,
    totalPoints: totalPoints + bonusTotal,
    holesCompleted
  };
}

// -------------------------------------------------------------
// 7. RE-EXPORTS — pages can grab these if they need lower-level
//    Firestore access without re-importing the SDK.
// -------------------------------------------------------------
export { auth, db };
