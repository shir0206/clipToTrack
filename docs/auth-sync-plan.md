# Clip-to-Track: Google Sign-In, Cross-Device Sync and Cloud Video Previews

Implementation plan with phases, participating files, and tests that prove each phase is done.

---

## 0. Decisions already made

| Topic | Decision |
|---|---|
| Auth | Firebase Auth, Google provider. Guests keep today's behavior (localStorage only). |
| Source of truth | **Local stays the source of truth; cloud is a mirror.** Existing stores and hooks keep working for guests. |
| Backend plan | Firebase **Spark** (free). No Cloud Functions, no Cloud Storage. |
| Example project | **Read-only.** Nothing enters, leaves or is renamed. Uploading while viewing it always creates a new project. Never synced except the `enabled` flag. |
| Video | **Preview only**: first 60 s, 360p, no audio, no GPS track, target about 3 MB, H.264 MP4. |
| Video storage | User's own Google Drive, hidden `appDataFolder`, scope `drive.appdata`. Cost to the developer: $0. |
| Compression | **mediabunny** (WebCodecs) in a worker. `.LRV` takes a remux fast path. |
| Transparency | Every step (creating preview, uploading, saved, failed) is visible on the clip card. The user is told what is stored and how big it is. |

---

## 1. What `projects.ts` changed in the plan

1. **`assign()` can put a user clip into the example project today.** `fit()` loops over every project in the list, including the example (which is a `manual` project). A user clip with a close date and place would join it. Fix: add `locked?: boolean` to `Project` and skip locked projects in the `fit` loop (Phase 1).
2. **Do not sync `Project.clipIds`.** Two devices that each add a clip to the same project would overwrite each other's array (last-write-wins loses a clip). Instead each **clip document stores its `projectId`**, and `clipIds` is derived from the clips. Moving a clip is one clip-doc write. Project docs hold only name, title, place, `manual` and `updatedAt`.
3. **`UNDATED_ID` is a singleton** (`'undated'`). With the rule above, two devices adding undated clips merge naturally, and only the one project doc exists.
4. **Auto project ids are deterministic** (`trip-${clipId}`), so the same clip on two devices produces the same project id. That helps merging.
5. **Auto projects vanish when empty** (`assign` filters them out). In the cloud this is a tombstone on the project doc. `manual` projects survive being empty and are synced as such.
6. **`pickTitle` is deterministic for a seed**, so titles are stable across devices. Synced anyway, because `useProjects` migrates a missing `title` once and two devices could otherwise disagree.
7. **`assign()` runs during render in `useProjects`.** If remote clips arrive before remote projects, it invents its own grouping and fires the "where did it go?" toast. Remote data must be applied as **one batch** (projects, then clips, then places) and `initialIds` must include remotely hydrated clips so no toast fires.

---

## 2. Architecture

### 2.1 Sync layer

```
 UI / hooks (unchanged for guests)
        │ writes
        ▼
 local stores ──notify──► SyncEngine ──debounced diff──► Firestore
        ▲                      │
        └───── applyRemote ◄───┘ (origin = 'remote', so no echo)
```

- Each store exposes `subscribe(cb)` (it already has listeners) and `applyRemote(value)`. `applyRemote` updates state and notifies React listeners but **does not notify the SyncEngine** (origin flag).
- `SyncEngine` only runs when `auth.status === 'user'`.
- Firestore uses `persistentLocalCache` so a restart reads only changed documents.

### 2.2 What syncs

| Key / store | Sync? | Where in the cloud |
|---|---|---|
| `clip-to-track:clips:v1` (non-example) | Yes | `users/{uid}/clips/{clipId}` |
| `clip-to-track:projects:v1` (non-example, no `clipIds`) | Yes | `users/{uid}/projects/{id}` |
| `clip-to-track:clip-places:v1` | Yes | field `place` inside the clip doc |
| `clip-to-track:settings:v1` | Yes | `prefs/main` |
| `clip-to-track:satellite-default:v1` | Yes | `prefs/main` |
| `clip-to-track:project-mode:v1` | Yes | `prefs/main` |
| `clip-to-track:playback-help-dismissed` | Yes | `prefs/main` |
| `clip-to-track:example` | **Only `enabled`** | `prefs/main` |
| `clip-to-track:example-upload-auto:v1` | Removed in Phase 1 (dialog deleted) | none |
| Map options (`loadOpts` in `MapPanel`) | Yes, **key not yet confirmed** | `prefs/main` |
| `sheet-snap`, `force-layout`, panel widths, dock height | **No** (per device) | none |

