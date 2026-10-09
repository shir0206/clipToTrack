# Clip to Track — Mobile Implementation Plan

> Status: **plan only, no code changed yet.**
> Basis: the real source (`ClipToTrack.tsx/.css`, `ClipCard`, `TrackMap`, `MapPanel`, `ProjectsModal`, `Settings`, `UploadZone`, `VideoModal`, `PlaybackHelp`, `AltitudeCluster.css`, `Icon`, `styles.css`, `types/index.ts`, `mp4.worker.ts`).
> The "map + bottom sheet" concept is used only as a direction. Every decision below is checked against what the code actually does today.

---

## 0. Goals, non-goals, ground rules

### Goals

1. On a phone, the **map stays visible** while the person browses, plays and reads metadata. The map and the sheet behave as one workspace.
2. The **clip card on mobile shows everything the desktop card shows** (see §5.2 for the field-by-field proof). Nothing is dropped to "make it fit"; it is re-flowed.
3. **Video ↔ route ↔ playhead stay linked** exactly as today (`ClipCard.onProgress → mapApi.setPlayhead → setProbe → profile/speedometer`).
4. **No second implementation of the app.** One state owner (`ClipToTrack`), one `ClipCard`, one `TrackMap`; mobile is a layout + interaction layer.
5. Desktop behaviour and desktop persisted settings are **not regressed**.

### Non-goals (v1)

