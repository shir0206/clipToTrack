# Clip to Track

## Product / UX / Visual Design / Frontend Specification

**Product:** Clip to Track\
**Primary mapping library:** MapLibre GL JS\
**Application type:** Client-side web application\
**Primary input:** GoPro `.MP4` / `.LRV` clips containing GPS telemetry\
**Primary output:** Interactive visualization connecting video clips with their geographic tracks.

---

# 1. Product Concept

**Clip to Track** converts GoPro footage into interactive geographic tracks.

The user drops one or more GoPro clips into the browser.

The application:

1. Reads the files locally.
2. Extracts available GPS and telemetry metadata.
3. Creates a geographic path for every clip.
4. Displays all paths on an interactive MapLibre map.
5. Creates a corresponding video card for every clip.
6. Keeps the video card and map path permanently associated.
7. Allows the user to select either the card or route to navigate the other.

The essential interaction is:

> **Clip ↔ Track**

The user should never need to wonder:

> "Which route belongs to this video?"

That relationship must be visually obvious at all times.

---

# 2. Core UX Principle

The card list and map are two representations of the same data.

They must behave as one interface.

Selecting:

- a clip card
- a map route
- a route marker
- a video

must update the same global:

```ts
selectedClipId;
```

For example:

```ts
selectedClipId = 'clip-03';
```

Everything derives its visual state from this value.

```text
Card selected
    ↓
Route highlighted
    ↓
Map focuses route
    ↓
Route telemetry becomes prominent
    ↓
Video becomes active
```

And conversely:

```text
Route clicked
    ↓
Card selected
    ↓
Card scrolls into view
    ↓
Video/telemetry context becomes available
```

There should never be separate concepts of:

```text
selectedMapRoute
selectedCard
selectedVideo
```

These represent the same object.

Use:

```ts
selectedClipId;
```

as the source of truth.

---

# 3. Desktop Layout

The application should primarily be optimized for desktop.

Recommended breakpoint:

```text
>= 1024 px
```

Main structure:

```text
┌──────────────────────────────────────────────────────────────┐
│ Header                                                       │
├──────────────────────┬───────────────────────────────────────┤
│                      │                                       │
│  CLIP PANEL          │              MAP                      │
│                      │                                       │
│  ~33%                │              ~67%                     │
│                      │                                       │
│                      │                                       │
│                      │                                       │
├──────────────────────┤                                       │
│ Upload               │                                       │
└──────────────────────┴───────────────────────────────────────┘
```

Recommended CSS:

```css
.app-layout {
  display: grid;
  grid-template-columns:
    minmax(360px, 33vw)
    minmax(0, 1fr);
  height: 100dvh;
}
```

Do not hardcode an exact 33/67 split.

The sidebar should have:

```css
min-width: 360px;
max-width: 520px;
```

The map receives all remaining space.

---

# 4. Header

The header should be restrained.

Approximate height:

```text
56–64 px
```

Left:

```text
[logo] clip to track
```

Optional small descriptor:

```text
GoPro clips. Mapped.
```

Right:

```text
Project name
Export
Settings
```

Avoid making the header visually dominant.

The map and clip relationship is the product.

---

# 5. Left Clip Panel

The left panel contains:

```text
CLIPS
  ├── Clip Card
  ├── Clip Card
  ├── Clip Card
  ├── ...
  │
  └── Upload Area
```

The cards section should scroll independently.

The upload area should remain easily accessible.

Possible structure:

```text
┌───────────────────────────┐
│ Clips                 4   │
├───────────────────────────┤
│                           │
│ Card                      │
│                           │
│ Card                      │
│                           │
│ Card                      │
│                           │
│                           │
├───────────────────────────┤
│ + Drop GoPro clips        │
└───────────────────────────┘
```

---

# 6. Clip Card

Each GoPro clip has exactly one card.

Recommended anatomy:

