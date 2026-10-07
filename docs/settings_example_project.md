# Example project (2-3 bundled clips, pre-baked telemetry)

## Goal

First-time visitors get a ready project, named `Example <trip> in Tyrol/Austria`, with 2-3 sample clips.
Nothing is parsed or downloaded at runtime, and it can be switched off in Settings.

## Design

| Concern      | Before                                    | Now                                                                                                                                   |
| ------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Videos       | 300 MB, downloaded, kept in Cache Storage | ~3 MB each, static files in `public/assets/examples/`, used directly as `videoUrl` (the browser streams them on play)                 |
| Telemetry    | Parsed from the MP4 in a worker           | **Pre-made JSON** (`ClipMetadata`) in `src/data/example/`, lazy-loaded (own chunks, not in the main bundle)                           |
| Thumbnail    | Captured from the video on import         | Pre-made `.jpg` in `public/assets/examples/`, stored as a URL (not a data URL) so localStorage stays small                            |
| Clip list    | Hardcoded URL list                        | **Driven by the JSON files**: `src/data/example/<name>.json` -> `<name>.mp4` + `<name>.jpg`. Add/remove a clip = add/remove its files |
| Import       | `addFiles(files)`                         | new `addPrepared(items)` in `useClips` (same merge/slot logic via a shared helper, no parsing)                                        |
| After reload | videos re-read from Cache Storage         | `videoUrl` re-attached from the static URL (kept in the example state)                                                                |
| Name         | "... in Tyrol, Germany"                   | "... in Tyrol/Austria"                                                                                                                |

## File layout

```
public/assets/examples/GX010917.mp4   (you add)
public/assets/examples/GX010917.jpg   (generated)
src/data/example/GX010917.json        (generated)
... same for each clip (2-3)
```

The base name must match across the three files **and** the MP4 file name used when generating the JSON
(the clip id = file name + GPS start).

## Missing-file reporting

`loadExampleClips()` returns `missing[]` (JSON without video/thumbnail, or no JSON at all).

- nothing usable -> error toast "Couldn't load the example project" listing the files
- some assets missing -> the clips that can be added are added; the toast lists what is missing
- also `console.warn` in dev

## Generating the JSON + thumbnails (one-off, dev only)

1. `npm run dev`, open the app, open the browser console.
2. Run `exportExampleMetadata()` and pick the 2-3 MP4s.
3. It downloads `<name>.json` (track thinned to 1000 points) and `<name>.jpg` per clip.
4. Move `.json` -> `src/data/example/`, `.jpg` + `.mp4` -> `public/assets/examples/`.
   (The helper only exists when `import.meta.env.DEV`.)

## Settings / persistence

- The switch (`enabled` in example state) is the only thing that keeps the example away.
- **On every start**, if `enabled` and the example is not in the library (never added, project deleted, or any of its clips deleted), it is added again with a new random name. Other clips in the library don't matter.
- Deleting the project/clips by hand does **not** turn the switch off; the switch always shows the preference.
- Off = removes only the example's clips (and the project if nothing else is in it) and stops it coming back.
- A leftover project from a half-deleted example is replaced, not duplicated.
- Side effect: "Remove all clips" in Settings also removes the example, and it returns on the next refresh unless the switch is off.

## Code changes

- `components/exampleProject.ts`: name, state (+ `videos` map), loader, dev hook
- `lib/example/exportExampleMetadata.ts`: dev generator
- `hooks/useClips.ts`: `mergeEntries` helper, `addPrepared`, `attachVideo(id, File | string)`
- `hooks/useExampleProject.ts`: no download phase, uses `addPrepared`
- `components/ExampleStatus.tsx`, `settings/SettingsDialog.tsx`: texts (no "300 MB")
- **App wiring**: pass `addPrepared` (from `useClips()`) to `useExampleProject` instead of `addFiles`.
- `components/exampleProject.ts` should probably live in `lib/` (it is not a component); kept in place so no imports change.
