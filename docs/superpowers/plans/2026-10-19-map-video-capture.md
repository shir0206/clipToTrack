# Landscape Map Video Capture Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Follow the user's explicit instruction: implement the complete feature first; add tests afterward. This is not TDD.

**Goal:** Let a user record the animated map during video playback, review the recording, and explicitly download a landscape MP4.

**Architecture:** Capture a framed portion of the existing MapLibre canvas into a fixed-size composition canvas. Encode timestamped frames into an MP4 locally in the browser. A dedicated capture controller owns recording resources; React components own framing, controls, and preview.

**Tech stack:** Existing React, TypeScript, MapLibre, Vite; WebCodecs H.264 encoding with an MP4 muxing library selected after checking current official documentation and compatibility. Existing Vitest and Playwright for tests added after implementation.

**Design source:** The approved design in this conversation, consolidated below. This document is the implementation plan; no product code changes are included in this task.

## Global constraints and agreed behavior

- Landscape only: 1920 × 1080 pixels, 16:9, constant 25 fps, silent MP4.
- Export the animated map, route, moving marker, and camera movement without a credits overlay. Original GoPro video footage is outside the export.
- Before recording, show the capture frame and dim the excluded map area. Let the user pan and zoom to compose the shot.
- Keep recording controls, elapsed time, and the red indicator outside the captured pixels.
- Stop opens a playable preview with dimensions and duration. Nothing downloads automatically.
- Preview actions: **Download MP4**, **Record again**, and **Discard**. Download MP4 is the user's approval to save the file.
- Browser-local processing; do not upload clips or recordings.
- Implement the feature before writing new tests. Existing checks may run during implementation.
- Preserve existing PNG, GPX, and GeoJSON exports and desktop/mobile playback modes.

## Product decisions for implementation

- Add **Record map · 25 fps** to the map tools. Opening it enters framing mode; **Start recording** is a separate action and requires a selected video clip with a usable route. The current-position option additionally requires active playback.
- Use the largest centered 16:9 rectangle that fits inside the available map stage, with room reserved for controls. On narrow screens the frame becomes smaller, while output remains 1920 × 1080.
- The visible frame represents the exact source crop. Derive crop coordinates from the canvas bounding rectangle and its actual backing dimensions, accounting for device pixel ratio. Scale uniformly without stretching or letterboxing. A small source viewport will produce softer output; do not imply that scaling adds detail.
- Show **1920 × 1080 · 25 fps** beside the frame before recording. Freeze crop geometry during recording; stop and retain the recording if resizing or orientation changes invalidate it.
- Default to **From beginning**: pause and rewind the selected clip, wait for the starting map marker and first captured frame, then resume playback. Offer **From current position** to capture already-playing footage without rewinding. Record the visible map as it evolves in real time. Pause, end, clip replacement, or clip removal stops recording and opens the available preview. Resume requires a new recording.
- Panning and zooming remain available while recording and appear in the output. Other HTML overlays, toolbars, popups, and telemetry charts are excluded. Do not composite a credits strip into the output.
- **Record again** releases the old recording and returns to framing mode. It does not automatically rewind or resume the source video. **Discard** returns to the normal map.
- Unsupported encoding disables Start recording with an actionable explanation. Never rename WebM bytes to `.mp4` or silently substitute a different frame rate.
- A browser tab becoming hidden stops recording and previews completed frames, avoiding a long frozen recording caused by background throttling.

## Review focus

1. Canvas resolution versus CSS size: the downloaded crop must match the visible frame on high-DPI and small screens.
2. Encoder support, tainted canvases, or encoder failure: show an error and release resources without downloading an invalid file.
3. Playback transitions across inline, modal, and popup players: stop once, preserve completed frames, and avoid recording a different clip accidentally.
4. Long sessions, a slow encoder, or background tabs: bound the encoding queue and recording memory; stop clearly instead of accumulating unbounded work.
5. Preview approval and cleanup: stopping must never download; discard, retry, and unmount must revoke URLs and release encoder resources.

## File responsibilities

