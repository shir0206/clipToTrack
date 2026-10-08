# File Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the UI/component files into feature-owned folders, rename unclear modules, remove obsolete leftovers, and keep imports/tests/build passing.

**Architecture:** Keep top-level application orchestration in `src/components/ClipToTrack/`, move feature components into self-named folders, and keep pure domain/data logic in `src/lib/`. Use barrel-free direct imports for now to minimize hidden coupling; add `index.ts` files only if the project already adopts that pattern later.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, ESLint, MapLibre GL.

**Spec:** User request in this task: rename/move `ProjectsUI`, `SettingsDialog`, map components, instrument clusters, clip components, `SvgIcon`, `common`, and ambiguous example/test/data files.

## Global Constraints

- Preserve runtime behavior; this is an organization refactor only.
- Do not delete files unless they are proven unused by `rg` plus a passing `yarn build`/`yarn test`.
- Update all relative imports in the same task as each move.
- Update CSS imports together with their component moves.
- Keep component folders PascalCase: `ClipCard/ClipCard.tsx`, not `clips/ClipCard.tsx`.
- Keep tests near their subject unless they are cross-feature integration tests.
- Remove `.DS_Store` files from source folders and add an ignore rule if needed.
- After moving tests outside `src`, update `vite.config.ts` test include so the moved tests still run.

## Review Focus

- Missing imports after folder moves: `yarn build` must catch all TypeScript path errors.
- Tests silently excluded by config: `yarn test -- --run` or `vitest --list` must prove moved tests are discovered.
- CSS import breakage: components with sibling CSS must still import the new sibling path.
- Icon consolidation: all ordinary UI icons should import `Icon`; inline `<svg>` should remain only for data visualization/gauges/logo artwork.
- Obsolete mock data removal: deleting `src/data.ts` must not remove any live import.

---

## Proposed Target Structure

```text
src/
  components/
    ClipToTrack/
      ClipToTrack.tsx
      ClipToTrack.css
    ProjectsModal/
      ProjectsModal.tsx
      ProjectsModal.css
    Settings/
      Settings.tsx
      Settings.css
    MapPanel/
      MapPanel.tsx
    TrackMap/
      TrackMap.tsx
    ElevationProfile/
      ElevationProfile.tsx
    SpeedCluster/
      SpeedCluster.tsx
      SpeedCluster.css
    AltitudeCluster/
      AltitudeCluster.tsx
      AltitudeCluster.css
    ClipCard/
      ClipCard.tsx
    UploadZone/
      UploadZone.tsx
    VideoModal/
      VideoModal.tsx
    VideoWindow/
      VideoWindow.tsx
    Icon/
      Icon.tsx
    logo/
      Logo.tsx
      Logo.test.tsx
      logo.svg
    playback/
      PlaybackHelp.tsx
      PlaybackHelp.css
    ExampleProject/
      ExampleStatus.tsx
      ExampleUploadPrompt.tsx
      exampleProject.ts
      useExampleProject.ts
      useExampleUploadPrompt.tsx
  config/
    mapDefault.ts
  hooks/
    useClips.ts
    useProjects.ts
  lib/
    clipColorStyle.ts
    discovery.ts
    engineModel.ts
    exports.ts
    exportTrack.ts
    imports.ts
    pointPopup.ts
    projects.ts
    route.ts
    settings.ts
    example/
    gopro/
    gpmf/
    mp4/
    video/
  tests/
    integration/
      clipColorStyle.test.tsx
```

## File Disposition Map

