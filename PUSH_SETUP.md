# Push Notifications — One-Time Setup

Everything is built and free. You just need to connect three keys (about 15 minutes), then push to GitHub.

## How it works (30-second version)

When family taps **Enable notifications** on the Home page, their phone gets a unique "device token" that's saved to Firestore. When you compose a notification on the Commissioner page, it's saved to a `notifications` queue in Firestore. A free GitHub robot (a "GitHub Action" in your repo) checks that queue every 5 minutes and delivers anything due via Firebase Cloud Messaging. **Send now** also pokes the robot directly so it fires within seconds.

```
Phone taps Enable  ──►  token saved in Firestore (pushTokens)
Admin hits Send    ──►  message queued in Firestore (notifications)
GitHub Action      ──►  reads queue + tokens ──► Firebase ──► 📳 phones
```

---

## Step 1 — VAPID key (lets phones subscribe)

1. Go to [Firebase Console](https://console.firebase.google.com) → **the-amateurs-app** → ⚙️ **Project settings** → **Cloud Messaging** tab.
2. Scroll to **Web configuration** → **Web Push certificates** → click **Generate key pair**.
3. Copy the long key (starts with `B...`).
4. Open `js/push.js` and replace `PASTE_YOUR_VAPID_KEY_HERE` with it.

## Step 2 — Service account key (lets the GitHub robot send)

1. Firebase Console → ⚙️ **Project settings** → **Service accounts** tab → **Generate new private key** → a `.json` file downloads.
2. Open that file in a text editor and copy **all** of its contents.
3. Go to your repo on GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
4. Name: `FIREBASE_SERVICE_ACCOUNT` — Value: paste the whole JSON. Save.
5. Delete the downloaded `.json` file (it's a master key — never commit it).

## Step 3 — GitHub token (makes "Send now" instant — optional but worth it)

Without this, sends still work; they just wait for the robot's 5-minute timer.

1. GitHub → click your avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Name it `amateurs-push`, set expiration past tournament day.
3. **Repository access**: Only select repositories → `the-amateurs`.
4. **Permissions** → Repository permissions → **Actions: Read and write**. Generate and copy the token.
5. Sign in to the **Commissioner page** of the app → **Push Notifications** card → paste the token in the GitHub token box → **Save token**. (It's stored in Firestore, readable only by commissioners.)

## Step 4 — Firestore security rules

Firebase Console → **Firestore Database** → **Rules**. Add these blocks **inside** your existing `match /databases/{database}/documents { ... }`, alongside your other rules, then **Publish**:

```
// Phones may register their own push token; only commissioners may list them.
match /pushTokens/{token} {
  allow create, update: if true;
  allow read, delete: if request.auth != null &&
    exists(/databases/$(database)/documents/admins/$(request.auth.uid));
}

// Notification queue — commissioners only.
match /notifications/{id} {
  allow read, write: if request.auth != null &&
    exists(/databases/$(database)/documents/admins/$(request.auth.uid));
}

// Saved GitHub token — commissioners only.
match /config/github {
  allow read, write: if request.auth != null &&
    exists(/databases/$(database)/documents/admins/$(request.auth.uid));
}
```

## Step 5 — Push to GitHub

Commit and push everything (the new workflow only activates once it's on the `main` branch). Then check the repo's **Actions** tab — if GitHub asks you to enable workflows, click enable.

---

## Getting phones subscribed

- **iPhone** (iOS 16.4 or newer): open the site in Safari → **Share** → **Add to Home Screen** → open the installed app → tap **Enable notifications** on the Home page. Push does *not* work in plain Safari — only from the installed app.
- **Android**: works in Chrome directly or installed; tap **Enable notifications**.

## Good to know

- **Scheduled sends** fire on the robot's next 5-minute check after the chosen time — so "7:00 PM" really means "7:00–7:08ish". Plenty precise for tee-time announcements.
- GitHub pauses the timer if the repo has **no commits for 60 days**. Any push re-enables it (or the Actions tab → Enable). Fine for tournament week; just remember next year.
- To test end-to-end: subscribe your own phone, then send yourself a "Test 🏌️" from the Commissioner page.
- The **Queue & history** list on the Commissioner page shows scheduled sends (with a Cancel button) and delivery counts for sent ones.