- Create `src/lib/mapCapture/captureGeometry.ts`: pure 16:9 framing and CSS-to-canvas crop calculations.
- Create `src/lib/mapCapture/mapVideoRecorder.ts`: support detection, fixed-rate frame scheduling, H.264 encoding, MP4 muxing, stop/cancel, limits, and cleanup.
- Create `src/components/MapCapture/MapCapture.tsx` and `MapCapture.css`: framing, capture controls, status/errors, accessible preview dialog, and explicit download action.
- Modify `src/components/TrackMap/TrackMap.tsx`: provide the live map canvas, fresh-render capture hook and playback identity; mount capture UI.
- Modify `src/components/TrackMap/TrackMap.css`: only map-stage integration styles if needed.
- Modify `src/components/MapPanel/MapPanel.tsx`: expose the capture entry in desktop and compact tools.
- Modify `src/components/ClipToTrack/ClipToTrack.tsx` and playback callbacks only as needed to report actual playback state consistently; a requested playing clip is not sufficient evidence that video is running.
- Modify `package.json` and the actively maintained lockfile(s) for the selected muxer, following repository package-manager conventions.
- After implementation, create geometry/recorder unit tests beside their modules and `tests/map-capture.spec.ts` for the user flow.

## Task 1: Confirm encoding and playback integration

- [x] Inspect repository instructions and the current branch/worktree before implementation; retain unrelated user changes.
- [x] Check current primary documentation for WebCodecs H.264 and a maintained MP4 muxer. Choose and document one muxer and its exact version before adding it. Keep it dynamically imported when capture is opened.
- [x] Define `checkMapCaptureSupport(): Promise<{ supported: boolean; reason?: string }>` using actual encoder configuration support at 1920 × 1080, 25 fps, H.264, initially targeting 8 Mbps. Capability-check the required canvas APIs too.
- [x] Trace inline, modal, and popup playback events. Establish a common capture input: `{ clipId: string | null; playing: boolean }`, driven by actual play/pause/end events. Close the recording when the active clip changes.
- [x] Confirm the selected encoder/muxer can produce a short playable 1920 × 1080 MP4 before building the rest of the flow. This is implementation validation, not a new automated test.

## Task 2: Implement framing and the recorder

**Interfaces:** `CaptureRect = { x: number; y: number; width: number; height: number }` in source canvas pixels. `MapRecording = { blob: Blob; durationSeconds: number; frameCount: number; width: 1920; height: 1080; fps: 25 }`.

- [x] Implement `getLandscapeFrame(availableWidth: number, availableHeight: number): CaptureRect` for the centered CSS frame, and `toCanvasCrop(frame: CaptureRect, canvasCssWidth: number, canvasCssHeight: number, canvasWidth: number, canvasHeight: number): CaptureRect` for backing-pixel conversion. Reject empty dimensions and keep the crop inside the canvas.
- [x] Implement `createMapVideoRecorder(options): Promise<MapVideoRecorder>`, with `stop(): Promise<MapRecording>` and `cancel(): void`. Options supply the source canvas, fixed crop, attribution getter, a fresh-render subscription, and status/error callbacks. Stop is idempotent; cancel never returns a recording.
- [x] Copy source pixels immediately after MapLibre renders, including on mobile where `preserveDrawingBuffer` is false. Request fresh renders while recording and retain the latest composited frame for the fixed-rate scheduler.
- [x] Encode sequential frames with timestamps `frameIndex * 40_000` microseconds and duration `40_000` microseconds. Request a keyframe at the start and every two seconds. Close each VideoFrame after submission, flush the encoder before finalizing the MP4, and calculate output duration from encoded frame count.
- [x] Duplicate the latest rendered composition when needed to retain the 25 fps timeline; do not claim the source map itself renders 25 distinct updates each second. Remove or lower the existing 50 ms mobile playhead throttle during recording so it does not unnecessarily limit motion below 25 updates/second.
- [x] Bound encoder queue size to 10 frames. If it remains saturated for one second, stop with an explanation and finalize valid completed frames when possible. Limit a recording to 5 minutes or 256 MiB of accumulated encoded output, whichever occurs first; show the five-minute limit before starting.
- [x] Capture map pixels without compositing a credits strip (approved follow-up). Keep all capture UI outside this composition.
- [x] Handle canvas security errors, unsupported configurations, empty recordings, encoder errors, and cancellation. Always clear scheduling/render hooks and release encoder/frame/muxer references.

## Task 3: Implement the complete recording and approval flow

- [x] Implement explicit UI states: `idle → framing → recording → finalizing → preview`, with error recovery to framing. Disable duplicate Start/Stop actions during transitions.
- [x] Add the desktop and compact map-tool entry. Show framing boundaries, dimming, output format, maximum duration, Start recording, and Cancel. Preserve map pan/zoom interaction within the frame.
- [x] During recording show the red indicator, elapsed time, and **Stop & preview** outside the captured area. Subscribe to actual playback stop/end, clip changes, resize/orientation changes, page visibility, and unmount lifecycle.
- [x] Wire the recorder to TrackMap without putting per-frame capture pixels into React state. Keep integration code small and recording internals in the dedicated module.
- [x] Implement an accessible preview dialog with native video controls, dimensions, 25 fps, duration, and Download MP4 / Record again / Discard. Manage focus, keyboard access, object URLs, and dialog cleanup. Closing preview behaves as Discard.
- [x] Reuse `download` from `src/lib/exportTrack.ts` only when the user clicks Download MP4. Use a sanitized clip title plus `-map-1920x1080-25fps.mp4`. Do not trigger downloads from recorder completion callbacks.
- [x] Finish the entire feature and manually exercise framing → record → stop → preview → download before adding new automated tests.

