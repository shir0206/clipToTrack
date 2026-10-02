# ClipToTrack Implementation Plan

> **For agentic workers:** Implement this plan phase by phase. Keep every phase runnable and verify its acceptance criteria before starting the next phase.

**Goal:** Build a private, client-side web application that reads GoPro MP4/LRV files in the browser, decodes their GPMF telemetry, visualizes routes and sensor data, and exports useful geographic and tabular formats without uploading source files.

**Architecture:** Use Vite, React, and TypeScript as a static web application. A dedicated Web Worker reads bounded ranges from browser `File` objects, extracts the MP4 `gpmd` track, decodes GPMF records, and sends normalized telemetry to the UI using structured-clone messages and transferable buffers. Raw readings remain available alongside filtered and derived data.

**Primary platform:** Current desktop browsers, led by Chrome, Edge, and Safari. The core single-file workflow must also work in Firefox; enhanced folder and save-picker features use capability detection and fallbacks.

**Reference:** [`gopro_gps_extraction_guide.md`](./gopro_gps_extraction_guide.md)

## Why a Client-Side Web App

A client-side web application is the selected product shape because it requires no installation and can process telemetry locally through browser file APIs. Video and telemetry must never be uploaded to an application server. The parser will read only required byte ranges with `File.slice()` so large recordings are not loaded into memory as one buffer.

Folder selection and direct save dialogs are progressive enhancements. Browsers without the File System Access API will use multi-file input, drag-and-drop, and normal browser downloads. Parsing and export must still work with those fallbacks.

Online map tiles reveal the viewed tile coordinates to the tile provider. The application must explain this clearly and offer a route-only view with no remote tiles. Application hosting must be static and must not include telemetry upload endpoints.

## Confirmed Reference Files

The supplied pair provides the initial acceptance fixture:

| File | Purpose | Size | Video |
|---|---|---:|---|
| `GX010753.MP4` | Full-resolution recording | 81,531,691 bytes | HEVC, 5312×2988 |
| `GL010753.LRV` | Low-resolution proxy | 1,057,754 bytes | HEVC, 768×432 |

Both recordings are 6.48 seconds long and contain four tracks: video, AAC audio, timecode, and GoPro `gpmd` metadata. Their extracted `gpmd` sample streams are byte-for-byte identical.

Known fixture values:

- Camera: HERO13 Black
- Firmware: `H24.01.02.10.00`
- GPS samples: 65, approximately 10 Hz
- GPS time: `2026-09-21T08:36:35.300Z` through `2026-09-21T08:36:41.700Z`
- GPS fix: 3 for every reference point
- GPS DOP: 1.37
- Latitude: 47.2899587 to 47.2900426
- Longitude: 12.6970259 to 12.6976327
- Altitude: 791.845 to 793.361 metres above mean sea level
- 2D speed: 4.794 to 10.626 m/s
- Raw haversine distance: approximately 46.71 metres
- Accelerometer: approximately 200 Hz
- Gyroscope: approximately 200 Hz
- Camera/image orientation and gravity: approximately 25 Hz

## Product Scope

### First Release

- Open individual files or scan a folder.
- Pair MP4, LRV, and THM files belonging to the same clip.
- Prefer LRV telemetry and fall back to MP4.
- Decode GPS9, GPS quality, timestamps, accelerometer, gyroscope, gravity, orientation, exposure, ISO, white balance, temperature, luminance, wind processing, and audio-level telemetry.
- Display the route on an interactive map.
- Display synchronized telemetry charts.
- Show raw and optionally smoothed GPS routes.
- Calculate distance, duration, speed, elevation gain/loss, and GPS-quality summaries.
- Export GPX, CSV, GeoJSON, and complete JSON.
- Keep all source files and telemetry local.

### Later Releases

- Join consecutive GoPro chapter files into one activity.
- Batch export folders.
- Installable Progressive Web App behavior and cached application assets.
- Optional offline or user-provided map tiles where browser storage permits.
- Video playback synchronized with map and chart cursors.
- Additional browser performance tuning and WebAssembly only if profiling shows it is needed.

## Core Data Model

The parser must preserve the camera data before deriving summaries.

```text
GoProClip
├── source files and pairing information
├── camera and recording metadata
├── media track information
├── telemetry streams
│   ├── GPS samples
│   ├── motion samples
│   ├── orientation samples
│   ├── imaging samples
│   └── audio/environment samples
├── raw route
├── processed route
└── derived statistics
```

