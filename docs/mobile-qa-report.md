# Mobile Visual QA Report

Tested on 2026-10-09 against the local Vite app at `http://127.0.0.1:4173/clipToTrack/`.

## Executive Summary

Overall mobile UX is visually polished and the main map/card composition adapts across portrait and landscape without page-level horizontal overflow. The biggest risk is scrolling: the portrait clip sheet is technically scrollable by script, but real touch-drag input did not move the sheet content during the audit. This means mobile users may be unable to reach lower clip details or other clips through normal touch scrolling.

Confirmed findings by severity:

- Critical: 0
- High: 1
- Medium: 3
- Low: 3

Most significant scrolling issue: the `.sheet-body` nested scroll container did not respond to CDP touch-drag gestures at 390x844, despite having hidden page scroll and 443 px of additional sheet content.

Most significant sizing/usability issues: MapLibre controls and attribution/coordinate controls are below the preferred 44x44 px mobile touch target, and in portrait several controls are partly hidden behind the fixed header/sheet composition.

Coverage included 360x800, 375x812, 390x844, 430x932, and 844x390 landscape. I inspected screenshots, measured element bounds, reviewed scroll containers, opened Settings, checked console warnings/errors, checked failed network requests, and validated scroll boundaries programmatically. Browser-toolbar collapse and a real OS keyboard were not available in the headless Playwright environment.

## Findings

### MQA-001: Clip Sheet Does Not Scroll With Touch Drag

- Severity: High
- Category: Scrolling / nested scroll
- Screen and viewport: Main clip sheet, 390x844 portrait
- Status: Confirmed
- Evidence: `../qa/screenshots/390x844-01-top.png`, `../qa/screenshots/390x844-after-real-touch-scroll.png`, `../qa/screenshots/390x844-sheet-bottom-programmatic.png`
- Steps to reproduce:
  1. Open the app at 390x844 mobile emulation.
  2. Start on the main map with the clip sheet visible.
  3. Drag upward inside the sheet body from near the bottom toward the middle.
  4. Check `.sheet-body.scrollTop`.
- Expected: The sheet content should scroll toward the lower card details and other clips.
- Actual: `.sheet-body` stayed at `scrollTop: 10` after the upward touch drag, while its max scroll was `443`.
- Impact: Users may be trapped at the top of the sheet and unable to reach details or other clips by normal thumb scrolling.
- Suggested fix: Review gesture handling on the bottom sheet drag handle/container. Ensure touch movement inside `.sheet-body` is allowed to scroll content and is not intercepted by sheet snap or map gesture listeners. Consider applying `touch-action: pan-y` to the scrollable body and limiting snap drag handling to the handle/chrome.

### MQA-002: Map Controls Are Below Mobile Touch Target Size

- Severity: Medium
- Category: Touch targets
- Screen and viewport: Map controls, all tested mobile sizes
- Status: Confirmed
- Evidence: `../qa/screenshots/390x844-01-top.png`, `../qa/screenshots/landscape-844x390-01-top.png`
- Steps to reproduce:
  1. Open any tested viewport.
  2. Inspect map controls such as compass/location/terrain.
  3. Measure their bounding boxes.
- Expected: Frequent controls should provide roughly 44x44 CSS px tappable targets.
- Actual: MapLibre controls measured around 29x29 px in portrait and landscape.
- Impact: These controls are hard to tap reliably with a thumb, especially near screen edges.
- Suggested fix: Wrap or override map control buttons to provide at least 44x44 px hit areas while preserving the visual icon size.

### MQA-003: Map Controls Are Partly Offscreen Or Obscured In Portrait

- Severity: Medium
- Category: Fixed/sticky overlap
- Screen and viewport: Portrait map, 360x800, 375x812, 430x932
- Status: Confirmed
- Evidence: `../qa/screenshots/360x800-01-top.png`, `../qa/screenshots/375x812-01-top.png`, `../qa/screenshots/430x932-01-top.png`
- Steps to reproduce:
  1. Open a portrait viewport.
  2. Observe the right-side map controls before interacting with the sheet.
  3. Inspect measured control positions.
- Expected: Map controls should stay fully visible and tappable outside the header and bottom sheet.
- Actual: Controls had negative y positions in several portrait viewports, for example 360x800 compass at `y: -22`, 375x812 terrain at `y: -18`, and 430x932 location at `y: -8`.
- Impact: Users lose access to map functions or must tap partially visible controls.
- Suggested fix: Recompute map control insets for the mobile sheet/header layout. Apply safe top offsets that account for the fixed header and the map’s translated/covered area.

### MQA-004: Landscape Clip Panel Consumes Too Much Vertical Space

- Severity: Medium
- Category: Mobile sizing / screen-space efficiency
- Screen and viewport: Landscape, 844x390
- Status: Confirmed
- Evidence: `../qa/screenshots/landscape-844x390-01-top.png`, `../qa/screenshots/844x390-sheet-absolute-bottom.png`
- Steps to reproduce:
  1. Open 844x390 landscape.
  2. Review the left clip panel.
  3. Scroll to bottom.
- Expected: Landscape should show a compact, task-focused clip summary with enough vertical room to scan multiple clips or key details.
- Actual: One clip card is about 538 px tall in a 334 px panel. Users see less than one full card at a time and must scroll extensively.
- Impact: The landscape layout feels like portrait cards squeezed into a short side panel, reducing comparison and navigation efficiency.
- Suggested fix: Use a denser landscape card variant: smaller thumbnail ratio, compact telemetry rows, and collapsed secondary metadata by default.

### MQA-005: Attribution And Coordinate Controls Are Too Small