## Task 4: Add tests after the feature is ready

- [x] Add geometry unit tests covering wide and narrow stages, centered 16:9 framing, high-DPI backing canvases, invalid dimensions, and crop bounds.
- [x] Add recorder unit tests using an injected clock/encoder boundary: 25 frames over one second, 40,000 μs timestamp spacing, frame disposal, idempotent Stop, flush-before-finalize, and no result on Cancel.
- [x] Add lifecycle/error cases: unavailable H.264, canvas read failure, slow encoder queue, recording limits, hidden tab, empty recording, clip replacement, and cleanup after unmount.
- [x] Add browser flow checks for desktop and compact tools: crop overlay, unsupported-browser message, recording status, Stop opening preview without a download, explicit Download MP4 producing a download, and retry/discard releasing the previous preview URL. Use controlled capabilities for UI coverage; retain a real encoding check separately.
- [x] Run unit tests, lint, formatting checks, and production build using the existing repository scripts. Run targeted Playwright capture coverage in Chromium, Firefox, and WebKit; unsupported engines should show the intended message rather than fail unexpectedly.
- [x] Inspect a real downloaded file using `ffprobe` if available, or equivalent MP4 metadata inspection: H.264, 1920 × 1080, average and nominal frame rates 25/1, no audio, and duration matching frame count / 25. Play it to check first/last frames, marker movement, camera movement, exact crop, and attribution.
- [x] Manually verify real recording in supported desktop browsers and mobile where available, including an active popup player. Record any unavailable browser/device verification honestly.

## Completion criteria

The user can see precisely what will be captured, record the live map, preview the resulting silent 1920 × 1080 / 25 fps MP4, and approve its download with a separate click. The file is a valid playable MP4; stop never downloads automatically; unsupported browsers and resource limits produce understandable messages. New tests are written only after the feature is implemented.

## Task 1 execution record — 2026-10-19