```text
┌────────────────────────────────────┐
│ ┃  [ VIDEO THUMBNAIL ]             │
│ ┃                                  │
│ ┃  ● 01  Alpine descent            │
│ ┃        Jun 14 · 10:24 AM         │
│ ┃                                  │
│ ┃  ▶  ▌▌  ■             04:32      │
│ ┃                                  │
│ ┃  8.4 km   62 km/h   2,317 m      │
│ ┃  GPS 18 Hz · 46.121, 7.832       │
└────────────────────────────────────┘
```

The colored left edge represents the track identity.

Example:

```text
Track 1 = blue
Track 2 = orange
Track 3 = green
Track 4 = violet
Track 5 = cyan
```

The route uses exactly the same color.

---

# 7. Track Identity System

Color alone is not enough.

Every clip should receive:

1. **Color**
2. **Index number**
3. **Optional route shape preview**

Example:

```text
● 1   Blue
● 2   Orange
● 3   Green
```

The exact same identity appears on the map.

Card:

```text
● 2 Forest Trail
```

Map:

```text
    ②
    │
────●────●────●────
```

This solves several accessibility and recognition problems.

Even if two tracks overlap or the user has difficulty distinguishing colors, the number still connects the objects.

---

# 8. Card States

Every card has four primary visual states.

## Default

```text
background: neutral
border: subtle
route stripe: visible
```

## Hover

Slight elevation.

```text
border becomes stronger
background slightly elevated
route subtly highlighted on map
```

Do **not** perform camera movement on hover.

Hover should only preview association.

---

## Selected

Strong but elegant state.

Use:

- 2px route-colored outline
- route-colored left rail
- subtle tinted background
- optional shadow
- stronger track-number badge

Example:

```text
╔═════════════════════════════════╗
║ BLUE RAIL                       ║
║                                 ║
║       Alpine Descent            ║
║                                 ║
╚═════════════════════════════════╝
```

Selection must be immediately visible.

---

## Playing

Playing and selected are related but not identical.

Selected:

```text
Which clip am I inspecting?
```

Playing:

```text
Which clip is currently running?
```

A playing card can display:

```text
▶ PLAYING
```

or a subtle animated indicator.

---

# 9. Video Experience

The video preview should be integrated into the card.

Recommended preview ratio:

```text
16:9
```

Controls:

```text
Play
Pause
Stop
Timeline
Current time
Duration
Mute
Fullscreen
```

Do not reproduce a giant video-player toolbar inside every card.

Default card:

```text
thumbnail + play
```

When selected:

```text
full controls appear
```

This keeps non-selected cards visually quiet.

---

# 10. Video → Map Synchronization

A major product opportunity is synchronizing playback position with the route.

Suppose the GoPro telemetry contains timestamps.

During playback:

```text
video.currentTime
        ↓
telemetry timestamp
        ↓
GPS coordinate
        ↓
moving map marker
```

Display:

```text
─────●─────●─────◉─────●─────
                  ↑
             current video
             position
```

This marker should move smoothly while the video plays.

Suggested marker:

```text
white center
selected route-colored ring
small outer glow
```

Do not constantly move the map camera.

The marker moves.

The map camera remains stable unless the user explicitly enables:

```text
Follow playback
```

---

# 11. Map

Use **MapLibre GL JS**.

MapLibre uses WebGL rendering and supports GeoJSON/vector sources, style layers, interaction events, controls and runtime feature state, making it appropriate for this interface.

The map occupies roughly:

```text
67% desktop width
```

and all available vertical space below the header.

---

# 12. Map Base Style

The basemap should be intentionally quiet.

Tracks are the most important visual elements.

Prefer:

```text
low saturation
light terrain
reduced POI density
subtle road colors
subtle labels
```

Avoid an extremely colorful consumer-navigation map.

The basemap should provide geographic context but visually sit behind:

```text
Tracks
Pins
Current position
Selection
```

---

# 13. Track Data Structure

Represent each video track as GeoJSON.

Example:

```ts
type TrackProperties = {
  clipId: string;
  index: number;
  title: string;
  color: string;
  durationMs: number;
};

type TrackFeature = GeoJSON.Feature<GeoJSON.LineString, TrackProperties>;
```

Example feature:

```json
{
  "type": "Feature",
  "id": "clip-001",
  "properties": {
    "clipId": "clip-001",
    "index": 1,
    "title": "Alpine Descent",
    "color": "#2878FF"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [7.832, 46.121],
      [7.834, 46.122],
      [7.838, 46.125]
    ]
  }
}
```

Stable feature IDs are important because MapLibre's feature-state system can then be used for hover and selection.

---

# 14. MapLibre Sources

Recommended structure:

```text
tracks-source
track-points-source
track-labels-source
playback-position-source
```

However, avoid creating one MapLibre source for every clip.

Prefer:

```text
one FeatureCollection
```

containing all routes.

Example:

```ts
map.addSource('tracks', {
  type: 'geojson',
  data: trackFeatureCollection,
});
```

Then use feature properties and feature-state to determine styling.

This scales considerably better than continuously creating/removing layers.

---

# 15. Map Layer Stack

Recommended rendering order:

```text
Basemap
↓
Unselected track casing
↓
Unselected track
↓
Selected track glow
↓
Selected track
↓
Telemetry points
↓
Start / finish markers
↓
Track number markers
↓
Playback marker
↓
Hover / popup UI
```

---

# 16. Default Routes

Unselected tracks:

```text
line width: 3 px
opacity: 0.45–0.65
```

They must remain recognizable.

Do not turn them gray.

Their identity color should remain visible.

---

# 17. Selected Route

Selected route should become substantially stronger.

Example:

```text
outer glow/casing: 10px
inner route: 5px
opacity: 1
```

Conceptually:

```text
            SELECTED

          soft glow
      ━━━━━━━━━━━━━━━
        ━━━━━━━━━━━
```

Use two MapLibre line layers rather than trying to create a CSS shadow.

Example:

```text
selected-track-glow
selected-track
```

This creates a clean map-native highlight.

---

# 18. Hovered Route

Hover state should sit between default and selected.

Example:

```text
Default:   3px / 55%
Hover:     5px / 90%
Selected:  6px + glow / 100%
```

Hovering a route also lightly highlights its corresponding card.

Do not automatically select on hover.

---

# 19. Feature State

Recommended MapLibre state model:

```ts
{
  selected: boolean;
  hovered: boolean;
}
```

Example:

```ts
map.setFeatureState(
  {
    source: 'tracks',
    id: clipId,
  },
  {
    selected: true,
  },
);
```

Then use MapLibre expressions in the layer style.

Conceptually:

```ts
"line-width": [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  6,
  ["boolean", ["feature-state", "hovered"], false],
  4.5,
  3
]
```

Feature state lets visual interaction change without replacing the GeoJSON source whenever selection changes.

---

# 20. Track Points

Do not render every GPS sample as a large visible dot.

GoPro telemetry can contain many samples.

Showing everything would produce:

```text
●●●●●●●●●●●●●●●●●●●●
```

instead of a readable track.

Default:

```text
show route only
```

Selected route:

```text
show sampled telemetry points
```

For example display a point:

```text
every 5–30 meters
```

depending on zoom.

The full GPS data remains available internally.

---

# 21. Start / Finish

Every route should have:

```text
START
FINISH
```

but these should be understated for non-selected routes.

Selected:

```text
● START

...

🏁 FINISH
```

The track number marker can sit next to Start:

```text
① START
```

This strongly reinforces the card relationship.

---

# 22. Map Click Behavior

Clicking a route:

```text
setSelectedClipId(feature.properties.clipId)
```

Then:

1. Highlight route.
2. Highlight matching card.
3. Scroll card into view.
4. Display selected telemetry.
5. Optionally fit map camera to the route.

Only the initial click should trigger map movement.

---

# 23. Camera Behavior

Avoid excessive animation.

Recommended rules:

### Selecting card

Call:

```text
fitBounds(trackBounds)
```

with sidebar-aware padding.

Example conceptual padding:

```ts
{
  top: 80,
  right: 80,
  bottom: 80,
  left: 80
}
```

Because the map already occupies only the right pane, no huge sidebar padding is necessary.

Use moderate animation:

```text
500–800ms
```

---

# 24. Map Controls

Top-left:

```text
Map / Satellite / Terrain
```

Top-right:

```text
Search
```

Right:

```text
+
−
Locate
Compass
Fullscreen
```

Do not overload controls.

MapLibre already provides several common map controls, including navigation, geolocation, scale and fullscreen controls.

---

# 25. Selected Route Information

Optional floating panel:

```text
┌────────────────────────────────┐
│ [thumbnail] Alpine Descent     │
│             8.4 km · 04:32     │
│                                │
│ ▁▂▃▄▅▆▇ elevation             │
│                                │
│ Peak 2,317 m   Max 62 km/h     │
└────────────────────────────────┘
```

Place at:

```text
bottom-right
```

Do not duplicate all card information.

Use only the data valuable while viewing the map.

---

# 26. Telemetry Metadata

Potential telemetry fields:

```text
Date
Start time
Duration
Distance

Latitude
Longitude

Altitude
Elevation gain
Elevation loss

Speed
Maximum speed
Average speed

Heading
GPS accuracy
GPS sampling rate

Frame rate
Resolution

Camera model
```

Do not expose everything at the same hierarchy.

Primary:

```text
Duration
Distance
Max speed
Altitude
```

Secondary:

```text
GPS Hz
Coordinates
Elevation gain
Camera
```

The full technical data can live behind:

```text
More details
```

---

# 27. Upload Experience

The bottom of the left panel contains a persistent upload target.

Empty:

```text
┌ - - - - - - - - - - - - ┐
│                           │
│           ↑               │
│                           │
│ Drag & drop GoPro clips   │
│                           │
│ or click to browse        │
│ MP4 · LRV                 │
│                           │
└ - - - - - - - - - - - - ┘
```

Dragging files over the window should visibly activate it.

---

# 28. Global Drag State

When files enter the browser window:

```text
entire app slightly dims
```

Display central overlay:

```text
┌──────────────────────────┐
│                          │
│    Drop GoPro clips      │
│                          │
│       + Add clips        │
│                          │
└──────────────────────────┘
```

The user should not need to precisely target a tiny upload box.

---

# 29. Loading Pipeline

Avoid showing one generic:

```text
Loading...
```

The application's work is meaningful and should be communicated.

Recommended stages:

```text
1. Reading file
2. Inspecting GoPro metadata
3. Extracting GPS telemetry
4. Building track
5. Preparing video
6. Ready
```

Display:

```text
GOPR1234.MP4

Extracting GPS telemetry

██████████████░░░░  72%
```

If the exact percentage is unknown use indeterminate progress rather than inventing percentages.

---

# 30. Multiple Uploads

Each upload gets its own queue row.

Example:

```text
GOPR1031.MP4
████████████████████  Ready

GOPR1032.MP4
████████████░░░░░░░  Extracting GPS

GOPR1033.MP4
████░░░░░░░░░░░░░░  Reading
```

Processing one clip should not block interaction with clips that are already ready.

---

# 31. Error States

Errors need actionable messages.

Bad:

```text
Failed processing file.
```

Good:

```text
No GPS telemetry found

GOPR0321.MP4 contains video, but no GPS track
was detected.

[Keep video] [Remove]
```

Another:

```text
Unsupported file

holiday.mov does not appear to contain
supported GoPro telemetry.

[Remove]
```

---

# 32. Privacy

If the application is completely local, make this a product advantage.

Near upload:

```text
🔒 Processed locally
Your clips never leave this browser.
```

Do not repeatedly mention privacy everywhere.

One strong reassurance is enough.

---

# 33. Frontend Architecture

Recommended stack:

```text
React
TypeScript
Vite
MapLibre GL JS
Web Workers
CSS Modules / Tailwind / equivalent
```

Architecture:

```text
src/
│
├── app/
│   ├── App.tsx
│   └── providers/
│
├── features/
│   │
│   ├── map/
│   │   ├── TrackMap.tsx
│   │   ├── mapLayers.ts
│   │   ├── mapSources.ts
│   │   ├── mapInteractions.ts
│   │   └── useMapSelection.ts
│   │
│   ├── clips/
│   │   ├── ClipList.tsx
│   │   ├── ClipCard.tsx
│   │   ├── VideoPreview.tsx
│   │   └── ClipMetadata.tsx
│   │
│   ├── upload/
│   │   ├── DropZone.tsx
│   │   ├── UploadQueue.tsx
│   │   └── ProcessingItem.tsx
│   │
│   └── telemetry/
│       ├── telemetry.worker.ts
│       ├── parser.ts
│       └── interpolation.ts
│
├── store/
│   └── projectStore.ts
│
├── models/
│   ├── Clip.ts
│   ├── Track.ts
│   └── TelemetrySample.ts
│
└── styles/
```

---

# 34. Domain Model

Recommended model:

```ts
interface Clip {
  id: string;

  file: File;
  fileName: string;

  videoUrl: string;

  title: string;

  color: string;
  index: number;

  durationMs: number;

  createdAt?: Date;

  telemetry: TelemetrySample[];

  track: GeoJSON.Feature<GeoJSON.LineString>;

  bounds: [[number, number], [number, number]];

  stats: ClipStats;

  status:
    'queued' | 'reading' | 'extracting' | 'processing' | 'ready' | 'error';

  error?: ClipError;
}
```

Telemetry:

```ts
interface TelemetrySample {
  timestampMs: number;

  longitude: number;
  latitude: number;

  altitude?: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
}
```

---

# 35. Client State

Recommended state:

```ts
interface ProjectState {
  clips: Clip[];

  selectedClipId: string | null;
  hoveredClipId: string | null;

  playingClipId: string | null;

  playbackTimeMs: number;

  mapStyle: 'map' | 'satellite' | 'terrain';

  followPlayback: boolean;
}
```

Critical separation:

```text
selected
hovered
playing
```

These states must not be conflated.

---

# 36. MapLibre Integration

Initialize MapLibre once.

Do not destroy/recreate the map when React state changes.

Conceptually:

```tsx
const mapRef = useRef<Map | null>(null);

useEffect(() => {
  mapRef.current = new Map({
    container: containerRef.current!,
    style: MAP_STYLE,
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
  });

  return () => {
    mapRef.current?.remove();
  };
}, []);
```

Then update sources/state imperatively.

React owns:

```text
application state
```

MapLibre owns:

```text
map rendering
```

Do not try to represent every MapLibre object as React components.

---

# 37. Route Source Updates

When clips are added or removed:

```text
Clip[]
↓
FeatureCollection
↓
GeoJSONSource.setData()
```

Example architecture:

```ts
const geojson = {
  type: 'FeatureCollection',
  features: clips.map((clip) => clip.track),
};
```

Then:

```ts
source.setData(geojson);
```

MapLibre internally prepares GeoJSON sources for rendering, and `setData()` is the appropriate mechanism for replacing source data.

---

# 38. Selection Updates

Do **not** call `setData()` just because selection changes.

Instead:

```text
Old selected clip
    ↓
feature-state selected=false

New selected clip
    ↓
feature-state selected=true
```

This is one of the most important implementation decisions.

---

# 39. Map → React Events

Register:

```text
mouseenter
mouseleave
click
```

on the route interaction layer.

Example:

```text
mouseenter route
→ setHoveredClipId()

mouseleave route
→ clearHoveredClipId()

click route
→ setSelectedClipId()
```

Change the cursor:

```text
pointer
```

when hovering routes.

---

# 40. Card → Map Events

Card hover:

```text
setHoveredClipId(id)
```

Card click:

```text
setSelectedClipId(id)
```

Selection hook then handles:

```text
MapLibre feature state
camera behavior
card scroll
```

Do not embed map manipulation code directly inside `ClipCard`.

---

# 41. Playback Synchronization

Telemetry should be sorted by timestamp.

For a playback position:

```ts
const t = video.currentTime * 1000;
```

find the surrounding GPS samples:

```text
sample A
timestamp 8100

sample B
timestamp 8200
```

Then interpolate:

```text
t = 8150
→ 50% between A and B
```

Move one playback position GeoJSON feature.

Do not create/delete a MapLibre marker 30–60 times per second.