| Current file                                                                                                                 | Destination                                                  | Notes                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/projects/ProjectsUI.tsx`                                                                                     | `src/components/ProjectsModal/ProjectsModal.tsx`             | Rename exported component/types from `ProjectsDialog`/`ProjectsUI` naming to modal naming where public API allows.                         |
| `src/components/projects/ProjectsUI.css`                                                                                     | `src/components/ProjectsModal/ProjectsModal.css`             | Update CSS import in renamed component.                                                                                                    |
| `src/components/settings/SettingsDialog.tsx`                                                                                 | `src/components/Settings/Settings.tsx`                       | Rename default import sites to `Settings`.                                                                                                 |
| `src/components/settings/SettingsDialog.css`                                                                                 | `src/components/Settings/Settings.css`                       | Update sibling CSS import.                                                                                                                 |
| `src/components/map/MapPanel.tsx`                                                                                            | `src/components/MapPanel/MapPanel.tsx`                       | Remove `map/` folder. Update `Settings` import of `loadOpts`.                                                                              |
| `src/components/map/TrackMap.tsx`                                                                                            | `src/components/TrackMap/TrackMap.tsx`                       | Update imports to `MapPanel`, `ElevationProfile`, `Icon`, `settings`, and export helpers.                                                  |
| `src/components/map/ElevationProfile.tsx`                                                                                    | `src/components/ElevationProfile/ElevationProfile.tsx`       | Update imports to `SpeedCluster`, `AltitudeCluster`, `Icon`.                                                                               |
| `src/components/instruments/SpeedCluster/*`                                                                                  | `src/components/SpeedCluster/*`                              | Remove `instruments/`; preserve `Dial` export used by `AltitudeCluster`.                                                                   |
| `src/components/instruments/AltitudeCluster/*`                                                                               | `src/components/AltitudeCluster/*`                           | Remove `instruments/`; update `Dial` import.                                                                                               |
| `src/components/common/SvgIcon.tsx`                                                                                          | `src/components/Icon/Icon.tsx`                               | Rename `SvgIcon` component to `Icon`; keep `IconName` export.                                                                              |
| `src/components/common/Logo.tsx`                                                                                             | `src/components/logo/Logo.tsx`                               | User requested `common` rename to `logo`; only logo assets belong here.                                                                    |
| `src/components/common/Logo.test.ts`                                                                                         | `src/components/logo/Logo.test.tsx`                          | Optional extension rename because it renders React elements.                                                                               |
| `src/components/common/logo.svg`                                                                                             | `src/components/logo/logo.svg`                               | Logo artwork is not part of `Icon`.                                                                                                        |
| `src/components/clip-to-track/ClipToTrack.tsx`                                                                               | `src/components/ClipToTrack/ClipToTrack.tsx`                 | Rename kebab folder to PascalCase.                                                                                                         |
| `src/components/clip-to-track/ClipToTrack.css`                                                                               | `src/components/ClipToTrack/ClipToTrack.css`                 | Update import in component if present.                                                                                                     |
| `src/components/clips/ClipCard.tsx`                                                                                          | `src/components/ClipCard/ClipCard.tsx`                       | Remove `clips/` folder.                                                                                                                    |
| `src/components/clips/UploadZone.tsx`                                                                                        | `src/components/UploadZone/UploadZone.tsx`                   | Remove `clips/` folder.                                                                                                                    |
| `src/components/clips/VideoModal.tsx`                                                                                        | `src/components/VideoModal/VideoModal.tsx`                   | Remove `clips/` folder.                                                                                                                    |
| `src/components/clips/VideoWindow.tsx`                                                                                       | `src/components/VideoWindow/VideoWindow.tsx`                 | Remove `clips/` folder.                                                                                                                    |
| `src/components/clips/clipColorStyle.test.ts`                                                                                | `src/tests/integration/clipColorStyle.test.tsx`              | This test verifies styling across `ClipCard` and `ProjectsModal`, so it is integration, not clip-owned. Requires Vite test include update. |
| `src/components/ExampleStatus.tsx`                                                                                           | `src/components/ExampleProject/ExampleStatus.tsx`            | Example feature UI.                                                                                                                        |
| `src/components/ExampleUploadPrompt.tsx`                                                                                     | `src/components/ExampleProject/ExampleUploadPrompt.tsx`      | Example feature UI; update hook import.                                                                                                    |
| `src/components/ExampleUploadPrompt.test.ts`                                                                                 | `src/components/ExampleProject/ExampleUploadPrompt.test.tsx` | Keep next to component.                                                                                                                    |
| `src/components/exampleProject.ts`                                                                                           | `src/components/ExampleProject/exampleProject.ts`            | Feature-local state/loader for bundled example project.                                                                                    |
| `src/components/exampleProject.test.ts`                                                                                      | `src/components/ExampleProject/exampleProject.test.ts`       | Keep next to example loader.                                                                                                               |
| `src/hooks/useExampleProject.ts`                                                                                             | `src/components/ExampleProject/useExampleProject.ts`         | Move with example feature because only `ClipToTrack` uses it and it depends on example state.                                              |
| `src/hooks/useExampleUploadPrompt.tsx`                                                                                       | `src/components/ExampleProject/useExampleUploadPrompt.tsx`   | Move with example feature.                                                                                                                 |
| `src/components/mapDefault.ts`                                                                                               | `src/config/mapDefault.ts`                                   | It is persisted app config, not a component.                                                                                               |
| `src/data.ts`                                                                                                                | Delete                                                       | Obsolete mock data; duplicates `src/types/index.ts` with a smaller `Clip` shape and has no imports.                                        |
| `src/lib/*`                                                                                                                  | Mostly keep                                                  | See `lib` section below; these are domain/app services, not UI components.                                                                 |
| `src/components/.DS_Store`, `src/components/instruments/.DS_Store`, `src/components/projects/.DS_Store`, `src/lib/.DS_Store` | Delete                                                       | Finder metadata; not source.                                                                                                               |

## What Belongs In `lib`

`src/lib` is not all mess; most files are non-React domain/services and should stay out of `components`.

- Keep `gpmf/`, `mp4/`, `gopro/`, `video/`: parsing, metadata extraction, worker messages, decode probing, thumbnails.
- Keep `discovery.ts` and `imports.ts`: file-system/drop import logic.
- Keep `projects.ts`, `settings.ts`: persisted app services used by hooks/components.
- Keep `route.ts`, `exportTrack.ts`, `exports.ts`, `pointPopup.ts`: route math, export formatting, MapLibre popup HTML.
- Keep `engineModel.ts`: pure instrument domain model used by `SpeedCluster`.
- Keep `clipColorStyle.ts`: shared CSS variable helper used by clip cards, projects modal, video modal, and popup HTML.
- Keep `example/exportExampleMetadata.ts`: dev-only generator used by `ExampleProject/exampleProject.ts`.

Possible later cleanup, not required for this refactor:

- Consider splitting `lib/projects.ts` into `storage/projectsStorage.ts` if it grows further.
- Consider moving `clipColorStyle.ts` to `src/styles/clipColorStyle.ts` only if more style helpers appear. Right now it is shared logic with tests, so `lib` is acceptable.

## Icon Audit

Current componentized icon usage is centralized through `SvgIcon` in these files: `ExampleStatus`, `PlaybackHelp`, `ClipToTrack`, `MapPanel`, `ProjectsUI`, `ElevationProfile`, `TrackMap`, `ClipCard`, `ExampleUploadPrompt`, `VideoModal`, `UploadZone`, `SpeedCluster`, and `SettingsDialog`.

Inline `<svg>` exists in:

- `ElevationProfile.tsx`: chart path visualization. Keep inline; this is data visualization, not a reusable icon.
- `SpeedCluster.tsx`: gauge/dial SVG. Keep inline; this is instrument rendering, not a reusable icon.
- `AltitudeCluster.tsx`: altitude graph/visual. Keep inline; this is instrument rendering.
- `Logo.tsx` and `logo.svg`: keep in `logo/`, not `Icon/`.
- `VideoWindow.tsx`: HTML string contains meta tags and window markup; no reusable UI icon.

Conclusion: after renaming `SvgIcon` to `Icon`, there are no ordinary UI icons that should bypass the component. The existing inline SVGs are specialized visuals and should not be forced into `Icon`.

## Task 1: Remove Source Junk And Obsolete Mock Data

**Files:**

- Delete: `src/data.ts`
- Delete: `src/components/.DS_Store`
- Delete: `src/components/instruments/.DS_Store`
- Delete: `src/components/projects/.DS_Store`
- Delete: `src/lib/.DS_Store`
- Modify if needed: `.gitignore`

**Interfaces:**

- Consumes: current repo state.
- Produces: no source-visible API changes.

- [ ] **Step 1: Verify `src/data.ts` is unused**

Run: `rg "from ['\"]\\./data|from ['\"]\\.\\.\\/data|MOCK_CLIPS|ROUTE_COLOR_TOKENS" src`

Expected: references only inside `src/data.ts` and the real `src/types/index.ts` color tokens.

- [ ] **Step 2: Delete `src/data.ts` and `.DS_Store` files**

Use filesystem removal for the exact files listed above.

- [ ] **Step 3: Add `.DS_Store` to `.gitignore` if it is not already ignored**

Run: `rg "^\\.DS_Store$" .gitignore`

Expected: present after this step.

- [ ] **Step 4: Verify**

Run: `yarn test src/lib/import.test.ts`

Expected: PASS.

## Task 2: Rename `common` To `logo` And `SvgIcon` To `Icon`

**Files:**

- Create/move: `src/components/Icon/Icon.tsx`
- Create/move: `src/components/logo/Logo.tsx`
- Create/move: `src/components/logo/Logo.test.tsx`
- Create/move: `src/components/logo/logo.svg`
- Delete after move: `src/components/common/`
- Modify imports in all files using `SvgIcon` or `Logo`.

**Interfaces:**

- Consumes: existing `SvgIcon` default export and `IconName` type.
- Produces: `Icon({ name, size, ...svgProps })` default export and `IconName` type from `src/components/Icon/Icon.tsx`.

- [ ] **Step 1: Move `SvgIcon.tsx` to `Icon/Icon.tsx` and rename component**

Rename the function to `Icon`, keep `IconName` unchanged, and update the comment to use `<Icon name="play" size={16} />`.

- [ ] **Step 2: Move logo files to `logo/`**

Move `Logo.tsx`, `Logo.test.ts`, and `logo.svg` together. Rename the test to `.tsx` if desired.

- [ ] **Step 3: Update imports**

Replace imports like `../common/SvgIcon` with the correct relative path to `../Icon/Icon` or `../../Icon/Icon`. Replace `../common/Logo` with `../logo/Logo`.

- [ ] **Step 4: Verify ordinary icon centralization**

Run: `rg "SvgIcon|common/SvgIcon|<svg" src/components`

Expected: no `SvgIcon`; remaining `<svg>` only in `Icon`, `Logo`, logo SVG, charts/gauges/instrument renderers.

- [ ] **Step 5: Verify**

Run: `yarn test src/components/logo/Logo.test.tsx`

Expected: PASS.

## Task 3: Rename App Shell And Modal Components

**Files:**

- Move: `src/components/clip-to-track/ClipToTrack.tsx` -> `src/components/ClipToTrack/ClipToTrack.tsx`
- Move: `src/components/clip-to-track/ClipToTrack.css` -> `src/components/ClipToTrack/ClipToTrack.css`
- Move: `src/components/projects/ProjectsUI.tsx` -> `src/components/ProjectsModal/ProjectsModal.tsx`
- Move: `src/components/projects/ProjectsUI.css` -> `src/components/ProjectsModal/ProjectsModal.css`
- Move: `src/components/settings/SettingsDialog.tsx` -> `src/components/Settings/Settings.tsx`
- Move: `src/components/settings/SettingsDialog.css` -> `src/components/Settings/Settings.css`
- Modify: `src/App.tsx`, `src/components/ClipToTrack/ClipToTrack.tsx`, modal import sites.

**Interfaces:**

- Produces: default `ClipToTrack`, default `Settings`, project modal exports from `ProjectsModal.tsx`.

- [ ] **Step 1: Move `ClipToTrack` folder**

Update `src/App.tsx` to import `./components/ClipToTrack/ClipToTrack`.

- [ ] **Step 2: Rename `ProjectsUI` to `ProjectsModal`**

Rename file/CSS. Rename exported dialog component from `ProjectsDialog` to `ProjectsModal` unless doing so creates too much churn; at minimum the file and folder must use `ProjectsModal`.

- [ ] **Step 3: Rename `SettingsDialog` to `Settings`**

Rename file/CSS and default component to `Settings`.

- [ ] **Step 4: Update imports in `ClipToTrack`**

Use new paths for `ProjectsModal`, `Settings`, `Icon`, `logo`, and clip/map components as they are moved in later tasks.

- [ ] **Step 5: Verify**

Run: `yarn build`

Expected: PASS.

## Task 4: Flatten Map And Instrument Components

**Files:**

- Move: `src/components/map/MapPanel.tsx` -> `src/components/MapPanel/MapPanel.tsx`
- Move: `src/components/map/TrackMap.tsx` -> `src/components/TrackMap/TrackMap.tsx`
- Move: `src/components/map/ElevationProfile.tsx` -> `src/components/ElevationProfile/ElevationProfile.tsx`
- Move: `src/components/instruments/SpeedCluster/*` -> `src/components/SpeedCluster/*`
- Move: `src/components/instruments/AltitudeCluster/*` -> `src/components/AltitudeCluster/*`
- Move: `src/components/mapDefault.ts` -> `src/config/mapDefault.ts`
- Modify imports in map/settings/cluster files.

**Interfaces:**

- Produces: existing public exports from each component file; `setSatelliteDefault`, `useSatelliteDefault`, and `satelliteDefault` from `src/config/mapDefault.ts`.

- [ ] **Step 1: Move `mapDefault.ts` to `src/config/mapDefault.ts`**

Update `MapPanel` and `Settings` imports.

- [ ] **Step 2: Move map components into self folders**

Update sibling references: `TrackMap` imports `../MapPanel/MapPanel` and `../ElevationProfile/ElevationProfile`.

- [ ] **Step 3: Move clusters out of `instruments/`**

Update `ElevationProfile` imports to `../SpeedCluster/SpeedCluster` and `../AltitudeCluster/AltitudeCluster`. Update `AltitudeCluster` import of `Dial`.

- [ ] **Step 4: Verify**

Run: `yarn build`

Expected: PASS.

## Task 5: Flatten Clip Components

**Files:**

- Move: `src/components/clips/ClipCard.tsx` -> `src/components/ClipCard/ClipCard.tsx`
- Move: `src/components/clips/UploadZone.tsx` -> `src/components/UploadZone/UploadZone.tsx`
- Move: `src/components/clips/VideoModal.tsx` -> `src/components/VideoModal/VideoModal.tsx`
- Move: `src/components/clips/VideoWindow.tsx` -> `src/components/VideoWindow/VideoWindow.tsx`
- Move: `src/components/clips/clipColorStyle.test.ts` -> `src/tests/integration/clipColorStyle.test.tsx`
- Modify: `vite.config.ts`

**Interfaces:**

- Produces: existing clip component exports from new paths.

- [ ] **Step 1: Move component files**

Update `ClipToTrack` and `ProjectsModal` imports to the new component paths.

- [ ] **Step 2: Move `clipColorStyle.test` to integration tests**

Use `src/tests/integration/clipColorStyle.test.tsx` because it tests style behavior across `ClipCard` and `ProjectsModal`.

- [ ] **Step 3: Update `vite.config.ts` test include**

Change test include from `['src/**/*.test.ts']` to include TSX and the new test folder, for example `['src/**/*.test.{ts,tsx}']`.