### 2.3 Firestore model

```
config/global                  { cloudEnabled: boolean }          read-only for clients (kill switch)
users/{uid}/prefs/main         { f: { <key>: { v: any, t: ms } }, updatedAt }
users/{uid}/projects/{id}      { title, name?, place?, manual, updatedAt, deleted }
users/{uid}/clips/{clipId}     { title, date, slot, addedAt, place?, projectId,
                                 thumb?: string (<= ~15 KB data URL),
                                 metaGz: Bytes (gzip of ClipMetadata, <= 1000 points),
                                 cloudVideo?: { driveFileId, startSec, durSec, w, h, bytes },
                                 updatedAt, deleted }
```

- Per-field timestamps in `prefs/main`, so two devices changing different settings do not overwrite each other.
- `metaGz` is gzipped with `CompressionStream`. The local cap is 2000 points. The cloud copy is downsampled to **1000**. Size per clip is an estimate (about 20 to 60 KB) and must be measured in Phase 4.
- Tombstones (`deleted: true`) are purged after 30 days (client-side cleanup on sign-in, no Functions needed).
- Colour `slot` collisions after two offline devices: on merge, the clip with the earlier `addedAt` (then smaller id) keeps its slot, the other gets the lowest free slot.
- Free-tier limiter is **storage (1 GiB)**, not reads. Per-account cap of 100 clips (enforced in client and rules) plus the `cloudEnabled` kill switch.

### 2.4 Drive

- Scope `drive.appdata`, token from Google Identity Services (`initTokenClient`), **kept in memory only**, requested incrementally (first time a preview would be saved).
- Files tagged with `appProperties: { clipId }`. Simple multipart upload (about 3 MB).

---

## 3. Test strategy and tooling

| Layer | Tool | Used for |
|---|---|---|
| Unit | **Vitest** + `@testing-library/react` (jsdom) | Pure logic: `assign`, merge, codec, stores, hooks |
| Rules and integration | **Firebase Emulator Suite** (Auth + Firestore) + `@firebase/rules-unit-testing` | Security rules, SyncEngine round trips |
| Browser | **Playwright** (Chromium; WebKit for mobile layout) | Sign-in flow with the Auth emulator, two-context multi-device tests, encoder in a real browser |
| Manual | Checklist per phase | Things that need real hardware (HEVC decode, a real Google account) |

Test commands to add to `package.json`: `test` (Vitest), `test:rules` (emulator + rules tests), `test:e2e` (Playwright with emulators). Every phase below lists its tests with an ID (e.g. `P1-T3`). A phase is **done** only when all its tests pass and its manual checks are ticked.

---

## 4. Phases

---

### Phase 0: Console setup and tooling (no app behavior change)

**Goal:** accounts, keys and the test harness exist.

**Steps**
1. Firebase project on Spark. Enable Auth > Google. Add authorized domains (localhost, production).
2. Create the Firestore database (production mode, rules deployed in Phase 8; use the locked default until then).
3. Google Cloud console: enable **Google Drive API**. OAuth consent screen: set to **In production**, add scope `drive.appdata`. Add the web client's authorized JS origins. (In "Testing" mode tokens expire after 7 days and users are capped at 100.) Confirm that `drive.appdata` is listed as non-sensitive on your consent screen.
4. Install deps: `firebase`, `mediabunny` (later phase), dev: `vitest`, `@testing-library/react`, `@firebase/rules-unit-testing`, `@playwright/test`, `firebase-tools`.
5. Configure emulators for Auth and Firestore.

**Files**
- New: `.env.example`, `firebase.json`, `.firebaserc`, `firestore.rules` (deny-all placeholder), `firestore.indexes.json`, `vitest.config.ts`, `playwright.config.ts`, `src/test/setup.ts`.
- Modify: `package.json` (scripts), `.gitignore` (`.env.local`, emulator data).

**Tests**
- `P0-T1` Vitest runs a trivial test in jsdom (`localStorage` available).
- `P0-T2` `firebase emulators:exec "npm run test:rules"` starts and stops cleanly.
- `P0-T3` Playwright opens the dev server and sees the app shell.

**Done when:** all three pass in CI and the console checklist is ticked (manual).

---

### Phase 1: Example project read-only and sync-ready stores

**Goal:** the example can no longer be changed by the user, and every store has the hooks sync needs. Ships on its own with no cloud code.

**Changes**