Every telemetry sample should contain:

- Stream key and human-readable name
- Timestamp relative to the clip
- Absolute UTC timestamp when available
- Typed values
- Units
- Scaling information used during decoding
- Source file and source sample index

Unknown GPMF keys must be retained in the full JSON export instead of causing an import failure.

---

## Phase 1: Web Project Foundation and File Discovery

**Outcome:** A runnable static web application can accept files or folders and identify GoPro clip groups entirely in the browser.

### Work

- [x] Scaffold Vite, React, TypeScript, Vitest, and the browser test runner.
- [x] Establish formatting, linting, and CI commands.
- [x] Add drag-and-drop and standard `<input type="file" multiple>` selection.
- [x] Add optional directory selection using `webkitdirectory` and the File System Access API when supported.
- [x] Detect browser capabilities and select fallbacks without blocking import.
- [x] Recognize `.MP4`, `.LRV`, and `.THM` case-insensitively.
- [x] Parse GoPro filename roles such as `GX010753`, `GL010753`, and matching thumbnails.
- [x] Group related files into one logical clip.
- [x] Select LRV as the telemetry source when available; otherwise select MP4.
- [x] Show file size, selected telemetry source, and pairing warnings.

### Verification

- [x] The supplied three files appear as one logical clip.
- [x] `GL010753.LRV` is selected for telemetry.
- [x] An MP4 without an LRV remains importable.
- [x] Unrelated files are ignored without failing the folder scan.
- [x] Unit tests cover uppercase/lowercase extensions and incomplete clip groups.
- [x] Import works in browsers without the File System Access API.

---

## Phase 2: Incremental MP4 Container Reader

**Outcome:** The Web Worker locates media tracks and reads `gpmd` samples from browser `File` objects without loading the complete video into memory.

### Work

- [x] Implement safe ISO Base Media File box traversal.
- [x] Support normal and 64-bit box sizes.
- [x] Read movie and track headers, durations, dimensions, handlers, and sample descriptions.
- [x] Locate the `gpmd` metadata track.
- [x] Decode `stsz`, `stsc`, `stco`, and `co64` sample tables.
- [x] Read metadata ranges with `File.slice()` and `Blob.arrayBuffer()`.
- [x] Run all container parsing in a module Web Worker.
- [x] Define request, progress, result, cancellation, and error worker messages.
- [x] Transfer large `ArrayBuffer` results instead of copying them where practical.
- [x] Read relevant `udta` fields such as camera model, firmware, creation time, and coordinate summary.
- [x] Return structured errors for truncated boxes, invalid offsets, and absent telemetry.

### Verification

- [x] Both supplied files report a duration of 6.48 seconds.
- [x] MP4 video reports 5312×2988; LRV reports 768×432.
- [x] Both expose `vide`, `soun`, `tmcd`, and `meta/gpmd` tracks.
- [x] Seven `gpmd` samples are located in each reference file.
- [x] Reading telemetry uses bounded browser memory on a multi-gigabyte test file.
- [x] Cancelling an import terminates pending work and releases file references.
- [x] Malformed offsets are rejected without panics or out-of-range reads.

---

## Phase 3: GPMF Decoder

**Outcome:** Raw GPMF records are decoded into typed, scaled telemetry streams.

### Work

- [x] Parse the GPMF KLV header, payload length, repetition count, and four-byte padding.
- [x] Recursively decode `DEVC` and `STRM` containers.
- [x] Support signed and unsigned integers, floats, doubles, strings, FourCC values, and complex structures.
- [x] Apply `TYPE`, `SCAL`, `UNIT`, `SIUN`, `ORIN`, and stream timestamps.
- [x] Decode GPS9 fields: latitude, longitude, altitude, 2D speed, 3D speed, days since 2000, seconds since midnight, DOP, and fix.
- [x] Add a compatibility adapter for older GPS5 recordings.
- [x] Decode motion, orientation, imaging, environment, and audio streams.
- [x] Preserve unknown keys and their raw payloads.
- [x] Expose telemetry through versioned TypeScript domain and worker-message types.

### Verification

