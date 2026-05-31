# The Amateurs — Update Workflow

How to make changes safely, test them, and ship them — without ever breaking the
live app while people are using it.

---

## The mental model

You have two branches:

| Branch | What it is | Who sees it |
|--------|-----------|-------------|
| `main` | **Production.** GitHub Pages serves this. | Everyone, live at the real URL. |
| `dev`  | **Your workshop.** Make and test all changes here. | Only you, until you merge. |

Golden rule: **never edit `main` directly.** You change things on `dev`, prove
they work, then merge `dev` into `main` to go live.

---

## One-time setup (do this once)

The `dev` branch already exists locally. Push it to GitHub so it's saved there too:

```bash
cd ~/Documents/GitHub/the-amateurs
git push -u origin dev
```

That's it. From now on you just follow the loop below.

---

## The everyday loop

**1. Start work on dev**

```bash
git checkout dev
```

**2. Make your changes** — edit files however you normally do.

**3. Preview locally (no deploy, instant feedback)**

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser. Edit, refresh, repeat. Stop
the server with `Ctrl+C` when done.

> ⚠️ Local preview still reads/writes the **real Firebase data** (`the-amateurs-app`).
> Looking at pages, layouts, and new features is totally safe. But if you're testing
> the **score-entry / admin / draft** screens, anything you save goes into the live
> database. See "Testing things that write data" below.

**4. Save your work to dev**

```bash
git add -A
git commit -m "Short description of what you changed"
git push          # backs up dev to GitHub (optional but smart)
```

**5. When it's tested and you're happy — ship it**

```bash
git checkout main
git merge dev
git push          # GitHub Pages redeploys the live app within ~1 minute
git checkout dev  # hop back to the workshop for next time
```

---

## Before you ship: bump the cache version

This app is a PWA with a service worker, so phones cache the old version. If you
don't bump the version, returning visitors may keep seeing the **old app** after
you deploy.

Before merging to `main`, edit the version string in **both** of these files:

- `service-worker.js`
- `Pages/service-worker.js`

Change the line (currently `amateurs-v8.3.0`):

```js
const CACHE_VERSION = "amateurs-v8.3.0";  // ← bump this, e.g. v8.3.1
```

Bump the number every time you ship a meaningful change. Phones then auto-refresh
to the new version on their next visit — nobody has to clear anything.

---

## If something goes wrong on the live app

Don't panic-edit. Roll back to the last good version:

```bash
git checkout main
git revert HEAD     # undoes the most recent commit as a new commit
git push
```

The live app returns to how it was before, usually within a minute.

---

## Event-day rule

During the actual invitational, **freeze `main`.** Don't merge anything to it
unless you're fixing something that's actively broken. Keep tinkering on `dev`
all you want — it can't affect the live app until you merge.

---

## Optional upgrades (only if you want them)

### A. A real beta URL you can test on your phone

Desktop browsers and phone browsers behave differently, and this is a PWA, so
testing on an actual phone before launch is worthwhile. Firebase (which you already
use) can host a temporary preview:

```bash
# one-time: npm install -g firebase-tools && firebase login && firebase init hosting
firebase hosting:channel:deploy beta
```

This gives you a temporary link like `the-amateurs-app--beta-xxxx.web.app` running
your `dev` code, separate from production, that auto-expires. No second repo, no drift.

### B. Testing things that write data (admin / scoring / draft)

By default everything points at the live database, so test writes go to real data.
If you ever want to hammer on score entry without touching live scores, create a
**second Firebase project** (e.g. `the-amateurs-staging`) as a sandbox and switch
`js/firebase-init.js` to its config while testing. This is the heaviest option —
only bother if you're doing a lot of write-testing. For everyday changes, skip it.

---

## Command cheat sheet

```bash
git checkout dev                 # go to the workshop
python3 -m http.server 8000      # preview at localhost:8000
git add -A && git commit -m "…"  # save work on dev
# (bump CACHE_VERSION in both service-worker.js files)
git checkout main && git merge dev && git push   # ship to live
git checkout dev                 # back to the workshop
git revert HEAD && git push      # emergency rollback (run on main)
```