1. **`lib/projects.ts`**
   - Add `locked?: boolean` to `Project`.
   - In `assign()`, inside the `for (const p of list)` loop, skip `p.locked` (and never use a locked project as an UNDATED target).
   - Keep locked projects from being deleted by `assign` when "empty" only if `manual` (the example is `manual`, so already safe).
2. **`components/example/useExampleProject.ts`**: when creating the project call a new `p.createProject({ locked: true })` (or `p.setLocked(projectId)`), so the flag lives on the project itself. Keep `exampleState().projectId` as a second source for older saved data. On start, if an existing example project lacks `locked`, set it.
3. **`hooks/useProjects.ts`**
   - `createProject(opts?)` accepts `locked`.
   - Guards: `moveClip`, `adopt`, `rename`, `removeProject` ignore a locked project as source or destination (safety net even if the UI misses a path). `removeProject` stays allowed only for the example's own uninstall path via an explicit `{force: true}`.
   - Export `isLocked(projectId)`.
4. **`components/example/useExampleUploadPrompt.tsx`**: `ask()` returns `'auto'` when the active project is the example, without opening any dialog and without reading `AUTO_KEY`.
5. **Delete** `components/example/ExampleUploadPrompt.tsx`, the `AUTO_KEY` code, and the `UploadChoice` type if nothing else uses it. Keep the `ask` call site (`ClipToTrack.tsx`) working: `'auto'` means "do not adopt".
6. **`ProjectsModal.tsx` (unseen: confirm paths)**: example project is not a drop target, its cards are not draggable out, rename control hidden, "Add videos" while it is selected creates a new project (via the `'auto'` path) and shows the existing placement toast.
7. **`ClipCard.tsx`**: new prop `canMove?: boolean` (default true). When false: `draggable` is false and the "Move to project…" menu item is hidden (Hide and Delete remain). Pass `canMove={!locked}` from the list.
8. **Sync-ready stores.** Add to each: `subscribeLocal(cb)` (already effectively the `listeners` set) and `applyRemote(value)` that commits **without** notifying sync.
   - `lib/settings.ts`: `applyRemoteSettings(s)`.
   - `config/mapDefault.ts`: `applyRemoteSatellite(on)`.
   - `hooks/useProjects.ts` (project mode store): `applyRemoteProjectMode(on)`.
   - `components/example/exampleProject.ts`: `applyRemoteExampleEnabled(on)`; `setExampleState` keeps all fields local but only `enabled` is exposed to sync.
   - `MapPanel.tsx` `loadOpts`: confirm its key and add the same pair.
9. **`lib/sync/syncKeys.ts`**: one registry: `SYNCED` (with field id) and `PER_DEVICE` lists, plus `isSyncedKey(key)`.

**Tests**

- `P1-T1` (unit, `projects.test.ts`) **assign never uses a locked project**: a locked project at the same place and date as a new clip; the clip must create a new project.
- `P1-T2` assign still groups two ordinary clips (regression: same day, same place go together; > `GAP_DAYS` apart do not; > `MAX_KM` do not).
- `P1-T3` assign keeps a locked, `manual`, empty project; removes an empty non-manual one.
- `P1-T4` (unit, `useProjects`) `moveClip`, `adopt`, `rename`, `removeProject` on a locked id change nothing (state identical by reference).
- `P1-T5` (unit) `moveClip` of a clip **into** a locked project does nothing.
- `P1-T6` (unit, `useExampleUploadPrompt`) with the example active, `ask(exampleId)` resolves `'auto'` immediately and `prompt` stays `null`; with another project it resolves `'keep'`.
- `P1-T7` (unit, each store) `applyRemote*` updates the value, notifies React subscribers, and does **not** invoke a registered sync callback; a normal setter does.
- `P1-T8` (unit) `syncKeys`: `sheet-snap` and `force-layout` are not synced; every key in section 2.2 marked "Yes" is.
- `P1-T9` (component) `ClipCard` with `canMove={false}`: not draggable, no "Move to project…" item, Delete and Hide still present.
- `P1-T10` (e2e) Open the example, click upload and choose a file: no dialog appears, a **new** project is created, the example still has only its own clips.
- `P1-T11` (e2e) Drag a normal clip onto the example project: nothing happens. Try to rename the example: control is absent.
- `P1-T12` (e2e, reload) Uninstall and reinstall the example via Settings still works (the `force` path).

**Done when:** all pass and a manual check confirms older saved data (an example project without `locked`) is upgraded on start.

---

### Phase 2: Authentication