- [ ] **Step 4: Verify moved test is discovered**

Run: `yarn test src/tests/integration/clipColorStyle.test.tsx`

Expected: PASS.

## Task 6: Group Example Project Files

**Files:**

- Move: `src/components/ExampleStatus.tsx` -> `src/components/ExampleProject/ExampleStatus.tsx`
- Move: `src/components/ExampleUploadPrompt.tsx` -> `src/components/ExampleProject/ExampleUploadPrompt.tsx`
- Move: `src/components/ExampleUploadPrompt.test.ts` -> `src/components/ExampleProject/ExampleUploadPrompt.test.tsx`
- Move: `src/components/exampleProject.ts` -> `src/components/ExampleProject/exampleProject.ts`
- Move: `src/components/exampleProject.test.ts` -> `src/components/ExampleProject/exampleProject.test.ts`
- Move: `src/hooks/useExampleProject.ts` -> `src/components/ExampleProject/useExampleProject.ts`
- Move: `src/hooks/useExampleUploadPrompt.tsx` -> `src/components/ExampleProject/useExampleUploadPrompt.tsx`
- Modify imports in `ClipToTrack` and moved files.

**Interfaces:**

- Produces: same hooks and example state helpers from `src/components/ExampleProject/*`.

- [ ] **Step 1: Move example UI files**