- [x] MP4 and LRV produce identical normalized telemetry for the supplied pair.
- [x] The telemetry hash comparison confirms their raw `gpmd` samples match.
- [x] The reference clip yields 65 GPS9 points.
- [x] The reference GPS fix is 3 and DOP is 1.37.
- [x] Accelerometer and gyroscope streams are approximately 200 Hz.
- [x] Unknown keys are retained for full JSON output without breaking known streams.
- [x] Tests cover scaling arrays, complex structures, padding, nesting, and truncated records.

---

## Phase 4: GPS Validation, Smoothing, and Statistics

**Outcome:** The application produces trustworthy raw and processed routes with clear quality information.

### Work

- [x] Preserve the raw route exactly as decoded.
- [x] Validate coordinate ranges and timestamps.
- [x] Exclude points without a configurable minimum GPS fix.
- [x] Add a configurable maximum DOP threshold.
- [x] Detect duplicate timestamps and impossible location jumps.
- [x] Calculate segment distance with a geodesic method.
- [x] Calculate duration, moving time, average speed, maximum speed, ascent, and descent.
- [x] Implement optional smoothing using a conservative Kalman filter or equivalent time-aware filter.
- [x] Keep smoothing disabled by default in exports unless the user selects the processed route.
- [x] Record why every rejected point was excluded.

### Verification

- [x] The supplied raw route contains 65 accepted points.
- [x] Its GPS time span is 6.4 seconds.
- [x] Its raw distance is approximately 46.71 metres within an agreed geodesic tolerance.
- [x] Its maximum 2D speed is approximately 38.25 km/h.
- [x] Raw values never change when smoothing settings change.
- [x] Tests cover no fix, poor DOP, stationary jitter, time gaps, duplicate timestamps, and impossible jumps.

---

## Phase 5: Route Map and Telemetry Interface

**Outcome:** Users can inspect a clip, its route, its quality, and its sensor streams interactively.

### Work

- [ ] Create the file/folder import view and clip list.
- [ ] Add a map with route, start/end markers, auto-fit bounds, and raw/processed toggles.
- [ ] Add a summary panel for distance, duration, speed, altitude, fix quality, and DOP.
- [ ] Add synchronized charts for speed, altitude, DOP, acceleration, gyro, and orientation.
- [ ] Add a shared timeline cursor between the map and charts.
- [ ] Add a metadata explorer listing every decoded stream, unit, sample count, and frequency.
- [ ] Surface parsing and GPS-quality warnings without hiding usable data.
- [ ] Use inline SVG icons and accessible controls.
- [ ] Keep parsing in the Web Worker and report progress for large clips.
- [ ] Do not depend on HEVC playback: show the THM preview when the browser cannot decode the MP4/LRV video track.
- [ ] Provide a no-basemap mode that draws the route without requesting remote tiles.

### Verification

- [ ] The reference route fits the map automatically.
- [ ] Hovering a chart highlights the corresponding map position.
- [ ] Raw and processed routes can be compared without re-importing the file.
- [ ] No-GPS clips still display their available motion and camera metadata.
- [ ] Keyboard navigation and screen-reader labels cover primary controls.
- [ ] Large imports do not freeze the interface.
- [ ] Unsupported HEVC playback does not prevent telemetry inspection or export.

---

## Phase 6: Export Formats

**Outcome:** Users can export both standard routes and complete telemetry.

### Work

- [ ] Export GPX 1.1 track points with UTC time and elevation.
- [ ] Include speed and GPS-quality extensions where supported.
- [ ] Export configurable CSV columns.
- [ ] Export GeoJSON with route geometry and summary properties.
- [ ] Export versioned JSON containing raw streams, processed routes, units, source metadata, and exclusions.
- [ ] Let the user choose raw or processed GPS for route exports.
- [ ] Use deterministic number and timestamp formatting.
- [ ] Generate exports as Blob objects and revoke object URLs after download.
- [ ] Use `showSaveFilePicker()` when available and browser downloads otherwise.

### Verification

- [ ] GPX validates against the GPX 1.1 schema.
- [ ] GPX contains 65 points when exporting the supplied raw route.
- [ ] CSV rows and headers remain aligned for optional fields.
- [ ] GeoJSON opens in a standard mapping tool.
- [ ] Full JSON retains non-GPS telemetry and unknown GPMF fields.
- [ ] Export tests are deterministic across time zones and operating systems.
- [ ] Export works without the File System Access API.

---

## Phase 7: Chapter Joining and Batch Workflows