**Goal:** sign in and out with Google. Guests unchanged. No data sync yet.

**Files**
- New:
  - `lib/firebase/app.ts` (init from env, emulator connect in dev).
  - `lib/firebase/auth.ts` (`useAuth()` external store: `{ status: 'loading' | 'guest' | 'user', user? }`, `signIn()`, `signOut()`).
  - `components/Account/AccountButton.tsx` (+ CSS): "Sign in" for guests, avatar menu for users.
  - `components/Account/SignOutDialog.tsx`.
- Modify:
  - `ClipToTrack.tsx` (unseen): render `AccountButton` in the header (desktop) and the mobile menu; mount a `<AuthGate>` that only exposes status.
  - `Settings.tsx`: new **Account** section (email, "Sign out"); hidden for guests, replaced by a "Sign in to sync your clips and settings" hint.

**Behavior details**
- `signInWithPopup` on desktop; fall back to `signInWithRedirect` when the popup is blocked or on iOS Safari standalone. Handle `auth/popup-closed-by-user` silently and `auth/network-request-failed` with a message.
- Persistence: `browserLocalPersistence`.
- Status starts as `loading`; the UI treats `loading` as guest (no flicker, no blocked app).
- **Sign-out:** a dialog asks "Remove your clips from this device?" Default: **yes, wipe synced local keys** (shared computers). Per-device keys and the example are kept. A "Keep a copy on this device" option exists but is not the default.
- Sign-out must never run while an upload is in flight: wait or cancel with a warning.

**Tests**
- `P2-T1` (unit) `useAuth` maps emulator/mocked `onAuthStateChanged` to `loading -> guest` and `loading -> user`.
- `P2-T2` (unit) `AccountButton` renders "Sign in" for guest, avatar and menu for user, nothing disruptive while `loading`.
- `P2-T3` (e2e, Auth emulator) Click sign in, complete the emulator popup flow: header shows the user's email; reload: still signed in.
- `P2-T4` (e2e) A guest with clips signs in: **clips and settings are untouched** (no sync yet).
- `P2-T5` (e2e) Sign out with "remove": synced keys are gone from `localStorage`, `sheet-snap` remains, the example is present again after start.
- `P2-T6` (e2e) Sign out with "keep": synced keys remain.
- `P2-T7` (unit) Popup closed by the user: no error toast. Network error: a toast.
- `P2-T8` (e2e, mobile viewport) Account control reachable in the mobile layout.

**Done when:** all pass and a manual sign-in with a real Google account works on desktop Chrome and iOS Safari.

---

### Phase 3: Preference sync

**Goal:** settings follow the user across devices.

**Files**
- New: `lib/sync/cloudPrefs.ts` (read, write, `onSnapshot`), `lib/sync/useSync.ts` (orchestrator; later phases add to it), `lib/sync/clock.ts` (injectable `now()` for tests).
- Modify: the Phase 1 stores (wire sync callbacks), `ClipToTrack.tsx` (mount `useSync()`).

**Behavior**
- On sign-in: read `prefs/main`. Per field: if the cloud has it, the cloud wins when its `t` is newer than the local change time; otherwise local fills the gap and is pushed. First ever sign-in: cloud wins for fields it has, local fills the rest.
- Local changes: debounce 1.5 s, write only changed fields (`updateDoc` with dotted paths).
- Remote changes via `onSnapshot` -> `applyRemote*` (no echo).
- Local change timestamps are stored in a small per-device map (`clip-to-track:sync-meta:v1`, **per device**, never synced).
- Offline: Firestore queues writes; local stays usable.
- `cloudEnabled === false` (kill switch) -> sync is skipped, banner "Cloud sync is paused".

**Tests**
- `P3-T1` (unit, `cloudPrefs`) merge function: cloud newer wins, local newer wins, missing on one side fills, ties favour the cloud.
- `P3-T2` (rules/integration, emulator) Changing one setting writes a single field; the other fields' `t` are unchanged.
- `P3-T3` (integration) Remote update triggers `applyRemote*` and **no write back** (assert write count stays 0).
- `P3-T4` (unit) Debounce: ten rapid toggles produce one write.
- `P3-T5` (e2e, two browser contexts, same emulator user) Toggle "Satellite by default" in A, see it in B within a few seconds without reload.
- `P3-T6` (e2e) Per-device keys: change the bottom-sheet snap in A; B is unchanged.
- `P3-T7` (e2e, offline) Go offline in A, change two settings, come back online: both reach B.
- `P3-T8` (unit) Kill switch off: no Firestore reads or writes happen.