- Completed on the user-created `record` branch. Tasks 2–4 have not started.
- Selected and pinned **Mediabunny 1.61.6**, MPL-2.0, using its `EncodedVideoPacketSource` to mux raw WebCodecs H.264 output. `loadMapVideoMuxer()` provides a dynamic import for the later capture entry point.
- Added `checkMapCaptureSupport()` and a shared encoder config in `src/lib/mapCapture/mapVideoRecorder.ts`: HTTPS/localhost, VideoEncoder, VideoFrame, 1080p composition canvas, and actual H.264 config support at 25 fps / 8 Mbps. A successful capability check does not guarantee a later encoder initialization succeeds; Task 2 must still catch runtime failures.
- Added shared actual playback reporting for inline, modal, and popup players. `playing` sets true only after the media `playing` event; pause, end, buffering, seeking, errors, source removal, and unmount report false. Map capture receives `{ clipId, playing }` independently of play commands. Starting inline playback closes the large player so only one player drives map progress.
- Browser probe against the actual support module and installed muxer: Chrome produced and played a **14,667-byte, one-second, 1920 × 1080 H.264 MP4**, 25 packets at 0.04-second intervals, constant/min/max/average rate 25 fps, zero audio tracks, playback reached the end. Synthetic moving pixels were used; live-map framing and recording belong to Tasks 2–3.
- Probe artifacts: `/private/tmp/gopro-map-capture-task1/probe.mp4` and `result.json`. These are temporary local evidence, not shipped application files.
- Existing checks: production build, ESLint, and existing Vitest suite passed (54 tests passed, 6 skipped). No new automated tests were written. Browser proof currently covers Chrome on this machine; other browsers/devices remain to be verified.
- Sources consulted: [Mediabunny writing media files](https://mediabunny.dev/guide/writing-media-files), [encoded video packet source](https://mediabunny.dev/api/EncodedVideoPacketSource), and [WebCodecs configuration support](https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder/isConfigSupported_static).

## Task 2 execution record — 2026-10-19

- Added pure centered landscape framing and CSS-to-backing-canvas crop conversion in `captureGeometry.ts`. The recorder validates that its frozen crop is a 16:9 rectangle inside the source canvas.
- Implemented `createMapVideoRecorder`, `MapRecording`, and the recorder's subscription/status/progress/error interfaces. Repeated Stop returns the same promise; Cancel releases resources and subsequent Stop rejects with AbortError. No downloads occur in this module.
- Added `MapApi.getCaptureSource()` to supply MapLibre's render callback, canvas, fresh repaint requests, current basemap/terrain credits, and a recording flag. Mobile playhead throttling is bypassed while this flag is active. Task 3 will consume this adapter.
- The recorder composites directly during fresh render callbacks, schedules sequential 40,000 μs frames, duplicates the latest composition when necessary, requests keyframes every 50 frames, and draws readable attribution into the exported pixels.
- Limits: ten queued frames/packets, automatic stop after one second of continuous saturation, five minutes, and 256 MiB of encoded packets. Byte-limit stopping drains already-submitted frames, so the finalized file may exceed that threshold by in-flight data and container overhead. Startup without any render fails after ten seconds. A backing-canvas resize finalizes the available recording. UI lifecycle actions and displaying the limit before Start remain in Task 3.
- Validation exposed encoder warmup delaying output on very short recordings. Stop now flushes pending work and completes the captured timeline with the last composition in bounded batches; saturation/byte-limit stops retain submitted footage rather than adding catch-up work.
- Real Chrome/WebGL probe with `preserveDrawingBuffer: false`: a 2048 × 1536 source cropped to `(0, 192, 2048, 1152)` yielded a playable 1920 × 1080 MP4, 27 frames / 1.08 seconds, constant 25 fps and 0.04-second packet durations. Decoded pixels were nonempty; a decoded frame was visually inspected for readable attribution. Repeated Stop, Cancel, render-subscription release, recording-flag reset, and automatic resize stop also succeeded.
- Temporary evidence: `/private/tmp/gopro-map-capture-task1/task2.mp4`, `task2-frame.png`, and `task2-result.json`. The probe is implementation validation outside the repository, not a new automated test suite. Five-minute/byte-limit/slow-device and other-browser coverage remain for Task 4.
- Production build, ESLint, formatting, and the existing unit suite are checked before handoff. No new tests were added. Task 3 has not started.

## Task 3 execution record — 2026-10-19

- Added `MapCapture.tsx` and its styles, mounted from TrackMap, with desktop and compact map-tool entries. Normal map controls are hidden during capture. The dimmed 16:9 frame uses the actual available map stage, leaves room for controls and the mobile sheet, and converts the marked CSS rectangle to source-canvas pixels at Start.
- Implemented framing → starting → recording → finalizing → preview. Start is disabled until encoding support, active playback, a visible route, and enough map space are available. An in-flight start is guarded against repeated clicks and cancellation.
- Controls include format, limits, elapsed time, a red recording indicator, Stop & preview, and Discard. Map pan/zoom remains available inside the frame. Backing-canvas resize, stage/orientation/sheet changes, hidden tab, pause/end, clip changes, and unmount are handled.
- Preview uses a native modal dialog with keyboard focus containment, Escape/Discard, native video controls, dimensions/duration, Download MP4, and Record again. Object URLs and recording resources are released on retry, discard, and unmount. Filenames are sanitized. Download happens only inside the Download MP4 click handler.
- Real app validation in desktop Chrome (1440 × 1000) and mobile Chrome emulation (412 × 915): framing → record → stop → preview → explicit MP4 download succeeded with actual example footage and satellite map rendering. Both probes observed zero downloads before approval and exactly one afterward. Preview metadata reported 1920 × 1080; retry succeeded, pausing the source automatically opened a second preview, and Discard removed capture UI. Screenshots of both layouts were visually inspected.
- One longer probe reached an automatic stop before its scripted manual Stop; the successful full-flow probes used short recordings. Broader lifecycle, long-session, and other-engine coverage remains in Task 4. Mobile validation is emulation, not a physical device.
- Temporary evidence: `/private/tmp/gopro-map-capture-task1/ui-framing.png`, `ui-preview.png`, `mobile-framing.png`, `mobile-preview.png`, and `task3.mp4`.
- Production build, ESLint, formatting, and existing unit checks passed (54 passed / 6 skipped). No new automated tests were added. Task 4 is the remaining planned test work.

## Task 4 execution record — 2026-10-19

- Added 26 unit tests after feature implementation: centered 16:9 framing, high-DPI conversion and crop bounds, invalid inputs, exact frame timing, frame disposal, encoder warmup, idempotent Stop, cancellation including during finalization, empty captures, unsupported configurations, canvas/encoder failures, resize, ten-frame saturation, encoded-byte limit, simulated five-minute limit, no-render timeout, and resource cleanup.
- Post-implementation tests exposed one boundary bug: the previous scheduler submitted a 26th frame at exactly one second. Replaced floor-plus-one with a ceiling count so exactly one second produces 25 frames. Also reject recordings if the encoder emits fewer chunks than submitted frames, rather than returning a misleading fixed-rate result.
- Added `tests/map-capture.spec.ts` and a source-only React fixture. Controlled recorder behavior exercises the real UI across browser engines without requiring a codec for every UI case; a separate unmocked test performs real encoding, MP4 metadata inspection, decoding, and playback. The fixture is outside the production entry and is not built into the application.
- Browser suite: **36 passed** across Chromium, Firefox, and WebKit, covering desktop/narrow framing, explicit download approval, exact preview URL revocation, retry/discard, Escape, unmount and delayed-start cancellation, unsupported encoding, automatic preview on pause/clip change/resize/hidden tab, actual desktop/compact map tools, and real MP4 encoding. Actual map-tool checks use local placeholder tiles to avoid third-party server dependency.
- Real encoder checks passed on all three installed engines: H.264, 1920 × 1080, constant/average frame rate 25 fps, no audio, successful playback through the end, and container duration equal to frame count / 25. Tests skip real encoding with the detected support reason on devices that lack the required encoder; UI unsupported-state coverage still runs.
- Chrome popup-player validation: start playback by clicking in the popup, record the map, preview, explicitly download, retry, pause the popup, and discard all succeeded. Zero downloads occurred before approval and exactly one after. Probe file: `/private/tmp/gopro-map-capture-task1/popup-task4.mp4`. Desktop and mobile-emulation framing/preview screenshots from Task 3 were visually inspected.
- `npm run check` passed: repository formatting, ESLint, **80 unit tests passed / 6 existing tests skipped**, TypeScript, and production build. The existing bundle-size advisory remains. Final independent code review reported no material correctness, resource, or lifecycle findings.
- Limits of verification: mobile coverage is emulation rather than a physical phone; five-minute, byte-limit, and persistent-saturation paths use controlled clocks/encoders. Physical-device and prolonged real-time resource measurements were unavailable and are not claimed.

All four implementation tasks are complete on `record`. Changes remain uncommitted for review; no deployment was performed.

## Approved follow-up: no credits strip and recording from the beginning

- User approved removing the credits strip from exported MP4s and adding **From beginning** (default) / **From current position**. These changes supersede the earlier execution records describing composited credits and requiring playback before all recordings.
- Removed the credits compositor and attribution getter from recording interfaces; the export contains only the framed map pixels.
- Added abortable playback preparation: pause and seek the selected inline/modal/popup video to zero, wait for the map playhead's source update and render, create the recorder, submit its first frame, and only then resume the video. A paused selected clip can start recording without a prior Play click. Current-position recording still requires playback and does not rewind.
- Recorder `ready` resolves after submitting the initial captured map frame. Startup cancellation aborts pending video/map readiness and cancels a late recorder before any playback resume. The framing area reserves room for the position controls on narrow screens.
- Real Chrome validation: began recording from a paused selected clip; playback started at zero. Retried from five seconds and verified playback restarted at zero. Saved `/private/tmp/gopro-map-capture-task1/no-credits-from-zero.mp4`.
- Tests were added after implementation: seven playback-preparation cases and recorder first-frame readiness; browser cases cover default beginning selection, paused start, current-position selection, and beginning playback waiting for the initial captured frame. Real MP4 checks inspect bottom pixels to reject the former credits-strip appearance.
- Verification: **88 unit tests passed / 6 existing tests skipped**, **42 browser cases passed** across Chromium, Firefox, and WebKit, repository formatting/lint/build passed. Final independent review found no material issues. Physical-device coverage remains unavailable.

## Approved visual integration

- Applied the existing site tokens for blue actions, typography, surfaces, borders, focus states, and popover/dialog shadows.
- Replaced wide capture banners with a compact floating configuration panel and centered action bar. Start position uses the site's segmented-control treatment.
- Reused the existing SVG icon component for camera, playback, stop, download, retry, discard, and icon-only dismissal. Icon-only controls retain accessible names and tooltips.
- Matched preview spacing and action hierarchy to the app: secondary discard, retry, and a blue Download MP4 action.
- Frame placement now measures configuration and action panels; mobile consolidates format information and removes redundant hints to leave more map space. Capture controls remain outside exported pixels.
- Visually inspected desktop and 412 × 915 mobile-emulation framing and preview screenshots; exercised recording, preview, download approval, retry, and pause-to-preview in both layouts. Existing regression checks were run; no new tests were added for this styling change.