Update a persistent source.

---

# 42. Worker Architecture

GPS extraction can be computationally expensive.

Do not parse large GoPro clips on the UI thread.

Use:

```text
Web Worker
```

Architecture:

```text
Browser UI
   │
   │ File
   ▼
Telemetry Worker
   │
   ├─ inspect metadata
   ├─ extract telemetry
   ├─ normalize samples
   └─ calculate stats
   │
   ▼
React store
   │
   ├─ Card
   └─ Map
```

This prevents upload processing from freezing map interaction.

---

# 43. Local Video URLs

For local files use:

```ts
URL.createObjectURL(file);
```

Store the resulting URL on the clip.

When the clip is removed:

```ts
URL.revokeObjectURL(videoUrl);
```

This avoids unnecessary file copying and upload.

---

# 44. Performance

Avoid rendering huge raw GPS datasets unnecessarily.

Raw GoPro track:

```text
potentially thousands of samples
```

Keep raw telemetry for:

```text
playback
stats
inspection
```

Create separate visualization geometry for MapLibre.

For example:

```text
rawTelemetry
↓
simplifiedMapTrack
```

At low zoom levels aggressively simplify the line.

The visual difference will be negligible while rendering cost can decrease substantially.

---

# 45. Many Clips

For:

```text
1–20 clips
```

individual colored paths work extremely well.

For:

```text
20–100+
```

the interface needs additional controls.

Possible later feature:

```text
Show:
○ All clips
● Selected day
○ Selected clips
```

Do not solve this in the MVP unless necessary.

---

# 46. Visual Design System

## Background

Application chrome:

```text
#F7F9FC
```

Cards:

```text
#FFFFFF
```

Primary text:

```text
#152033
```

Secondary:

```text
#64748B
```

Borders:

```text
#DFE5ED
```

---

# 47. Route Palette

Use a route palette designed for map contrast.

Example:

```text
01  #2878FF
02  #FF7A1A
03  #14A44D
04  #8B5CF6
05  #EC4899
06  #0891B2
07  #D6A000
08  #E24343
```

After approximately eight colors, repeat colors with distinct numbering.

Never depend on color alone.

---

# 48. Typography

Recommended:

```text
Inter
Geist
SF Pro
```

or equivalent clean UI typeface.

Hierarchy:

```text
App title          20–22 / semibold
Card title         15–16 / semibold
Metadata value     13–14 / semibold
Metadata label     11–12 / regular
Secondary text     12–13 / regular
```

Avoid extremely small telemetry text.

---

# 49. Spacing

Use an 8px spacing system.

```text
4
8
12
16
24
32
```

Sidebar padding:

```text
12–16px
```

Card gap:

```text
10–12px
```

Card padding:

```text
12–16px
```

---

# 50. Border Radius

Recommended:

```text
Cards       12–14px
Buttons      8–10px
Badges       full / pill
Upload       12–14px
Map overlays 12–14px
```

Do not make everything excessively rounded.

---

# 51. Shadows

Cards default:

```text
very subtle
```

Selected card:

```text
slightly stronger
```

Floating map UI:

```text
stronger separation from map
```

Avoid large blurry SaaS-style shadows.

---

# 52. Mobile / Narrow Screens

At narrower widths, do not attempt to preserve the 33/67 layout.

Use:

```text
map full-screen
```

with a bottom clip drawer.

Concept:

```text
┌─────────────────────┐
│                     │
│        MAP          │
│                     │
│                     │
├─────────────────────┤
│ ▔▔ drag handle ▔▔   │
│ Clip 1              │
│ Clip 2              │
│ Clip 3              │
└─────────────────────┘
```

Desktop is the primary experience.

---

# 53. Accessibility

Track association cannot depend solely on color.

Use:

```text
Color
+
Number
+
Text
```

All controls require accessible labels.

Examples:

```text
aria-label="Play Alpine Descent"
aria-label="Pause Alpine Descent"
aria-label="Select track 2 Forest Flow"
```

Keyboard:

```text
Tab
Enter
Space
Arrow navigation where appropriate
```