**Done when:** all pass and the Firestore emulator UI shows exactly one `prefs/main` doc per user.

---

### Phase 4: Clip and project sync

Largest phase, so it is split into three sub-steps.

#### 4a: Data model and codec

**Files**
- New: `lib/sync/trackCodec.ts` (`encodeMeta` / `decodeMeta`: downsample to 1000 points keeping first and last, gzip via `CompressionStream`, base64-free `Uint8Array`), `lib/sync/thumbnail.ts` (shrink a thumbnail data URL to about 15 KB), `lib/sync/clipDoc.ts` (`toDoc(entry, place, projectId)` / `fromDoc(doc)`).
- Modify: `types/index.ts` (`Clip.updatedAt`, `Clip.cloudVideo?`), `useClips.ts` (`Entry.updatedAt`, set on every change; `Stored` includes it with a default of `addedAt` for old data).

**Tests**
- `P4a-T1` encode/decode round trip: first and last points identical, all fields of kept points preserved (`altM`, `speed3dKmh`, `utc`, ...).
- `P4a-T2` a 2000-point, 10 Hz fixture compresses below **200 KB** (assert a bound, then record the real number; adjust the cap if needed). The whole doc stays well below Firestore's 1 MiB limit.
- `P4a-T3` summary stats (`distance`, `maxSpeed`, `duration`) are not altered by downsampling (they come from `ClipMetadata` summary fields).
- `P4a-T4` thumbnail shrink produces a data URL of at most about 15 KB and still a valid JPEG header.
- `P4a-T5` `fromDoc(toDoc(x))` deep-equals `x` for fixtures: normal, no-GPS (tunnel) clip, clip without a date.
- `P4a-T6` a corrupted `metaGz` is rejected without throwing into the UI.

#### 4b: Sync engine for clips and projects

**Files**
- New: `lib/sync/cloudClips.ts` (per-doc diff, batch writes, `onSnapshot`), `lib/sync/merge.ts` (pure merge by id with `updatedAt`), `lib/sync/tombstones.ts`.
- Modify:
  - `useClips.ts`: `applyRemote(entries)` and per-clip change events (not whole-array rewrites).
  - `useProjects.ts`: `applyRemote({projects, clipProject, places})` applied as **one batch**; derives `clipIds` from each clip's `projectId`; puts remotely applied ids into `initialIds`-equivalent so **no placement toast** fires; place lookups (`reverse`) skip clips that already have a synced `place`.
  - `lib/projects.ts`: no changes except a helper `withDerivedClipIds`.
  - `lib/sync/useSync.ts`: clips and projects wired in.
- Deleting a clip, "Remove all clips" and `removeProject` write tombstones.
- The example's clips and its project are **filtered out** of every push (and never applied from remote).

**Tests**
- `P4b-T1` (unit, `merge`) newer `updatedAt` wins per doc; a tombstone newer than an edit deletes; an edit newer than a tombstone resurrects.
- `P4b-T2` (unit) two devices add different clips to the same project: after merge both clips are in it (membership via `clip.projectId`, nothing lost).
- `P4b-T3` (unit) colour slot collision is resolved deterministically, and re-running merge changes nothing (idempotent).
- `P4b-T4` (unit) the example project and its clip ids never appear in the push payload.
- `P4b-T5` (integration, emulator) add a clip: exactly one clip doc is written; editing a project name writes only the project doc.
- `P4b-T6` (integration) remote batch application: projects and clips arrive in different snapshots, the UI state changes **once**, `assign` is not invoked with half the data, no notice toast.
- `P4b-T7` (integration) a clip referencing a project id with no project doc yet: placed in a placeholder project, fixed when the doc arrives; never "undated" by mistake.
- `P4b-T8` (e2e, two contexts) upload a JSON clip in A: it appears in B with thumbnail, stats, colour and project; the card in B shows "Add video on this device".
- `P4b-T9` (e2e) delete in A: gone in B; B does not resurrect it after reload.
- `P4b-T10` (e2e, offline) edit in A offline, edit a different clip in B, reconnect: both edits survive.
- `P4b-T11` (e2e) the place name looked up in A is shown in B without a second Nominatim request (assert request count).
- `P4b-T12` (unit) per-account cap: 101st clip is refused locally with a clear message and not pushed.

#### 4c: First sign-in merge and sign-out