- Severity: Low
- Category: Touch targets / map chrome
- Screen and viewport: Map attribution and coordinate readout, all tested sizes
- Status: Confirmed
- Evidence: `../qa/screenshots/390x844-01-top.png`, `../qa/screenshots/landscape-844x390-01-top.png`
- Steps to reproduce:
  1. Open any tested viewport.
  2. Inspect the map attribution and coordinate widgets.
- Expected: If these are interactive controls, they should be readable and tappable; if informational only, they should not be exposed as buttons.
- Actual: Attribution was about 121x28 px and the coordinate widget about 167x19 px.
- Impact: Small controls are difficult to tap and may create accidental accessibility/touch target violations.
- Suggested fix: Increase touch padding to 44 px high or render non-interactive readouts as text with separate accessible controls where needed.

### MQA-006: Header Project Title Truncates Aggressively

- Severity: Low
- Category: Typography / information density
- Screen and viewport: Portrait header, 360x800 through 390x844
- Status: Confirmed
- Evidence: `../qa/screenshots/390x844-01-top.png`
- Steps to reproduce:
  1. Open 390x844 portrait.
  2. Observe the header project selector.
- Expected: The active project should remain identifiable, or use a shorter mobile label.
- Actual: Titles such as "Weekend in Tyrol/Austria" are truncated to "Weekend in Tyrol/..." in the main header.
- Impact: Low functional risk, but it reduces context in a project-based workflow.
- Suggested fix: Consider a two-line compact selector, shorter generated project names, or moving the full project title into the sheet header while using a concise nav label.

### MQA-007: Settings Dialog Is Long And Dense On Mobile

- Severity: Low
- Category: Mobile UX / proportions
- Screen and viewport: Settings, 390x844 portrait
- Status: Confirmed
- Evidence: `../qa/screenshots/390x844-settings-modal.png`
- Steps to reproduce:
  1. Open 390x844 portrait.
  2. Tap Settings.
  3. Review the first viewport and scrollable dialog metrics.
- Expected: Settings should be easy to scan and grouped for mobile.
- Actual: The dialog is scrollable to 1193 px and exposes many toggle rows in a single long list. The first viewport is readable, but dense.
- Impact: Discoverability is acceptable, but changing map toolbar settings requires substantial scrolling and visual parsing.
- Suggested fix: Group map-toolbar toggles behind subsections or segmented tabs; keep destructive saved-data actions separated at the end.

## Dedicated Scroll Audit

### Portrait 360x800

- Page-level scroll is disabled: body scroll height equals viewport height.
- `.app-layout` has hidden overflow while content is taller than the viewport.
- `.sheet-body` is the primary scroll container: 380 px client height, 835 px scroll height.
- Programmatic bottom scrolling reaches the other clips section.
- Touch-drag scrolling requires attention because the 390x844 reproduction showed no scroll movement from a real touch gesture.
- No horizontal overflow detected.

### Portrait 375x812

- Page-level horizontal overflow was not detected.
- The bottom sheet starts higher than at 360x800, leaving less map visible but more sheet content.
- Map terrain control was partially above the viewport (`y: -18`), indicating unsafe top positioning.
- Sheet content is scrollable by layout metrics.

### Portrait 390x844

- No horizontal overflow detected.
- `.sheet-body` had 403 px client height and 846 px scroll height.
- Real touch-drag did not advance `.sheet-body.scrollTop`; programmatic scroll could reach the bottom.
- Settings dialog scrolls independently and spans 1193 px.

### Portrait 430x932

- No horizontal overflow detected.
- `.sheet-body` had 449 px client height and 869 px scroll height.
- Map location control was partially offscreen (`y: -8`).
- First clip card remains very tall, causing important controls and other clips to require scrolling.

### Landscape 844x390

- No page-level horizontal overflow detected.
- `.sheet-body` is a side panel with 334 px client height and 2097 px scroll height.
- Bottom boundary is reachable programmatically and shows the upload zone.
- Header elements and sort chips reported negative y positions after scroll, suggesting some panel/header content can sit partially under fixed chrome.
- Map remains usable, but map controls are still under target size.

## Dedicated Sizing & UX Audit

Touch targets: Primary app buttons such as Settings and Add clips meet the 44x44 px target. Map controls, attribution, coordinates, and the sheet grab handle do not. The handle is 28 px high, which may be acceptable as a drag affordance only if the draggable area is larger than the visible grip.

Typography: Core card text is readable at mobile sizes. Header project titles truncate quickly. Settings copy is readable but dense.

Spacing and proportions: Portrait visuals are attractive but the first card consumes a large share of the sheet. Landscape is the larger concern: one full card exceeds the visible panel height, so comparison between clips is inefficient.

One-handed usability: Main actions near the sheet and cards are reachable. Map controls sit near the right edge and are too small; partially hidden controls in portrait are especially difficult.

Screen-space efficiency: The fixed header plus large map plus half sheet leaves limited room for clip details. The design prioritizes visual richness over density, which works in portrait until the touch-scroll issue blocks access to lower content.

## Console And Network Notes

- Console: Chromium produced WebGL `ReadPixels` performance warnings during one 360x800 run. No application crash was observed.
- Network: Many aborted `HEAD`/`GET` requests were recorded for example media probes and ArcGIS map tiles. The app still rendered videos/thumbnails/map tiles during the audit. Treat these as low-priority unless users report missing media or map imagery on slower networks.

## Prioritized Recommendations

1. Fix touch scrolling inside `.sheet-body` before release. This is the only high-severity confirmed issue because it can block access to content.
2. Increase MapLibre control hit areas and reposition them with mobile-safe offsets.
3. Add a compact landscape clip-card layout so the 844x390 side panel can show more useful content.
4. Improve small map attribution/coordinate touch affordances or make them non-interactive text where appropriate.
5. Reduce header title truncation with a mobile-specific project selector pattern.
6. Consider grouping Settings into shorter mobile sections.