**Outcome:** Consecutive camera chapters can be treated as one activity and folders can be processed efficiently.

### Work

- [ ] Detect GoPro chapter sequences from filenames and recording timestamps.
- [ ] Confirm camera identity and temporal continuity before joining.
- [ ] Deduplicate overlapping boundary samples.
- [ ] Preserve per-clip provenance for every joined sample.
- [ ] Show gaps and discontinuities on the map and timeline.
- [ ] Add batch export with collision-safe output names.

### Verification

- [ ] Continuous chapters join in chronological order.
- [ ] Clips from different cameras are not joined automatically.
- [ ] Time gaps remain explicit instead of being silently smoothed over.
- [ ] Batch cancellation leaves existing source files untouched.

---

## Phase 8: Web Deployment and Release Readiness

**Outcome:** A static production build is deployable to ordinary HTTPS hosting and remains fully client-side.

### Work

- [ ] Add application icons, versioning, production configuration, and a restrictive Content Security Policy.
- [ ] Produce static HTML, JavaScript, CSS, worker, and asset files with no application backend.
- [ ] Ensure Web Worker assets load correctly under the configured deployment base path.
- [ ] Add local-only diagnostic logging with no automatic uploads.
- [ ] Document supported cameras, browsers, formats, known limitations, and privacy behavior.
- [ ] Add a user-triggered diagnostic JSON export that excludes precise GPS coordinates by default.
- [ ] Add an optional PWA manifest and cache only application assets; never cache imported source videos implicitly.
- [ ] Run performance tests with long and multi-gigabyte recordings in supported browsers.
- [ ] Test production builds in current Chrome, Edge, Firefox, and Safari.
- [ ] Configure static hosting so security headers, MIME types, and worker scripts function correctly.

### Verification

- [ ] The production build runs from ordinary HTTPS static hosting.
- [ ] Browser developer tools show no upload of video or telemetry data.
- [ ] The installed PWA, when enabled, opens offline and can parse local files without a network connection.
- [ ] Route-only mode works without contacting an online map provider.
- [ ] Source videos are never modified.
- [ ] No telemetry is transmitted by the application.
- [ ] Parser and export regression suites pass against the minified production build.

## Test Strategy

- **Unit tests:** MP4 box parsing, sample-table resolution, GPMF types/scaling, GPS conversion, filters, statistics, and export formatting.
- **Golden fixture tests:** The supplied MP4/LRV pair and small extracted `gpmd` fixture segments with known results.
- **Property tests:** Randomly nested and truncated boxes/KLV records must fail safely without panics.
- **Integration tests:** Browser `File` input through normalized telemetry and each export format.
- **Worker tests:** Message contracts, progress, cancellation, transferable buffers, and structured errors.
- **UI tests:** Drag-and-drop, map/chart synchronization, warning states, settings, and export selection.
- **Browser tests:** Chrome, Edge, Firefox, and Safari capability fallbacks.
- **Performance tests:** Long recordings, large selections, bounded memory, cancellation, and UI responsiveness.

## Important Product Rules

- Never modify source MP4, LRV, or THM files.
- Never upload telemetry or videos; all parsing and export stay in the browser.
- Always retain the raw decoded values.
- Clearly label processed and smoothed results.
- Prefer LRV only after confirming it contains a usable `gpmd` track.
- Fall back to MP4 automatically when the LRV is missing or damaged.
- Treat GPS fix and DOP as visible data-quality measurements, not hidden implementation details.
- Generate GPX from decoded GPS; do not imply GPX is embedded in the source file.
- Keep parser behavior forward-compatible by retaining unknown GPMF fields.
- Treat remote map tiles as an explicit network feature and keep a no-basemap option available.
- Do not require HEVC browser support for telemetry parsing.

## Suggested Delivery Milestones

1. **Telemetry worker proof:** Phases 1–3 with a minimal browser harness; imports the supplied files and displays fixture summaries and JSON.
2. **Usable route viewer:** Phases 4–5 with map, charts, and GPS-quality controls.
3. **First hosted release:** Phase 6 plus static deployment work from Phase 8.
4. **Power-user release:** Phase 7, batch processing, PWA support, and optional offline maps.

The first milestone should be completed before investing heavily in interface design. It proves that the parser handles the supplied HERO13 GPS9 data and establishes stable types for every later phase.