**Files**
- New: `components/Account/MergePrompt.tsx` ("You have N clips from before you signed in. Keep them in your account?" with *Add to my account* / *Not now*), `lib/sync/firstSync.ts`.
- Modify: `useSync.ts`, `Settings.tsx` ("Delete my cloud data" button, with confirmation, writes tombstones then removes docs).

**Behavior**
- Cloud empty and local has clips: prompt. Cloud has clips and local has clips: union by id, prompt as well. Cloud has clips and local is empty: apply silently.
- "Not now": the guest clips stay local and are not pushed. They show a small "This device only" badge until the user chooses to add them (Settings > Account > "Add device clips to my account").

**Tests**
- `P4c-T1` (unit, `firstSync`) decision table: empty/empty, local only, cloud only, both overlapping, both disjoint.
- `P4c-T2` (e2e) guest adds clips, signs in: prompt appears; "Add" pushes them; B sees them.
- `P4c-T3` (e2e) "Not now": nothing pushed (assert Firestore emulator has no clip docs), badge visible.
- `P4c-T4` (e2e) "Delete my cloud data": cloud empty, local intact.
- `P4c-T5` (e2e) sign out + wipe, sign back in: clips come back from the cloud, example remains.

**Done when:** every 4a/4b/4c test passes and you have recorded real compressed clip sizes from your own GoPro JSON (manual, set the final point cap).

---

### Phase 5: Google Drive connection

**Goal:** a signed-in user can grant `drive.appdata`, and the app can create, read and delete files there.

**Files**
- New: `lib/drive/driveAuth.ts` (GIS token client; `login_hint` plus `about.get` email check; silent renew; granted-scope check), `lib/drive/driveApi.ts` (`upload`, `download`, `delete`, `findByClipId`, `usage`), `hooks/useDrive.ts` (`off | connecting | ready | needs-reconnect | denied | unavailable`), `components/Account/DriveConsentNote.tsx` (one-line explanation before consent).
- Modify: `Settings.tsx` ("Cloud previews" section: toggle, "N previews · X MB in your Drive", Reconnect, **Delete all cloud videos**), `useSync.ts` (sync the `driveEnabled` pref).

**Edge cases handled**: user unticks the Drive checkbox (`denied`), 401/403 (`needs-reconnect`), wrong Google account, Workspace admin block (`unavailable`), no network, token never persisted.

**Tests** (Drive API mocked with a fake HTTP layer; the GIS script is stubbed)
- `P5-T1` `driveApi.upload` sends multipart with parent `appDataFolder` and `appProperties.clipId`.
- `P5-T2` `findByClipId` prevents a duplicate upload from a second device.
- `P5-T3` 401 transitions the hook to `needs-reconnect`; a successful reconnect returns to `ready` and retries once.
- `P5-T4` scope not granted: state `denied`, the app still syncs metadata, Settings shows "Connect Drive".
- `P5-T5` the token is never written to `localStorage`, `sessionStorage`, IndexedDB or Firestore (assert by scanning them after a connect).
- `P5-T6` account mismatch: connecting with a different Google account is rejected with a message.
- `P5-T7` `Delete all cloud videos` removes every file for the user and clears `cloudVideo` on the clip docs.
- `P5-T8` (manual) real Google account: consent screen text shows only the Drive app-data permission; files do not show in the Drive UI but appear under "Manage apps".

**Done when:** automated tests pass and the manual real-account check passes.

---

### Phase 6: Preview encoder (mediabunny)

**Goal:** turn a session video into a 60 s, 360p, no-audio preview of about 3 MB, off the main thread.

**Before coding, verify in the current mediabunny docs:** conversion API, trim options, discarding audio and non-video tracks, `canDecode` / `canEncode` checks, license terms, and AVC vs VP9 encoder availability. Names below are provisional.

**Files**
- New: `lib/video/previewEncoder.ts`, `workers/preview.worker.ts` and `lib/video/previewMessages.ts` (mirror `mp4.worker.ts`: `requestId`, progress, cancel, `serialize` errors), `lib/video/canDecodeVideo.ts`, `lib/video/blobCache.ts` (IndexedDB: pending uploads and downloaded previews, with LRU eviction at about 100 MB).
- Modify: `types/index.ts` (`UploadProgress.phase` gains `'compress' | 'upload'`), `PlaybackHelp.tsx` (a line: adding the `.LRV` also enables the cloud preview).