Update icon import paths and CSS import path for `ExampleUploadPrompt` to `../playback/PlaybackHelp.css`.

- [ ] **Step 2: Move example hooks**

Update their imports from `../components/exampleProject` to local `./exampleProject`, and type imports to `../../types` as needed.

- [ ] **Step 3: Update `ClipToTrack` imports**

Import example hooks/state/status from `../ExampleProject/...`.

- [ ] **Step 4: Verify**

Run: `yarn test src/components/ExampleProject`

Expected: PASS.

## Task 7: Full Import Sweep And Validation

**Files:**

- Modify: any remaining stale imports.
- Modify: docs only if filenames are mentioned in local developer docs.

**Interfaces:**

- Produces: passing lint, tests, and build.

- [ ] **Step 1: Search for old paths and names**

Run:

```bash
rg "ProjectsUI|SettingsDialog|SvgIcon|components/map|components/instruments|components/clips|clip-to-track|components/common|mapDefault" src docs
```

Expected: no stale source imports. Docs may retain historical references only if intentionally descriptive.

- [ ] **Step 2: Run all tests**

Run: `yarn test`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `yarn lint`

Expected: PASS.

- [ ] **Step 4: Run production build**

Run: `yarn build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src vite.config.ts .gitignore docs/superpowers/plans/2026-10-08-file-organization.md
git commit -m "refactor: organize component files"
```

