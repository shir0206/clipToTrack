# Phase 3: preference sync

**213 tests pass.** I broke the code on purpose 31 ways (each rule, guard and fallback in turn); every break is now caught by a test. Five of those first slipped through, which exposed weak tests of mine; they are fixed. Types are clean for everything I wrote.

**Not done, and why:**
- `firestore.rules` and its test file were **not run**: the Firestore emulator cannot be downloaded in my sandbox. The test file type-checks. Please run it once (see below) before relying on the rules.
- Nothing was run against real Firestore or in the running app. The multi-device behavior is tested with an in-memory "cloud" that can go offline and be switched off, not with two browsers.

## Set up (once)

1. Firebase console → **Firestore Database → Create database** (production mode, pick a region).
2. Publish the rules: `firebase deploy --only firestore:rules` (or paste `firestore.rules` into the console).
3. Optional kill switch: create the document `config/global` with `{ cloudEnabled: true }`. Set it to `false` to pause sync for everyone; the app shows "Cloud sync is paused". With no such document sync is on.
4. For the rules tests: `npm i -D @firebase/rules-unit-testing` (I needed `--legacy-peer-deps` with the Firebase version I had), add the script
   `"test:rules": "firebase emulators:exec --only firestore \"vitest run --config vitest.rules.config.ts\""`, and run `npm run test:rules`.

Everything stays on the free Spark plan. A signed-in session holds two listeners (your preferences document and the kill switch) and writes only after a 1.5 s pause, and only for fields that changed.

## Apply it

From your repo root: `patch -p1 < phase3.patch` (made against the Phase 2 result), or copy the files from this folder. `firebase.json` now also lists the Firestore rules and emulator.

## What it does

| File | Role |
|---|---|
| `lib/sync/prefSync.ts` | **The engine.** Who wins, debounced sending, echo suppression, kill switch, status |
| `lib/sync/prefAdapters.ts` | How each of the 7 preferences is read and applied; **validates and sanitizes everything coming from the cloud** |
| `lib/sync/firestorePrefs.ts`, `lib/firebase/firestore.ts` | The real Firestore backend (lazy-loaded, on-disk cache) |
| `lib/sync/useSync.ts` | Mounted once in `ClipToTrack`; connects while signed in |
| `lib/sortPref.ts` | The list sort order moved out of component state into a store, so it can sync |
| `components/Account/SyncNotice.tsx` | Toast while the kill switch is on |
| `MapPanel.tsx`, `TrackMap.tsx` | `saveOpts` now reports only **real** changes; an open map follows options that arrive from the cloud |
| `SignOutDialog.tsx`, `AccountSection.tsx` | Sign-out first lets the last change leave; honest status text in Settings |
| `firestore.rules` | Only the owner reads/writes `users/{uid}/prefs/main`; field whitelist; everything else closed |

Synced: settings (toolbar visibility), satellite default, project mode, example on/off, playback-help dismissed, map options (not the basemap), list sort order. Panel sizes, sheet position and forced layout stay on each device.

**Who wins**, per field (a value `v` and the time `t` of the person's change):
- First time this device meets the account: the cloud wins for every field it has (even over a newer guest choice, as planned); a guest's choices only fill fields the cloud lacks. A field nobody ever changed is never written, so defaults don't pollute the account.
- Afterwards: the newer `t` wins, a tie goes to the cloud. A push carries the time of the *change*, not of the push.
- A value that came from the cloud is never sent back, and a "change" to a value the cloud already has is ignored.

## Decisions (tell me if you disagree)

1. **Sign-out still does not wipe the device.** You didn't answer my question, so I followed my own suggestion: wiping waits until clips sync (Phase 4), because a signed-out person expects their clips to still be there. Settings text says: "Your settings are saved to your account. Your clips stay on this device."
2. **`saveOpts` behavior changed.** `TrackMap` calls it on every mount; reporting that as a user change would stamp "now" on the field at every page load and let a stale device overwrite newer cloud settings. It now stores and reports only when the options actually differ.
3. **The example project follows the account through `useExampleProject.setEnabled`**, so another device's "off" removes the example clips instead of only flipping a flag.
4. **The basemap is not synced** (it follows each device's satellite default); everything else about the map options is.
5. **Clock trust:** `t` comes from each device's clock. A device whose clock is hours off can win a conflict wrongly. A server-time scheme is possible later; for single-person preferences I judged it not worth the cost.
6. **Rules whitelist the seven fields.** Adding a synced preference later also needs a line in `firestore.rules`. Rules cannot bound the document's byte size; Firestore's own 1 MiB limit applies to the person's own document.
7. Per-device bookkeeping (`sync-meta:v1`: when each field was changed, which accounts this device met) is wiped with the data on sign-out (once that wipes), so a wiped browser's defaults never look like fresh edits.

## Tests against the plan

| ID | Status |
|---|---|
| P3-T1 who wins (cloud newer / local newer / missing fills / tie) | pass (`prefSync.test.ts`) |
| P3-T2 one change writes one field | pass |
| P3-T3 remote change applied, nothing written back | pass (also with a store that re-saves what it applied) |
| P3-T4 ten quick toggles → one write | pass |
| P3-T5 two devices | pass: two engines over one in-memory account (not two browsers) |
| P3-T6 per-device keys unaffected | pass (registry test + the engine only knows the seven fields) |
| P3-T7 offline edits arrive later | pass against a fake offline cloud; Firestore's real offline queue is not exercised |
| P3-T8 kill switch | pass (no prefs read, no writes, status paused, resumes and sends) |
| extra: untrusted cloud values, stale connections, failed writes and retry, account switch on one device, damaged bookkeeping | pass |
| rules tests (owner only, field whitelist, config read-only, rest closed) | **written, not run** |

## Manual checks (needs Firestore; about 15 minutes)

1. Two browsers (or a normal and a private window), same Google account. In A, toggle **Settings → Satellite map by default**: B follows within seconds, without a reload.
2. In A change **colour by** on the map: B's already-open map follows. Change the list **sort**: B follows.
3. Switch the **example project** off in A: B's example disappears; on again: it returns.
4. A third device that has never signed in: sign in; it takes the account's settings and does not overwrite them with its own defaults.
5. Devtools → Offline in A, change a setting, go online: B gets it.
6. Change a setting and **sign out at once**: sign in on another device and check it arrived.
7. Firebase console: `users/{uid}/prefs/main` shows `f.<field> = { v, t }`; changing one setting updates only that field.
8. Set `config/global.cloudEnabled` to `false`: the toast appears and changes stop syncing; back to `true`: it resumes.
9. Regression: on desktop, map options still persist across reloads; a guest (signed out) sees no change in behavior.
10. Run `npm run test:rules`.

## Next: Phase 4 (clips and projects)

The big one: per-clip documents with gzipped tracks, `projectId` on each clip, tombstones, the first-sign-in "keep your N guest clips?" prompt, and flipping `CLOUD_SYNC_ACTIVE` so sign-out can safely remove clips from a shared computer. One thing I need from you first: the **cap of clips per account** (I proposed 100) and whether thumbnails should sync (about 15 KB each) or be regenerated.