**Encoding spec**
- Output: MP4, H.264 (VP9 WebM only if no AVC encoder, and that case is flagged), 640x360 max (keep aspect ratio), 24 fps, **no audio, no data tracks**, video bitrate about 330 kbps, keyframe interval about 2 s.
- Range: `startSec = 0`, `durSec = min(60, duration)`.
- If the output is over 3.2 MB: re-encode once at a lower bitrate (about 85 percent); if still over 4 MB, fail with `TooLarge`.
- `.LRV`: remux with trim (keyframe-aligned) when it already meets the size; otherwise re-encode.
- Memory: close every `VideoFrame` immediately; encode with back-pressure.
- If the browser cannot decode the input (HEVC): resolve `{ ok: false, reason: 'no-decoder' }` before doing any work.

**Tests**
- `P6-T1` (unit) message protocol: progress, cancel (aborts and reports `cancelled`), error serialization; same shape as `mp4.worker`.
- `P6-T2` (unit) bitrate loop chooses a lower bitrate when the first result is too large (mocked encoder returning sizes).
- `P6-T3` (e2e, Chromium, with a 10 s fixture H.264 MP4 checked into `test-fixtures/`): output decodes, duration within 0.2 s of expected, **dimensions <= 640x360**, **no audio track**, **no `gpmd`/data track**, size within the budget.
- `P6-T4` (e2e) fixture longer than 60 s: output duration is 60 s (+/- 0.3 s).
- `P6-T5` (e2e) cancel mid-encode: worker stops, no partial blob is cached.
- `P6-T6` (e2e) fixture with no decodable video codec: returns `no-decoder` quickly.
- `P6-T7` (unit) `blobCache`: put/get, eviction order, survives reload.
- `P6-T8` (manual, your real clips) a 5.3K HEVC clip on your machine: record encode time and peak memory; verify the picture is acceptable at 360p/330 kbps for fast motion. Adjust bitrate if not. An `.LRV` clip: remux path is fast.

**Done when:** automated tests pass and the manual benchmark numbers are written into this doc.

---

### Phase 7: Upload, download, playback

**Goal:** the preview is created and uploaded automatically, and plays on other devices.

**Files**
- New: `hooks/useCloudPreview.ts` (one-at-a-time queue: encode -> cache -> upload -> set `cloudVideo` -> sync), `lib/drive/previewDownload.ts` (Bearer fetch -> Blob -> object URL).
- Modify:
  - `useClips.ts`: `attachVideo(id, src, { preview?: boolean })` and a session flag `videoIsPreview`; `setCloudVideo(id, info)`; clear it on delete.
  - `ClipCard.tsx`: status line and actions (below).
  - `ClipToTrack.tsx` (unseen): playhead mapping in the maximized player and the map.
  - `useExampleProject.ts`: never queue example clips.

**Gating** (all must hold): signed in, Drive `ready`, cloud enabled, clip is not an example clip, clip has a session video that is **not** itself a preview, `cloudVideo` is empty. Runs after `addFiles`; never blocks it.

**Card status line**
- "Creating cloud preview..." -> "Uploading 42%" -> "Saved to your Drive (first 60 s · 360p · 2.9 MB)".
- Failure states: "No preview: this browser can't decode the video. Add the .LRV to get one." / "Drive is full" / "Reconnect Drive" / "Retry".
- Other device: "Play preview (2.9 MB)" downloads on tap, shows the size beforehand, then `attachVideo(..., {preview:true})`.
- A preview-only video shows a "Preview" tag and the text "First 60 s · the full video stays on the device where you added it".

**Playhead rule**
- Full video: `currentTime / video.duration` (as today).
- Preview: `(startSec + currentTime) / trackDurationSec`; when the preview ends, **clear** the playhead (`onProgress(null)`) instead of leaving it at the 60 s mark.
- **Verify** whether `clip.sort.duration` is seconds (assumed: `projects.ts` multiplies it by 1000, so seconds). Use that single source.

**Failure paths**: 401/403 -> Reconnect; 404 -> fall back to "Add video on this device" and clear `cloudVideo`; quota full -> note, no retry loop; offline -> queue; delete clip -> delete Drive file, or queue a pending delete when offline; "Remove all clips" and "Delete all cloud videos" use the same queue.