## Open Suggestions / Decisions

- `clipColorStyle.test`: Move to `src/tests/integration/clipColorStyle.test.tsx`; it crosses component boundaries.
- `ExampleStatus.tsx`: Move under `ExampleProject/`; it is not generic status UI.
- `exampleProject.ts`: Move under `ExampleProject/`; it owns bundled-example state, asset discovery, and dev metadata export hook.
- `ExampleUploadPrompt.tsx` and test: Move under `ExampleProject/`; it is a feature modal tied to example-project behavior.
- `mapDefault.ts`: Move to `src/config/mapDefault.ts`; it is persisted app setting state, not UI.
- `data.ts`: Delete; it is unused mock data with a duplicate outdated `Clip` type.
- `lib`: Keep, but treat it as domain/services. The actual cleanup is deleting obsolete `src/data.ts`, moving config/example UI out of random component roots, and removing `.DS_Store`.

## Self-Review

- Spec coverage: every requested rename/move is mapped in the File Disposition Map.
- Step scan: each task has a bounded move set and concrete verification.
- Type consistency: `IconName`, `ClipToTrack`, `Settings`, and map default exports are named consistently across tasks.
- Review focus: build, test discovery, CSS imports, icon audit, and obsolete data deletion are explicitly covered.
- Proportion: the plan is longer than the request because it includes every file disposition and verification command needed for a move-heavy refactor.