- Clip text search (does not exist on desktop; the concept's "searchable list" is deferred).
- A separate bottom navigation bar or separate "library" route.
- Native app wrappers / offline video persistence (see Risk R3).

### Ground rules

- **Never remount `<video>` or `TrackMap` when the layout changes** (rotation, snap change). Both hold live state (playback position, MapLibre instance). Layout is switched with CSS on a single DOM tree, not by rendering a different component tree.
- Structural switches are driven by one JS flag (`data-layout`), pure styling by media queries (`pointer: coarse`, `hover: none`).
- Every new colour/size comes from `styles.css` tokens. No hard-coded colours.

---

## 1. What the code does today (and what that means for mobile)

| Area                    | Real implementation                                                                                                                                                                                                                                       | Mobile consequence                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell                   | `.app-shell` `position:fixed; inset:0`, header 60px, `.app-layout` flex row: `.side-panel` (width `--panel-width`) + `.panel-resizer` + `.map-frame`                                                                                                      | Row layout cannot work < ~600px. Resizer is mouse/keyboard only.                                                                                                                 |
| Panel width             | `panelW` state, `clampW()` uses `MIN_W=320`, `MIN_MAP=280`; **persisted to `localStorage` on every change and re-clamped on `resize`**                                                                                                                    | On a 390px phone `clampW` returns 320 and **would overwrite the user's saved desktop width** if the same browser profile/sync is used. Must not persist while mobile (see §3.4). |
| State owner             | `ClipToTrack` holds `selectedClipId`, `hoveredClipId`, `playingClipId`, `maxClipId`, `maxPlaying`, `videoWin`, `hiddenIds`, `sort`, `projectFilter`, `projectsDialog`, `dragClipId`, `settingsOpen`, `playbackHelp`                                       | Reuse as-is. Add only layout/sheet state.                                                                                                                                        |
| List                    | `panelBody` = `.sort-bar` + `<ul class="plain-list" role="listbox">` of `ClipCard`; wrapped by `ProjectBar` in project mode; `UploadZone` below                                                                                                           | This exact JSX becomes the sheet content. Not duplicated.                                                                                                                        |
| Card                    | Grid `clamp(168px, 46cqw, 640px) 1fr`; inline `<video>` inside thumbnail; HTML5 drag; `onMouseEnter/Leave` → `hoveredClipId`                                                                                                                              | Stack on narrow container; no DnD on touch; hover is unreliable on touch (§6.4).                                                                                                 |
| Large player            | `openMax()` calls `openVideoWindow()` (a **popup window**, "must run synchronously inside the click"), falls back to `VideoModal` only when it returns `null`                                                                                             | On phones `window.open` usually returns a new tab, not `null` → wrong UX. Mobile must force `VideoModal`.                                                                        |
| Map                     | `TrackMap`: one MapLibre map, raster basemaps, GeoJSON sources `tracks/segments/points/ends/hover/pin/probe/playhead/measure`, hover popup + click-pinned popup (288px wide), `HIT_PX = 8`, `fitBounds` with padding 100–120                              | Padding must account for the sheet; hit radius too small for fingers; hover popup irrelevant on touch.                                                                           |
| Playhead                | `setPlayhead(clipId, frac)` writes GeoJSON **every animation frame**, calls `setProbe`, and `jumpTo` when "follow" is on                                                                                                                                  | Fine on desktop; needs throttling on phones (§8.1).                                                                                                                              |
| Toolbar                 | `MapPanel`: absolute, top-left→right:58px, `flex-wrap`; `PlaceSearch` (Nominatim, 4-char type-ahead), 3 dropdowns, 6 layer toggles, 5 tools + export dropdown; tooltips via `data-tip` on `:hover`; sections gated by `view.search/mapStyle/layers/tools` | ~17 controls wrap into 2–3 rows over the map. Tooltips never show on touch.                                                                                                      |
| Profile dock            | `ElevationProfile` rendered **inside `TrackMap`** under `.map-stage` (height var, `ns-resize` grip, tabs, pop-out windows). `probe` state lives in `TrackMap`                                                                                             | A 260px dock under a full-bleed map fights the sheet. Needs to render **inside the sheet** while keeping `probe` (§5.6). Pop-out windows must be hidden on mobile.               |
| Altitude/Speed clusters | Container-query driven (`@container (max-width:560px)`, `(max-height:340px)`, `(max-height:190px)`)                                                                                                                                                       | Already adapts to a short, narrow host. Reusable in a half sheet without rewrite.                                                                                                |
| Projects                | `ProjectBar` (select + "New" + `ProjectHead` rename/manage/delete), drag tray (`DropChip`), `ProjectsModal` (900×620, 270px                                                                                                                               | 1fr grid, has a `max-width:640px` stack), `ProjectNotice` toast                                                                                                                  | Select dropdown is absolutely positioned inside a narrow panel; DnD must be replaced by a button flow. |
| Dialogs                 | `Settings`, `PlaybackHelp`, `ProjectsModal` centred, `max-height: calc(100vh - 48px)` / `88vh`                                                                                                                                                            | `vh` is wrong on mobile browsers (URL bar). Make them full-screen sheets, use `dvh`.                                                                                             |
| Toasts                  | `.toast-message` `position:fixed; bottom:24px; left:50%` (z 60)                                                                                                                                                                                           | Would sit on top of the bottom sheet. Reposition.                                                                                                                                |
| Base                    | `body{min-width:320px; min-height:100vh}`, hover-only styles, 28–34px controls                                                                                                                                                                            | Needs `viewport-fit=cover`, `dvh`, safe areas, ≥44px tap targets.                                                                                                                |

### Bugs / inconsistencies found while reading (fix in Phase 0, they affect the mobile Settings screen)

1. `Settings.tsx` "Example project" row uses classes **`ctt-set-row` / `ctt-switch`**, but `Settings.css` only defines **`settings-row` / `toggle-switch`**. The row is unstyled (no switch look, no padding/border).
2. `ClipToTrack.tsx` sort chips use **`ctt-sort-dir`**, CSS defines **`.sort-direction`**.
3. `ClipCard` renders `.project-title` (defined in `ProjectsModal.css`) — card layout depends on a rule from another component's stylesheet (`.project-title > .icon-button:first-of-type { margin-left:auto }`). Works, but fragile; the mobile card CSS must not break it.
4. `ProjectsModal.css` header comment mentions `--card/--muted/--bg` tokens that no longer exist (now `--surface/--text-muted/--background`). Cosmetic.

### Files I could not see (assumptions to verify before coding)

`ElevationProfile`, `SpeedCluster` (+`Dial`), `VideoWindow`/`openVideoWindow`, `Logo`, `lib/video/videoSupport` (`detectBrowser`, `watchPicture`, `probeDecode`), `hooks/useClips` (`attachVideo` signature), `hooks/useProjects`, `lib/settings`, `lib/pointPopup`, `ExampleProject/*`, and `TrackMap.tsx` lines ~420–600 (layer definitions, notably the width of `tracks-line`). Phase 0 starts by reading these.

---

## 2. Target architecture

### 2.1 Layout modes

One hook, one attribute:

```ts
// hooks/useLayoutMode.ts
type LayoutMode = 'desktop' | 'mobile' | 'mobile-landscape';
```

Resolution (re-evaluated with `matchMedia` listeners, not on every resize event):

| Condition                                                        | Mode                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `(max-width: 820px)`                                             | `mobile`                                                                 |
| `(max-height: 500px) and (pointer: coarse)` (phone in landscape) | `mobile-landscape`                                                       |
| otherwise (incl. tablets ≥ 821px, desktop)                       | `desktop` (tablet portrait 768 → `mobile`; tablet landscape → `desktop`) |

Applied as `data-layout` on `.app-shell`. CSS uses `[data-layout^='mobile']` for structure.

### 2.2 DOM (single tree — the key decision)

```
.app-shell[data-layout]
├─ header.app-header                 (desktop: logo + Projects + Settings)
│                                    (mobile: compact app bar, §5.1)
└─ main.app-layout
   ├─ section.map-frame              ← same element on every layout, always mounted
   │    └─ TrackMap (+ MapPanel)
   ├─ div.panel-resizer              (desktop only: not rendered when mobile)
   └─ aside.side-panel               ← SAME element: a column on desktop,
        ├─ [mobile] .sheet-handle       a bottom sheet on mobile (CSS transform)
        ├─ [mobile] .sheet-peek         (collapsed summary bar)
        ├─ .panel-title / ProjectBar / sort-bar / plain-list / UploadZone
        └─ [mobile] #profile-host       (portal target for the telemetry dock)
```

Why not render a separate `<MobileLayout/>`: the `ClipCard`s (and the playing `<video>`) would remount and playback would stop on rotation or on crossing 820px; MapLibre would be destroyed and re-created. A CSS-driven single tree avoids both.

### 2.3 New / changed units

| Unit                                        | Type                                          | Responsibility                                                                                                                   |
| ------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `useLayoutMode`                             | new hook                                      | resolves mode, sets `data-layout`, exposes `isMobile`                                                                            |
| `useBottomSheet`                            | new hook                                      | drag/snap state machine, returns `{snap, setSnap, y, bind, visiblePx}`                                                           |
| `BottomSheet` chrome                        | new in `ClipToTrack` (or `components/Sheet/`) | handle, peek bar, ARIA, `inert` for hidden content                                                                               |
| `SheetPeek`                                 | new                                           | collapsed summary: colour badge, title, place, play/pause, progress, thumbnail                                                   |
| `ClipCard`                                  | **extend**                                    | `layout` prop, mobile re-flow, video only mounted when needed, move-to-project, no DnD on touch                                  |
| `MapPanel`                                  | **extend**                                    | `compact` mode: search icon → field, one "Layers" button → menu sheet                                                            |
| `TrackMap`                                  | **extend**                                    | `insets` (sheet height), touch hit radius, tap-on-background callback, `profileHost` portal, throttled playhead, mobile controls |
| `VideoModal`                                | **extend**                                    | `mobile` variant: full-bleed, touch controls, orientation/fullscreen, telemetry HUD                                              |
| `ProjectBar`/`ProjectSelect`                | **extend**                                    | "sheet" presentation of the picker; `MoveToProject` picker                                                                       |
| `ProjectsModal`, `Settings`, `PlaybackHelp` | CSS + small TSX                               | full-screen on mobile, `dvh`, iOS/Android help steps                                                                             |
| `ClipToTrack`                               | **extend**                                    | sheet state, auto-snap rules, force modal player on mobile, guard persisted width                                                |

CSS split: keep `ClipToTrack.css` desktop-first; add `ClipToTrack.mobile.css` (imported after it) containing all `[data-layout^='mobile']` and `pointer: coarse` rules, plus `BottomSheet.css`. Rationale: the 1,666-line file stays reviewable and desktop diffs stay empty.

---

## 3. Phase 0 — Foundations (no visible redesign yet)

**Files:** `index.html`, `styles.css`, `ClipToTrack.tsx`, `ClipToTrack.css`, `Settings.tsx`, new `useLayoutMode.ts`.

### 3.1 Viewport and units

- `index.html`: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">`.
- `styles.css`: `body { min-height: 100vh }` → add `min-height: 100dvh`. Add tokens:
  ```css
  :root {
    --safe-top: env(safe-area-inset-top, 0px);
    --safe-bottom: env(safe-area-inset-bottom, 0px);
    --safe-left: env(safe-area-inset-left, 0px);
    --safe-right: env(safe-area-inset-right, 0px);
    --tap: 44px; /* minimum touch target */
    --header-h: 60px; /* desktop; overridden to 52px on mobile */
    --sheet-visible: 0px; /* set from JS: how much of the map the sheet covers */
    --sheet-radius: 20px;
    --shadow-sheet: 0 -8px 30px #15203329;
  }
  ```
- `.app-shell`: add `height: 100dvh` next to `inset:0`, `overscroll-behavior: none`.

### 3.2 Hover vs touch

- Wrap every `:hover` rule that is cosmetic in `@media (hover: hover)` (`.clip-card:hover`, `.toolbar-button:hover`, `.map-chip:hover`, `.sort-chip:hover`, `.icon-button:hover`, …). Touch browsers otherwise leave "sticky hover" after a tap.
- `ClipCard` `onMouseEnter/onMouseLeave` → on touch, iOS emits emulated mouse events after a tap and `mouseleave` only fires when tapping elsewhere, leaving `hoveredClipId` stuck and the route highlighted. In mobile mode pass `onHover={() => {}}` from `ClipToTrack` (and skip `onHover` inside `tracks-line` `mousemove` — it never fires on touch anyway).
- `MapPanel` tooltips (`data-tip`) are hover-only → in compact mode every action gets a visible text label (§5.4).

### 3.3 Tap targets

`@media (pointer: coarse)`: `.icon-button`, `.toolbar-button`, `.sort-chip`, `.project-create`, `.project-button`, `.link-button` get `min-height/min-width: var(--tap)` (visual size may stay smaller using padding/`::after` hit-area expansion where a 44px circle would break the card layout).

### 3.4 Don't corrupt desktop preferences

In `ClipToTrack.tsx`:

- The `useEffect` that does `localStorage.setItem(WIDTH_KEY, …)` and the `resize` re-clamp effect: **skip when `isMobile`**.
- `layoutIsDefault` passed to `Settings` (compares `panelW` and `PROFILE_HEIGHT_KEY`): irrelevant on mobile; hide the whole "Layout" section there (§7.5).
- New keys (namespaced like the existing ones): `clip-to-track:sheet-snap`, `clip-to-track:map-opts:v4` stays unchanged. Basemap is already intentionally not persisted (`loadOpts` forces Settings default) — keep.

### 3.5 Fix the CSS class mismatches (§1 bugs 1–2)

`ctt-set-row` → `settings-row`, `ctt-switch` → `toggle-switch`, `ctt-sort-dir` → `sort-direction`.

**Acceptance:** desktop pixel-identical (except the Example-project row now styled correctly); a 390px window no longer writes `clip-to-track:panel-width`; no sticky hover on an emulated touch device.

---

## 4. Phase 1 — Shell and bottom sheet

### 4.1 Mobile app bar (replaces the 60px desktop header)

Real controls to carry over (nothing invented): **Logo**, **Projects** button (only if `projectMode`), **Settings** button.

```
┌──────────────────────────────────────────┐  height 52px + safe-top
│ [▲ logo-mark]  Tyrol trip ▾        ⚙    │
└──────────────────────────────────────────┘
```

- Logo: mark only, tagline hidden (`Logo` gets a `compact` prop, or CSS hides `.brand-tagline` and `.logo-text i`).
- Centre: current project name (from `projects.views`, "All projects" when `activeProject==='all'`) as a button with chevron → opens the project switcher (§7.1). Hidden when `projectMode` is off (shows `Clips · N` instead — same as the desktop `.panel-title`).
- Right: Settings icon button (44px).
- The "Projects" **dialog** (`ProjectsModal`) is reached from the switcher's "Manage projects…" row (replaces the desktop "Projects" header button).
- Header floats _over_ the map? **No** — keep it opaque and in flow (52px). Simpler, avoids covering MapLibre top controls; the map is `.map-frame { flex:1 }` beneath it as today.

### 4.2 Bottom sheet = the existing `<aside class="side-panel">`

CSS on mobile:

```css
[data-layout^='mobile'] .app-layout {
  position: relative;
}
[data-layout^='mobile'] .map-frame {
  position: absolute;
  inset: 0;
}
[data-layout^='mobile'] .side-panel {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  width: auto;
  height: var(--sheet-max); /* tallest snap */
  transform: translate3d(0, var(--sheet-y, 100%), 0);
  border-radius: var(--sheet-radius) var(--sheet-radius) 0 0;
  background: var(--background);
  border: 0;
  box-shadow: var(--shadow-sheet);
  padding: 0 12px var(--safe-bottom);
  transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1); /* off while dragging */
  will-change: transform;
}
```

(`--sheet-max = calc(100dvh - var(--header-h) - var(--safe-top) - 8px)`; the app bar stays visible when fully expanded so project context is never lost.)

### 4.3 Snap points and rules

| Snap        | Visible height       | Content shown                                                                                                           |
| ----------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `collapsed` | `72px + safe-bottom` | **Peek bar**: colour badge, title (+place), play/pause, thin progress, thumbnail 48×32. Progress strip while uploading. |
| `half`      | `52dvh`              | Selected clip's **full card** (stacked), then telemetry (if enabled), then a horizontal strip of other clips.           |
| `expanded`  | `--sheet-max`        | `ProjectBar` + sort bar + full list of full cards + upload zone.                                                        |

Transitions:

| Event (real handler)                                            | Result                                                                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Tap route / dot (`TrackMap` `click`/`tracks-line` → `onSelect`) | select + `half`                                                                                                    |
| Tap empty map (new `onBackgroundTap`)                           | step down one snap (expanded→half→collapsed); ignored while measuring                                              |
| Tap a card that is **not** selected (list in `expanded`)        | select + `half`, card scrolled into view                                                                           |
| Play (`onTogglePlay`)                                           | selection stays; snap unchanged (user may collapse and keep watching the map)                                      |
| Upload starts (`busy`)                                          | progress shown in peek + sheet header; snap unchanged                                                              |
| Upload finished (`addFiles` ids)                                | existing behaviour selects `ids[0]` → `half`                                                                       |
| `handleDelete` of selected clip                                 | `collapsed` if list empty, else `expanded`                                                                         |
| `clips.length === 0`                                            | `half` locked, shows empty state + upload zone (map shows the existing `.empty-state`, re-centred above the sheet) |
| Open Settings / Projects / PlaybackHelp / player                | sheet `collapsed`-dimmed? **No** — modals overlay everything (z 1000); sheet untouched.                            |
| Search field focused                                            | `collapsed` (keyboard room), restored on blur                                                                      |

### 4.4 `useBottomSheet` gesture design

- Pointer Events on `.sheet-handle` **and** the peek bar (not the whole sheet): `touch-action: none` on those two only.
- Drag updates `--sheet-y` directly via `style.setProperty` in `requestAnimationFrame` (no React state per frame); transition disabled while dragging (`.is-dragging`).
- Release: pick the nearest snap, biased by velocity (≥0.5 px/ms flings one step). Rubber-band 20% beyond the end snaps.
- Scroll hand-off in `expanded`: list (`.plain-list`) scrolls natively with `overscroll-behavior: contain`; the sheet only drags from the handle. (Hand-off from list top-overscroll is a stretch goal — avoids the classic nested-scroll bugs.)
- `prefers-reduced-motion`: no spring, 0ms transitions, snaps instantly.
- Persist last snap in `clip-to-track:sheet-snap` (restored only if clips exist).

### 4.5 Accessibility of the sheet

- Handle is a `<button aria-label="Clip panel" aria-expanded aria-controls="clip-sheet">` that cycles collapsed → half → expanded on tap/Enter/Space (also gives non-gesture users full access).
- Content not visible in `collapsed` gets the `inert` attribute so tab/focus and screen readers can't reach off-screen cards. The peek bar is the only interactive thing then.
- `role="region" aria-label="Clips"` on the sheet; the `ul[role=listbox]` is unchanged.
- Live region announces "N clips · project X" on snap change (reuse `role="status"` pattern from `.playing-indicator`).

### 4.6 Map insets (`--sheet-visible` + `map.setPadding`)

`useBottomSheet` reports `visiblePx` on **settle** (not per frame). `ClipToTrack` sets `--sheet-visible` on the shell and passes `insets={{bottom: visiblePx}}` to `TrackMap`, which calls `m.setPadding({ bottom })`. With MapLibre padding set:

- `fitBounds` (selected clip / fit all / search `onGo`) centres in the _visible_ map area — replaces today's fixed `padding: 120/100`; keep a base padding of 48 on top of it.
- `jumpTo({center})` for "follow playhead" automatically centres above the sheet.
- Overlays `.map-legend` (`bottom:34px`), `.measure-bar` (`bottom:10px`), `.map-coordinates` (`bottom:10px`), MapLibre bottom controls (scale, attribution) use `bottom: calc(var(--sheet-visible) + 10px)` on mobile.
- In `expanded` the sheet covers ~85% — padding is clamped to ≤ 55% of the map height so `fitBounds` never receives a degenerate box.
- **Attribution must remain reachable** (OSM/Esri licences): keep MapLibre's compact attribution control above the sheet in `collapsed`/`half`; in `expanded` it is covered, which is acceptable because the map is not the focus then — plus an "ⓘ Map credits" row in Settings.

**Acceptance:** sheet drags smoothly at 60fps on a mid-range Android; three snaps; fit-to-clip frames the route fully above the sheet at `half`; rotation never restarts a playing video.

---

## 5. Phase 2 — The mobile clip card (all details, nothing dropped)

### 5.1 Container strategy

`ClipCard` already sits in `.plain-list { container-type:inline-size }`. Add a prop and a class:

```tsx
type Props = { …existing…; layout?: 'row' | 'stacked'; /* default: 'row' */ };
// ClipToTrack passes layout={isMobile ? 'stacked' : 'row'}
className={`clip-card is-${layout} …`}
```

Stacked CSS (`.clip-card.is-stacked`): `grid-template-columns: 1fr` (overrides `clamp(168px,46cqw,640px) minmax(0,1fr)`), thumbnail spans the card width at 16:9 (`max-height: var(--video-max-h)`), `card-body` below it.

### 5.2 Field-by-field coverage (this is the "display all the details" contract)

Every item below exists in today's `ClipCard` / `Clip` type and **must** be present on mobile:

| Source                                                                                         | Desktop                                                                   | Mobile (stacked card)                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clip.color` → `clipColorVars`                                                                 | rail `::before`, `.track-badge`, selected border/glow                     | identical (rail kept; selected = `--clip-color` border + `--clip-faint` bg)                                                                                                                                         |
| `clip.thumbnail` / `--thumbnail`                                                               | thumbnail bg                                                              | full-width 16:9 header image                                                                                                                                                                                        |
| `clip.videoUrl` + `<video>`                                                                    | inline video in thumbnail                                                 | same element, same props (`playsInline`, `preload="metadata"`, `poster`) — mounted only when needed (§5.3)                                                                                                          |
| no `videoUrl`                                                                                  | `.thumbnail-hint` "Re-add video to play" (tooltip)                        | same hint but **tappable** → opens the file picker for that clip (needs `attachVideo` wiring; falls back to plain text if signature differs) and the long explanation is shown inline (no `title` tooltip on touch) |
| `clip.title`                                                                                   | `<h3>`                                                                    | `<h3>` with ellipsis, 2 lines max                                                                                                                                                                                   |
| `clip.index`                                                                                   | in `aria-label`, VideoModal badge                                         | same                                                                                                                                                                                                                |
| `place` (`projects.clipPlace`)                                                                 | `.card-meta` + mapPin                                                     | same row                                                                                                                                                                                                            |
| `clip.date`                                                                                    | `.card-meta` + calendar                                                   | same row                                                                                                                                                                                                            |
| `clip.camera`                                                                                  | `.card-meta` + camera                                                     | same row                                                                                                                                                                                                            |
| `clip.duration` / `distance` / `maxSpeed` / `altitude`                                         | `.card-stats` 4 tiles (clock, route, gauge, mountain)                     | **2×2 grid** (explicit `repeat(2,1fr)`; the desktop `auto-fit minmax(92px)` would produce an ugly 3+1 at ~340px). In `half` snap: compact 4-up strip (value over label) to save height.                             |
| `clip.gpsQuality`                                                                              | `.quality-label` pill + gps icon                                          | same pill                                                                                                                                                                                                           |
| `clip.details[]` groups/rows                                                                   | `<details class="more-menu">` "More details"                              | same `<details>`; groups render as the existing 2-col `dl`; `overflow-wrap:anywhere` already handles long values. Open state is local to the `<details>` (lost on remount → another reason to keep cards mounted).  |
| `hidden` + `onToggleHidden`                                                                    | eye / eyeOff button, `.is-hidden` dims badge+rail                         | eye button, 44px; same dimming                                                                                                                                                                                      |
| delete + `confirming`                                                                          | trash button toggles `.confirm-bar` (`role=alertdialog`, Delete / Cancel) | same inline bar, buttons 44px, full-width row                                                                                                                                                                       |
| play / pause / stop / maximize                                                                 | 3 round buttons + `disabled={!canPlay}`                                   | same 3 actions, in a control row **overlaid on the video's bottom edge** when playing, and below the title when paused (so the picture is never covered while watching)                                             |
| `playing`/`nowPlaying` → `.playing-indicator` + equalizer, `.is-playing` outline & badge pulse | yes                                                                       | yes (equalizer kept; respects `prefers-reduced-motion`, already coded)                                                                                                                                              |
| `videoError` → `.video-error` (`UNPLAYABLE`)                                                   | text under controls                                                       | same, plus a "How to fix" link that opens `PlaybackHelp` (currently only shown at upload time)                                                                                                                      |
| `selected` / `aria-selected` / `aria-label` / keyboard Enter-Space                             | yes                                                                       | yes (a11y unchanged)                                                                                                                                                                                                |
| `onDragStart/End` (drag to project)                                                            | HTML5 DnD                                                                 | **removed on touch** → replaced by "Move to project" (§7.3)                                                                                                                                                         |
| `onHover`                                                                                      | map highlight                                                             | no-op on touch (§3.2)                                                                                                                                                                                               |
| `clip.coordinates` / `samples`                                                                 | map + telemetry                                                           | map + telemetry (not shown on card on desktop either)                                                                                                                                                               |
| `clip.addedAt`, `clip.sort.*`                                                                  | sorting only                                                              | sorting only (sort bar)                                                                                                                                                                                             |

New card action added for mobile (not removing anything): a `⋯` button in the title row opening a small action list — **Move to project…**, **Hide/Show on map**, **Delete** (the latter two remain as direct buttons too, so no desktop function is relegated).

### 5.3 Video mounting policy (iOS/Android limits)

Mobile browsers cap concurrent decoders (iOS Safari is aggressive) and every desktop card currently mounts `<video preload="metadata">`. In `ClipCard`:

```tsx
const mountVideo =
  !!clip.videoUrl &&
  !videoError &&
  (layout === 'row' || playing || selected || nowPlaying);
```

Non-selected stacked cards render only the thumbnail (poster) — identical look. When a card becomes selected the `<video>` mounts and `preload="metadata"` loads. The existing effects (`watchPicture`, rAF progress, play/pause follow of `playing`) already key off `videoRef.current` and `[playing]`/`[clip.videoUrl, videoError]` — they must be extended with `mountVideo` in deps.

### 5.4 Half sheet: "active clip" view

`half` shows, in one scroll container: the selected card (stacked, `--video-max-h: 26dvh`, centred), then telemetry (§5.6), then **"Other clips"** — a horizontal scroll-snap strip of mini cards (thumbnail 120×68, colour rail, title, duration). The strip is navigation only; every full detail lives on the full card above and in `expanded`. Tapping a mini card = select (card swaps, map flies to route).

### 5.5 Peek bar contents (collapsed)

`[badge colour] Title · place` · `▶/❚❚` · progress line (from `onProgress` frac; uses the same value, driven by a `--frac` CSS var updated through a ref, not React state) · thumbnail. Tapping the bar → `half`. Play/pause calls `onTogglePlay` for the selected clip. If `playingClipId` is set but the selected clip changed, the peek shows the _playing_ clip (so what you hear is what you see).

### 5.6 Telemetry (AltitudeCluster / SpeedCluster / profile) inside the sheet

Today `TrackMap` renders `<ElevationProfile>` under the map and owns `probe`. On mobile:

- `TrackMap` gets `profileHost?: HTMLElement | null`. When provided, `ElevationProfile` is rendered with `createPortal(…, profileHost)` instead of in the `.map-column` flow. A portal keeps component state and `probe` wiring, so playhead → probe → gauges keeps working with **no lifted state**.
- `profileHost` = the `#profile-host` div inside the sheet (visible in `half`/`expanded`, below the selected card).
- The profile "toggle" (`opts.profile`, currently a toolbar icon requiring a selected clip) becomes a "Telemetry" section toggle in the Layers menu; default **on** for mobile when a clip is selected (it is _the_ differentiator: speed, altitude, climb rate while the video plays).
- Hide: `ns-resize` grip, pop-out buttons (`.pane-popover` → `window.open` is hostile on phones), drag-to-split tabs (HTML5 DnD). Keep: tab switch Graph/Speedometer, close.
- `AltitudeCluster` needs no rewrite: its container queries (`max-height:340px` hides tiles/label, `max-height:190px` hides the graph, `max-width:560px` hides dials) already degrade properly in a half sheet. Verify `ElevationProfile` sets `container-type` on its pane (assumed from the CSS, to confirm).
- The Saira `@import url(fonts.googleapis…)` at the top of `AltitudeCluster.css` is render-blocking on mobile networks: move to `<link rel="preconnect">` + `<link rel="stylesheet" media="print" onload>` or self-host.

**Acceptance (Phase 2):** a card on a 360px-wide phone shows every row in the table above; no horizontal scroll; no text clipped without ellipsis; only one `<video>` element exists in the DOM at a time on mobile; delete confirm and "More details" work by touch.

---

## 6. Phase 3 — Map: toolbar, controls, touch behaviour

### 6.1 `MapPanel` compact mode

Props: add `compact?: boolean`, derive from `useLayoutMode`. Real controls are regrouped, none dropped, and `view.*` gating (`search`, `mapStyle`, `layers`, `tools`) is still honoured.

```
Top of map (below app bar)
 ┌─────────────────────────────────────┐
 │ 🔍 Search a place…            [ ◧ ] │   ← search pill + Layers button
 └─────────────────────────────────────┘
```

- **Search** (`PlaceSearch`): same Nominatim type-ahead (4-char min, 350ms debounce, abort controller, combobox ARIA). Collapsed = search pill; focus expands to full width and results list uses full width, `max-height: 40dvh`. The `Enter` forcing a search and `Escape` clear behaviour are kept. Pin to `inputMode="search"`, `enterKeyHint="search"`.
- **Layers button** (icon `layers`, shown if any of `view.mapStyle/layers/tools`) opens a **map menu sheet** (small bottom sheet above the main sheet, z 30; dismiss by tap outside / swipe down):
  1. **Basemap** — 3-way segmented control from `BASES` (Streets / Topo / Satellite).
  2. **Colour by** — segmented `COLORS` (Route colour / Speed / Altitude).
  3. **Points** — segmented `POINTS` (Off / Auto / Every sample). (Gated by `view.mapStyle`.)
  4. **Layers** (switch rows, gated by `view.layers`): Start/end markers, Direction arrows, Hillshade relief, Focus selected clip, Follow playhead, Telemetry/Elevation profile (disabled without selection, as today).
  5. **Tools** (gated by `view.tools`): Measure distance, Fit all clips, Fit selected clip, Fullscreen map, **Export** → GPX / GeoJSON / Map image.
- Implementation: export `BASES`, `COLORS`, `POINTS`, `EXPORTS` and `IconBtn`'s content model from `MapPanel`; the menu reuses the existing `.map-chip` / `.chip-row` styles (already in `ClipToTrack.css` but unused) for segmented choices. The desktop `Dropdown` stays untouched.
- No `data-tip` tooltips in compact mode — every row has a text label.

### 6.2 Fullscreen & export on mobile

- `fullscreen()` uses `closest('.map-column').requestFullscreen()`; **iOS Safari does not support Fullscreen API on non-video elements**. In mobile mode, replace by "Immersive map": collapse sheet + hide app bar/toolbar (a state `immersive` that restores on tap of a floating "Exit" button). Keep real fullscreen where `document.fullscreenEnabled`.
- `download()` of GPX/GeoJSON: on iOS this opens/previews the file; add `navigator.share({files})` when `canShare` (fallback to current download). PNG export relies on `preserveDrawingBuffer: true`, which is expensive on mobile GPUs → on mobile create the map without it and export by `m.once('render', () => canvas.toBlob(...)); m.triggerRepaint()`.

### 6.3 MapLibre native controls

- `NavigationControl({ showCompass:true, visualizePitch:true })`: pass `showZoom: !touch` (pinch/double-tap zoom is native); keep the compass (resets bearing/pitch).
- `GeolocateControl` and `TerrainControl` stay (top-right), positioned **below** the compact toolbar via CSS (`.maplibregl-ctrl-top-right { margin-top: 56px }` on mobile). Respect `view.gps/terrain/zoom/scale` (`hides-*` classes already exist).
- `ScaleControl` + attribution anchored above the sheet (see §4.6).

### 6.4 Touch interaction in `TrackMap`

Read from the real handlers:

- **`mousemove` hover popup / `probe`** — never fires on touch: harmless. During playback the playhead drives `probe`, so gauges still update.
- **`click` handler** (nearest dot within `HIT_PX = 8`, `onSelect`, pins popup) — taps _do_ produce `click`, but 8px is below the ~24px a fingertip needs. Make it `const HIT_PX = isTouch ? 20 : 8` (module const → function of `matchMedia('(pointer: coarse)')`).
- **`tracks-line` click** — depends on the layer's `line-width`. Add an **invisible hit layer** `tracks-hit` (same source, `line-width: 24`, `line-opacity: 0`) and bind click to it on touch, so a thin 3–4px route is tappable. (Check actual width in lines ~420–600 first.)
- **Pinned popup** (`.map-popup.is-pinned`, 288px, close button 24px): on mobile it competes with the sheet. Replace by writing the same `pointPopupHtml(clip, i)` data into the **telemetry panel readout** and a small floating chip ("point 123 · 42 km/h · 1 840 m") instead of a MapLibre popup; keep the dot (`pin` source) on the map. Fallback: keep popup but `closeButton` 32px and `maxWidth: calc(100vw - 32px)`.
- **New callback `onBackgroundTap`** — in the `click` handler when `nearest()` returns nothing and no `tracks-line` feature is hit and `!measuringRef.current` → used for the sheet "step down" rule.
- **Measure tool** — tap adds points (works). Provide Undo/Clear/Done in the existing `.measure-bar` (44px buttons), moved above the sheet.
- **Coordinates readout** (`.map-coordinates`): driven by `mousemove` — stale on touch. On mobile show the **map-centre** coordinate on `moveend` (same copy-on-tap behaviour), default off on mobile.
- **Auto fit on selection** (`useEffect([selectedId, ready])` → `fitBounds(padding 120)`): with `setPadding`, change to `padding: 48`. Add a guard: don't re-fit if the selection came from tapping the route and the route is already fully inside the visible padded bounds (avoids a jarring camera jump when tapping).

**Acceptance (Phase 3):** every desktop map function is reachable on a phone in ≤2 taps; tapping a route within ~20px selects it; the toolbar never covers more than one row of the map.

---

## 7. Phase 4 — Player (video ↔ route as one experience)

### 7.1 Force the in-page modal on mobile

`openMax()` calls `openVideoWindow()`. In mobile mode **skip it** (call `setVideoWin(null)`), so `VideoModal` is used. (Also covers iPad/Chrome Android where `window.open` returns a tab.) `closeMax`, `maxPlaying`, `onProgress → setPlayhead` stay unchanged, so the map playhead keeps moving under the player.

### 7.2 `VideoModal` mobile variant (`layout === 'mobile'`)

Current modal has **no native controls** (click/Space toggles, ←/→ seeks 5s, Esc closes) — unusable by touch. Add:

- Full-bleed `100dvh`, black, `object-fit: contain`, safe-area padding.
- Custom control bar: play/pause, scrubber (`input[type=range]` bound to `currentTime`, buffered shown), `current / duration`, close (44px). Auto-hide after 3s, tap video to show/hide.
- Double-tap left/right third = −5 s / +5 s (mirrors the keyboard shortcut), with a brief ripple.
- **Telemetry HUD**: speed and altitude from `clip.samples[idx]` where `idx = Math.round(frac * (coordinates.length - 1))` — exactly the mapping `setPlayhead` uses, so HUD, map dot and gauges agree. Fields: `speed3dKmh`, `altM`. Hidden when samples lack them (the `GpsPoint` fields are optional).
- **Mini route** in a corner (SVG polyline of `clip.coordinates` + dot at idx) — gives the "video, GPS route and position are one experience" feel inside the player without mounting a second MapLibre.
- Orientation: on open try `screen.orientation.lock('landscape')` (only succeeds in fullscreen on Android Chrome; wrapped in try/catch); iOS: call `video.webkitEnterFullscreen?.()` from an explicit "Fullscreen" button (iOS only allows fullscreen on `<video>`). Portrait remains fully usable (video on top, HUD under it).
- Keep: `autoPlay`, `playsInline`, `onPlay/onPause/onEnded → onPlayingChange`, `onTimeUpdate → onProgress`, `box.current?.focus()`, Esc, backdrop click (backdrop click disabled on mobile; use ✕/back-swipe).
- Android back button: push a history entry on open and close the modal on `popstate`.

### 7.3 Unplayable pictures (HEVC)

`PlaybackHelp` / `stepsFor(BrowserInfo)` only knows `chrome|edge|firefox|safari` × `windows|mac|linux`. A phone falls to the **Linux** branch ("most browsers do not enable VA-API") — wrong. Add:

- `os: 'ios'`: every iOS browser is WebKit; HEVC plays natively → "Update iOS" + `.LRV`/H.264 alternative.
- `os: 'android'`: Chrome HEVC depends on device hardware decoder → "Update Chrome / try the `.LRV` proxy file"; no `chrome://` copy chips (they cannot be opened from a page _and_ are awkward on phones) — hide `CopyChip` on mobile.
- `.help-dialog` becomes a full-width bottom sheet, `max-height: 88dvh`; button 44px.
- Needs `detectBrowser()` to return `ios`/`android` (file not provided → read first).

---

## 8. Phase 5 — Projects, upload, settings, toasts

### 8.1 Project switcher

Real component: `ProjectSelect` (items: "All projects" + each `ProjectView` with `name` and clip count, example badge, keyboard handling, absolutely-positioned list). Mobile: render the same item model in a **bottom picker sheet** (z 30) opened from the app-bar project title; rows ≥ 48px; last rows "＋ New project" (`projects.createProject()` + `setProjectFilter`) and "Manage projects…" (`setProjectsModal({id})`). `ProjectSelect`'s dropdown logic is reused via a `presentation="sheet"` prop rather than rewritten.

### 8.2 Project header in the expanded sheet

`ProjectBar` already renders `ProjectHead` (rename field, chips from `StatChips`, manage, delete with `DeleteConfirm`). In `expanded` it stays exactly as it is, inside `.project-group` (rail, border). In `half`/`collapsed` it is not shown (title is in the app bar). `.project-row` (label "Project" + select + "New") is dropped on mobile because the app bar owns it; "New" lives in the picker.

### 8.3 Moving clips between projects (drag → buttons)

HTML5 DnD (`draggable`, `CLIP_MIME`, `ProjectBar` drag tray, `DropChip`) doesn't work with touch. Mobile:

- `⋯ → Move to project…` opens the picker sheet in "move" mode; selecting a row calls `projects.moveClip(clipId, viewId)`; "＋ New project" calls `moveClip(clipId, 'new')` (the exact contract `onDropClip` already uses: `target` is a view id or `'new'`).
- `ClipCard` gets `draggable={!!onDragStart && !isMobile}`; `ClipToTrack` passes `dragClipId` only on desktop so the tray never appears.
- `ProjectsModal` also has drag handlers (`dragProps`, `drop`) but additionally has `adding`/`asking` state with an add-panel (button-based); verify it covers every move case on touch. Layout: `.detail-panel` → full-screen on mobile (`width/height:100dvh`, radius 0), existing `max-width:640px` rule already stacks list over detail (150px/1fr) — change to a **master→detail navigation** (list screen, tap → detail screen with back arrow) because 150px for the list is too small to use.

### 8.4 Upload and progress

- `UploadZone`: copy "Drag & drop GoPro videos / or click to browse" → on touch "Tap to add GoPro videos". Keep `accept=".mp4,.lrv,video/mp4,.json,application/json"`, `multiple`, the extension filter regex, and the `progress` phases (`index | telemetry | thumbnail`) with `LABEL` and `aria-valuenow`.
- Placement: in `expanded` it stays at the bottom of the list; add a **sticky "Add clips" button** in the sheet header (icon `upload`) so it is reachable without scrolling to the end. With zero clips it is a large centred card.
- Progress visibility: when `busy`, show `progress.name`, `n/of` and the `.progress-bar` in the **peek bar and sheet header**, so a collapsed sheet doesn't hide a multi-GB import.
- Parsing already runs in `mp4.worker.ts` (cancel support via `AbortController`, `progress` messages, transferable telemetry buffers) → main thread stays responsive on phones. Add a **Cancel** affordance in the progress UI (worker already supports `{type:'cancel', requestId}`; confirm that `useClips` exposes it).
- Thumbnail phase decodes a frame via `<video>`; on phones with HEVC this can fail → ensure the clip is still added (route + stats work) with the gradient fallback thumbnail (`--gradient-thumbnail`) and the PlaybackHelp prompt (existing `probeDecode` flow).
- Reload on mobile discards object URLs (documented: "The video file isn't kept after a reload") and mobile tabs are discarded often → the tappable "Re-add video" hint (§5.2) matters more here. See R3.

### 8.5 Settings (`Settings.tsx/.css`)

- Dialog → full-screen sheet on mobile (`100dvh`, radius 0, sticky header with ✕ 44px, `padding-bottom: var(--safe-bottom)`).
- Sections kept: Projects (group toggle, Example project), Map (Satellite default), View · map toolbars (10 toggles + Hide all/Show all), Saved data (Remove all clips with confirm).
- **Hide the "Layout" section** (Reset panel sizes) on mobile; replace with "Sheet starts: collapsed/half" only if wanted later.
- "View · map toolbars" labels refer to "map toolbar"; copy stays, but `search/mapStyle/layers/tools` now map to the compact menu (same semantics).
- Rows already are whole `<label>`s (good tap area); raise to 48px min-height.
- Add "Map credits" row (§4.6 attribution fallback).

### 8.6 Toasts and notices

`ProjectNotice`, `ExampleStatus`, `.toast-message` (fixed `bottom:24px`, z 60): on mobile anchor **top** below the app bar (`top: calc(var(--header-h) + var(--safe-top) + 8px)`) so they never overlap the sheet or peek bar; swipe-to-dismiss optional. The `examplePrompt` (from `useExampleUploadPrompt`) is a dialog — apply the same full-width bottom-sheet treatment (verify its CSS).

---

## 9. Phase 6 — Landscape phone and tablet

- `mobile-landscape` (short, wide): hide the app bar into a 40px strip; **sheet becomes a left side panel** (`width: min(46vw, 420px)`, full height, no snap points — just expand/collapse toggle), map fills the rest. This is effectively the desktop layout with the resizer removed and compact paddings; `clampW`/`panelW` not used.
- Tablet portrait (768–820px): `mobile` layout with larger sheet max-width (`max-width: 640px; margin-inline:auto`) and `--video-max-h: 32dvh`.
- Tablet landscape / desktop ≥ 821px: unchanged `desktop`.
- Rotation: sheet snap preserved by name, `m.resize()` already triggered by the existing `ResizeObserver` on `el.current`.

---

## 10. Cross-cutting concerns

### 10.1 Performance (measure first, then optimise)

| Item                    | Plan                                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playhead per frame      | `ClipCard` rAF → `setPlayhead` runs every frame (GeoJSON `setData` + `setProbe`). On mobile throttle to ~15–20 Hz (`now - last > 50ms`) and skip if the integer sample index and fractional position change < 0.002. Interpolated dot can be animated by CSS/`easeTo`.        |
| Follow playhead         | `jumpTo` each frame is heavy; use throttled `easeTo({duration:100, easing: linear})` only when the dot leaves the inner 60% of the visible area.                                                                                                                              |
| GeoJSON volume          | `toSegments`/`toPoints` create a feature per GPS sample (GoPro GPS ≈ 10–18 Hz → thousands per clip). Measure on a mid-range Android; if slow: simplify segments (Douglas-Peucker, tolerance by zoom) and cap `points: 'all'` on mobile (fall back to `auto`).                 |
| `preserveDrawingBuffer` | off on mobile (see §6.2).                                                                                                                                                                                                                                                     |
| Decoders                | one `<video>` mounted (§5.3).                                                                                                                                                                                                                                                 |
| Fonts                   | Saira via `<link>` not CSS `@import`.                                                                                                                                                                                                                                         |
| Re-renders              | `ClipToTrack` re-renders on every state change; sheet drag must **not** set React state per frame (CSS var via ref). `ClipCard` → wrap in `React.memo` after confirming callbacks are stable (today they're inline arrows — wrap with `useCallback` per clip id or pass ids). |

### 10.2 Accessibility

- Targets ≥ 44px; focus rings unchanged (`3px --home-accent` globally; local `2px --focus`).
- Sheet: button handle, `aria-expanded`, `inert` off-screen content, status announcements (§4.5).
- Modals: `aria-modal`, focus trap + restore (Settings already restores focus; `ProjectsModal`, `PlaybackHelp` only partially — add).
- Colour is never the only signal: clip colour + title + index; "hidden" has eye icon state + `aria-pressed`.
- Reduced motion: sheet, equalizer, badge pulse, pulse on altitude dot (already coded).
- Text zoom to 200%: stats grid and chips must wrap, no fixed heights on text containers.

### 10.3 i18n/units

Strings are hard-coded English today; keep as is. Don't add new inline strings in places that make later extraction harder (use a small `copy` object in each new component).

### 10.4 Offline/PWA (optional follow-up)

Add a manifest + `display: standalone` to remove browser chrome (helps the 100dvh/URL-bar issues); service worker caching of app shell only. Out of scope for v1.

---

## 11. Work breakdown (order matters)

| #   | Phase                                                                 | Main files                                                                             | Depends on        | Est.    |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------- | ------- |
| 0   | Foundations, bug fixes, guards                                        | `index.html`, `styles.css`, `ClipToTrack.tsx/.css`, `Settings.tsx`, `useLayoutMode.ts` | read unseen files | 1–1.5 d |
| 1   | Shell, app bar, bottom sheet, map insets                              | `ClipToTrack.tsx`, new `BottomSheet*`, `useBottomSheet`, `TrackMap.tsx` (`insets`)     | 0                 | 2.5–3 d |
| 2   | Mobile card, video mount policy, peek, half view, other-clips strip   | `ClipCard.tsx`, mobile CSS                                                             | 1                 | 2.5 d   |
| 3   | Map compact toolbar/menu, touch hit areas, controls, immersive/export | `MapPanel.tsx`, `TrackMap.tsx`, CSS                                                    | 1                 | 3 d     |
| 4   | Telemetry portal into sheet                                           | `TrackMap.tsx`, `ElevationProfile`                                                     | 1, 2              | 1.5 d   |
| 5   | Mobile player + HUD + help for iOS/Android                            | `VideoModal.tsx`, `PlaybackHelp.*`, `ClipToTrack.tsx`                                  | 2                 | 3 d     |
| 6   | Projects picker/move, upload UX, settings, toasts                     | `ProjectsModal.*`, `UploadZone.tsx`, `Settings.*`, `ClipToTrack.tsx`                   | 1, 2              | 3 d     |
| 7   | Landscape/tablet                                                      | CSS                                                                                    | 1–6               | 1 d     |
| 8   | Perf, a11y, QA hardening                                              | all                                                                                    | all               | 2–3 d   |

Ship behind a flag (`?mobile=1` / `localStorage clip-to-track:force-layout`) until Phase 6 is complete; `useLayoutMode` honours it so desktop users can test in devtools.

---

## 12. Test plan

**Automated**

- Unit: `useBottomSheet` snap math (velocity, rubber-band, clamp), `useLayoutMode` breakpoints, sheet transition table (§4.3), HUD index mapping (`frac → idx`) against `setPlayhead`'s mapping.
- Component (React Testing Library): `ClipCard` stacked renders every row for a fully populated `Clip` and omits optional rows (`details`, `place`, `videoUrl`) gracefully; mount policy (`<video>` only if selected/playing); keyboard/aria contract unchanged.
- E2E (Playwright, device emulation): iPhone 15 (390×844), Pixel 7 (412×915), iPad portrait, iPhone landscape. Flows: upload sample → card details visible → tap route selects → play → collapse sheet → playhead keeps moving → rotate (video keeps playing, map not re-created: assert same canvas node) → delete → move to project → settings toggles.
- Visual regression on card states: default, selected, playing, hidden, confirming-delete, no-video, video-error, with/without details.
- axe on sheet states and all dialogs.

**Manual (real devices, mandatory)**

- iOS Safari (toolbar collapse/expand, `100dvh`, safe areas, file picker, HEVC playback, `webkitEnterFullscreen`).
- Android Chrome (back button closes player/menu, orientation lock, HEVC variance by device).
- Low-end Android: 60fps sheet drag, 30 fps playhead, memory with 20 clips.
- Slow network: Nominatim search error state ("Search failed — check your connection" exists).

**Definition of done**

- All acceptance criteria per phase pass; no desktop visual diff beyond the 3 bug fixes; `clip-to-track:panel-width` never written on mobile; Lighthouse mobile perf ≥ 85, a11y ≥ 95.

---

## 13. Risks and open questions

| ID  | Risk / question                                                                                                                     | Mitigation / default                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| R1  | Unseen files (`ElevationProfile`, `VideoWindow`, `videoSupport`, `useClips`, `Logo`, `TrackMap` 420–600) may contradict assumptions | Phase 0 reading task; update this plan before Phase 3–5                          |
| R2  | Nested scroll (sheet drag vs list scroll) is the #1 source of bugs                                                                  | Drag only from handle/peek in v1                                                 |
| R3  | Videos are not persisted (object URLs) and mobile tabs reload/discard often                                                         | Tappable re-add, clear messaging; later: File System Access/OPFS where available |
| R4  | iOS has no element fullscreen / orientation lock                                                                                    | Immersive-map state, `webkitEnterFullscreen` for video only                      |
| R5  | GeoJSON volume on phones                                                                                                            | Measure → simplify/cap (§10.1)                                                   |
| R6  | Portalled `ElevationProfile` may rely on `.map-column` sizing (flex column, `max-height: calc(100% - 200px)`)                       | Give it explicit height in the sheet; test with portal early in Phase 4          |
| Q1  | Half sheet: full-width 16:9 video capped at `26dvh` (crop) or letterboxed?                                                          | Default: cap + `object-fit: cover`; revisit after device test                    |
| Q2  | Pinned popup vs telemetry-readout chip on mobile                                                                                    | Default: readout chip (less map occlusion)                                       |
| Q3  | Should "All projects" be the mobile default when more than one project exists?                                                      | Keep desktop logic (`activeProject` falls back to `'all'`)                       |
| Q4  | Clip text search in the list                                                                                                        | Out of scope v1 (not in desktop)                                                 |

---

## 14. Concept ↔ real code mapping (for reviewers)

| Concept item                    | Real implementation in this plan                                             |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Full-screen map + 3-snap sheet  | Existing `<aside class="side-panel">` transformed by `--sheet-y`; snaps §4.3 |
| Tap route → select + open sheet | `TrackMap` `click` / `tracks-line` → `select()` → `half`                     |
| Tap clip → center map           | existing `selectedId` fit effect, now with `setPadding`                      |
| Play → GPS advances             | unchanged `ClipCard.onProgress → mapApi.setPlayhead`                         |
| Tap map → collapse              | new `onBackgroundTap`                                                        |
| Layer selector + overflow menu  | `MapPanel compact` → Layers menu sheet (§6.1)                                |
| Project selector in header      | App-bar project title → picker sheet; `ProjectsModal` for manage (§8.1)      |
| Landscape full-screen player    | `VideoModal` mobile variant + HUD (§7.2)                                     |
| "Compact GoPro media player"    | selected `ClipCard` (stacked) in `half` + telemetry portal                   |