**Tests**
- `P7-T1` (unit, `useCloudPreview`) gating table: each missing condition prevents the job (example clip, no Drive, already has `cloudVideo`, source is a preview, guest).
- `P7-T2` (unit) queue runs one job at a time and survives a failed job.
- `P7-T3` (unit) playhead function: full video, preview with `startSec = 0`, preview end clears, `startSec = 20` offset. (Pure function, extracted for testing.)
- `P7-T4` (component) `ClipCard` renders each status and its action; the size is shown before download.
- `P7-T5` (integration, mocked Drive) pipeline: encode (stub) -> upload -> `cloudVideo` written to the clip doc with `driveFileId`, `bytes`, `durSec`.
- `P7-T6` (integration) a second device never re-uploads: `findByClipId` hit sets `cloudVideo` without an upload.
- `P7-T7` (integration) 404 on download clears `cloudVideo` and shows "Add video on this device".
- `P7-T8` (integration) offline delete: Drive file delete is queued and executed on reconnect; no orphan remains.
- `P7-T9` (e2e, two contexts, mocked Drive) A adds a video: card goes through all states; B shows "Play preview (x MB)", tap plays, map playhead moves along the first part of the route, clears at the end.
- `P7-T10` (e2e) example clips never show cloud status and never upload.
- `P7-T11` (manual, real Drive) upload a real clip, check size <= about 3.2 MB, play on a phone over mobile data (size shown first), revoke access in Google account settings: card shows Reconnect, track and stats intact.

**Done when:** automated tests and the real-Drive manual run pass.

---

### Phase 8: Hardening and launch

**Files**
- Modify: `firestore.rules` (final), `Settings.tsx` (privacy text), README.
- New: `firestore.rules.test.ts`, `docs/PRIVACY.md` (what is stored where), `lib/sync/limits.ts` (caps in one place).

**Rules (sketch)**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /config/global { allow read: if true; allow write: if false; }
    match /users/{uid}/{document=**} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow create, update: if request.auth != null && request.auth.uid == uid
        && request.resource.size() < 900 * 1024;   // stay under 1 MiB
      allow delete: if request.auth != null && request.auth.uid == uid;
    }
    match /{other=**} { allow read, write: if false; }
  }
}
```
Add per-collection field-type checks (`title is string`, `metaGz is bytes`, `deleted is bool`) and a clip-count cap via a counter in `prefs/main` if you want it server-enforced (Spark has no Functions, so keep it client-side plus rules size checks).

**Tests**
- `P8-T1` (rules) user A cannot read or write `users/B/...`.
- `P8-T2` (rules) unauthenticated cannot read or write anything except reading `config/global`.
- `P8-T3` (rules) clients cannot write `config/global`.
- `P8-T4` (rules) a document over the size bound is rejected; wrong field types are rejected.
- `P8-T5` (e2e) full journey: guest -> upload -> sign in -> merge -> second device -> preview playback -> sign out (wipe) -> sign in again.
- `P8-T6` (e2e) kill switch: set `cloudEnabled=false` and the app works as a guest-like app, with a paused banner.
- `P8-T7` (manual) usage review: on the Firebase console, check reads, writes and storage after a day of dogfooding; confirm the per-user estimate times your expected user count stays under the free limits.
- `P8-T8` (manual) accessibility: Account menu, dialogs (focus trap, Escape) and status lines are keyboard and screen reader friendly.

**Done when:** all rules tests pass and the usage review is acceptable.

---

## 5. Order, dependencies and what ships when

```
P0 ──► P1 ──► P2 ──► P3 ──► P4a ──► P4b ──► P4c ──► P5 ──► P6 ──► P7 ──► P8
 │       └─ shippable alone (example read-only)
 │                   └─ shippable alone (sign in/out, nothing synced)
 │                          └─ shippable: preferences sync
 │                                                  └─ shippable: clips and projects sync (no video)
 └─ P5, P6 can be built in parallel after P4c; P7 needs both.
```

Recommended releases: **R1** = P1; **R2** = P2 + P3; **R3** = P4; **R4** = P5 to P7 (cloud previews); P8 runs alongside and gates R3 and R4.

---

## 6. Open checks (not verified yet)

1. `MapPanel.loadOpts` storage key, the header and the maximized player in `ClipToTrack.tsx`, and `ProjectsModal.tsx` drop and rename paths: I have not read their contents.
2. mediabunny's exact API, license and `canDecode`/`canEncode` behavior.
3. That `drive.appdata` is non-sensitive on your consent screen (my recollection; confirm in the console).
4. Real compressed clip sizes in Firestore (the 20 to 60 KB figure is an estimate) to set the point cap and the per-account clip cap.
5. Real encode time and quality at 360p / about 330 kbps on your clips and machines.
6. Whether `clip.sort.duration` is in seconds (`projects.ts` suggests so).