Selected states should use:

```text
aria-selected
```

where semantically appropriate.

---

# 54. Empty State

Before clips exist, do not show a completely empty map plus tiny upload box.

Use:

```text
MAP

                   No tracks yet

           Drop GoPro clips to map
              your adventure.
```

Sidebar:

```text
Drag GoPro clips here

MP4 / LRV

🔒 Processed locally
```

The interface should immediately explain the product.

---

# 55. First Successful Upload

The first successful clip should trigger:

```text
1. Card appears
2. Route animates/fades in
3. Map fits route
4. Card becomes selected
```

This creates the application's core "aha" moment.

Avoid celebratory confetti.

The map itself is the reward.

---

# 56. Route Drawing Animation

Optional subtle animation:

```text
route draws from start → finish
```

Duration:

```text
600–1000ms
```

Only when a new route first appears.

Do not replay this every time the route is selected.

---

# 57. Cursor / Hover Feedback

Interactive route:

```text
cursor: pointer
```

Card:

```text
cursor: pointer
```

Dragging map:

```text
MapLibre default grab/grabbing
```

Dropzone:

```text
copy / upload visual treatment
```

The map and list should feel equally interactive.

---

# 58. MVP

The first release should contain:

### Upload

- multi-file drag/drop
- click-to-select
- progress/status
- local processing

### Clips

- thumbnail
- video playback
- title
- basic telemetry
- card selection

### Map

- MapLibre
- multiple tracks
- matching color/index system
- route selection
- hover association
- route focus
- start/end markers

### Synchronization

- Card → map
- Map → card
- Playback → current GPS marker

### States

- loading
- processing
- ready
- no GPS
- invalid file
- empty project

---

# 59. Phase 2

Later enhancements:

```text
Elevation chart
Speed chart

Timeline scrubbing on map
Telemetry inspection

Track trimming

Clip renaming

Hide/show individual tracks

Export GeoJSON
Export GPX

Project persistence

Offline map caching

Screenshot/export map

Map themes

Combine sequential GoPro clips

Automatic clip grouping by recording session
```

---

# 60. Interaction Summary

The final experience should feel like this:

```text
DROP GOPRO VIDEO
      ↓
GPS IS EXTRACTED
      ↓
CARD APPEARS
      ↓
TRACK APPEARS
      ↓
CLICK CARD
      ↓
TRACK LIGHTS UP
      ↓
PLAY VIDEO
      ↓
POSITION MOVES ALONG TRACK
```

Or from the other direction:

```text
SEE TRACK
    ↓
CLICK TRACK
    ↓
MATCHING CARD LIGHTS UP
    ↓
VIDEO AVAILABLE IMMEDIATELY
```

The connection must feel instantaneous.

---

# 61. UX Rule of Thumb

At any moment, the user should be able to answer these three questions in less than one second:

```text
1. Which clip am I looking at?

2. Where was it recorded?

3. Which map route belongs to it?
```

If any of those require investigation, the design has failed.

---

# 62. Recommended MapLibre Strategy Summary

Use:

```text
GeoJSONSource
    ↓
FeatureCollection<LineString>
```

for tracks.

Use:

```text
feature.id = clipId
```

for stable identity.

Use:

```text
feature-state
```

for:

```text
selected
hovered
```

Use separate MapLibre layers for:

```text
route base
route highlight/glow
route points
start/end
labels
playback position
```

Use:

```text
setData()
```

when track geometry changes.

Use:

```text
setFeatureState()
```

when interaction state changes.

Use:

```text
fitBounds()
```

when the user intentionally selects a track.

Use:

```text
MapLibre layer events
```

for route interaction.

Do not use hundreds or thousands of HTML Marker objects for telemetry.

---

# 63. Desired Product Character

Clip to Track should feel:

```text
technical
but not complicated

outdoors-oriented
but not gimmicky

data-rich
but not dense

map-first
but video-aware

professional
but playful enough to explore
```

The map should provide the sense of discovery.

The sidebar provides control.

The route-color/index system provides orientation.

And the video-to-GPS synchronization is the interaction that makes the product feel unique.
