# GoPro GPS Extraction Guide

## Understanding Your GoPro Files
When recording with a GoPro, multiple file types are generated for every clip:
* **`.MP4`**: The main high-resolution video file containing video, audio, and an embedded metadata track (GPS, accelerometer, gyroscope, etc.).
* **`.LRV` (Low Resolution Video)**: A smaller proxy file used for fast mobile preview. It contains the **exact same GPS/telemetry data** as the MP4 but processes significantly faster due to its smaller size.
* **`.THM` (Thumbnail)**: A small JPEG preview image that **does not contain any telemetry data**.

*Tip:* You can use either the `.MP4` or `.LRV` file to extract GPS data. Using the `.LRV` file is recommended for faster processing.

---

## The Extraction Process
GoPro embeds telemetry using a format called **GPMF (GoPro Metadata Format)** inside the video container. Developers typically use **FFmpeg** to pull the raw metadata stream, which is then parsed into standard geographic files like **GPX** or **CSV**.

---

## Python Script to Locate and Extract GPS Metadata
Ensure you have **FFmpeg** installed and accessible from your system's PATH before running the script below.

```python
import subprocess
import os
import json

def check_and_extract_gopro_metadata(video_path):
    """
    Checks a GoPro MP4 or LRV file for telemetry streams and extracts the raw metadata.
    """
    if not os.path.exists(video_path):
        print(f"Error: File '{video_path}' not found.")
        return

    print(f"Analyzing file: {video_path}")

    # Step 1: Probe the file to find the metadata stream index
    probe_cmd = [
        "ffprobe", "-v", "error", 
        "-select_streams", "data", 
        "-show_entries", "stream=index:stream_tags=handler_name", 
        "-of", "json", video_path
    ]
    
    try:
        result = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout)
        
        meta_stream_index = None
        for stream in data.get("streams", []):
            tags = stream.get("tags", {})
            handler = tags.get("handler_name", "")
            if "Metadata" in handler or "GPMF" in str(stream):
                meta_stream_index = stream["index"]
                break
        
        # Fallback if explicit tags aren't matched
        if meta_stream_index is None and data.get("streams"):
            meta_stream_index = data["streams"][0]["index"]
        
        if meta_stream_index is None:
            print("❌ No telemetry/metadata stream found. Ensure GPS was enabled on your GoPro during recording.")
            return

        print(f"✔ Found GoPro telemetry stream at index: {meta_stream_index}")

    except Exception as e:
        print(f"Error running ffprobe (Is FFmpeg installed and in your PATH?): {e}")
        return

    # Step 2: Extract the raw metadata into a binary file
    bin_output = "gopro_telemetry_raw.bin"
    print("Extracting raw metadata stream...")
    
    ffmpeg_cmd = [
        "ffmpeg", "-y", "-i", video_path, 
        "-map", f"0:{meta_stream_index}", 
        "-c", "copy", "-copy_unknown", "-f", "data", bin_output
    ]
    
    try:
        subprocess.run(ffmpeg_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"✔ Success! Raw telemetry dumped to '{bin_output}'")
    except subprocess.CalledProcessError as e:
        print(f"Error running ffmpeg extraction: {e}")
        return

if __name__ == "__main__":
    target_file = "GH010001.LRV" 
    check_and_extract_gopro_metadata(target_file)
```

---

## Alternative: Ready-to-Use Command Line Tool
To immediately turn `.LRV` or `.MP4` files into a ready-to-use **GPX** or **CSV** file, use the open-source Python tool **`gopro2gpx`**:

1. Install it via terminal:
   ```bash
   pip install gopro2gpx
   ```
2. Run it against your GoPro file (the `-s` flag skips inaccurate GPS points without a satellite lock):
   ```bash
   gopro2gpx -s your_file.lrv extracted_track
   ```
   This generates `extracted_track.gpx` and `extracted_track.csv` files containing all your GPS data.


----

I have compiled the complete architectural blueprint, implementation plan, code snippets, and requirements into a single, comprehensive Markdown document.

This version includes your requested fixes:

1. **Styling:** Standardized CSS / Tailwind classes.
2. **Icons:** Explicit use of inline **SVG icons** instead of external packages like Lucide.
3. **GitHub Name:** The project and GitHub repository are named **`ClipToTrack`**.

You can download the complete project plan below:

[ClipToTrack_Implementation_Plan.md](./ClipToTrack_Implementation_Plan.md)

---

```markdown
# Project Plan: ClipToTrack (`ClipToTrack`)

## 1. Project Overview & Requirements

### Functional Requirements
* **File Drag-and-Drop:** Accept `.lrv` (recommended for performance) and `.mp4` files via a clean browser UI dropzone.
* **Client-Side Parsing:** Extract GPS tracks (Latitude, Longitude, Altitude, Speed, Timestamp) locally in-browser without uploading heavy files to a remote server.
* **Route Visualization:** Plot the extracted coordinates as an interactive polyline map using **Leaflet**.
* **Map Controls & Metrics:** Auto-zooming bounds, route start/end markers, and a stats summary panel (duration, max speed, total distance).
* **Error & Edge-Case Handling:** Clean error boundaries if a video lacks GPS metadata tracks.

### Non-Functional Requirements
* **Privacy First:** 100% local processing; video files never leave the user's computer.
* **UI Responsiveness:** Web Workers integration to ensure the browser main thread doesn't freeze during binary extraction.

---

## 2. Technology Stack

* **Build Tool:** Vite + React (JavaScript/TypeScript)
* **Styling & Design:** Plain CSS combined with utility styling
* **Icons:** Inline **SVG Icons** (Zero external icon dependencies)
* **GoPro Parsers:** `gpmf-extract` and `gopro-telemetry` (configured for browser stream execution)
* **Mapping:** `react-leaflet` and `leaflet`

---

## 3. Component Structure & Architecture Blueprint

```text
ClipToTrack/
├── public/
├── src/
│   ├── components/
│   │   ├── Header.jsx        # Navigation bar with SVG logo & GitHub info
│   │   ├── DropZone.jsx      # Drag-and-drop file upload container with SVG icons
│   │   ├── LoadingOverlay.jsx# Real-time parsing progress bar & status messages
│   │   ├── RouteMap.jsx      # Leaflet map container, polyline route, and custom markers
│   │   └── StatsPanel.jsx    # Metrics sidebar (Max Speed, Distance, Altitude)
│   ├── services/
│   │   └── goproParser.js    # Core logic wrapping gpmf-extract & gopro-telemetry
│   ├── App.jsx               # Central state hub (IDLE -> PROCESSING -> SUCCESS / ERROR)
│   ├── index.css             # Global CSS / Leaflet style imports
│   └── main.jsx
├── package.json
└── vite.config.js

```

---

## 4. Core Implementation Code

### A. The Parser Utility (`src/services/goproParser.js`)

```javascript
import gpmfExtract from 'gpmf-extract';
import goproTelemetry from 'gopro-telemetry';

export async function extractGoProGPS(file, onProgress) {
  try {
    onProgress(10, "Extracting metadata tracks...");
    
    // Extract raw binary GPMF track via browser worker mode
    const buffer = await gpmfExtract(file, {
      browserMode: true,
      useWorker: true,
      progress: (p) => onProgress(10 + Math.round(p * 40), "Extracting metadata...")
    });

    onProgress(55, "Parsing telemetry coordinates...");

    return new Promise((resolve, reject) => {
      goproTelemetry(
        buffer,
        { stream: ['GPS5'] },
        (telemetry, err) => {
          if (err) {
            reject(err);
            return;
          }

          onProgress(90, "Cleaning up route data...");
          
          const samples = telemetry?.['1']?.streams?.GPS5?.values || [];
          
          if (samples.length === 0) {
            reject(new Error("No GPS data found in this file. Make sure GPS was enabled on your GoPro."));
            return;
          }

          // Map and filter points: [lat, lng, elevation, speed]
          const routePoints = samples
            .filter(pt => pt[0] !== 0 && pt[1] !== 0)
            .map(pt => ({
              lat: pt[0],
              lng: pt[1],
              alt: pt[2],
              speed: pt[3] * 3.6, // converted from m/s to km/h
            }));

          onProgress(100, "Done!");
          resolve(routePoints);
        }
      );
    });
  } catch (error) {
    console.error("Parser failure:", error);
    throw error;
  }
}

```

### B. The Map Component (`src/components/RouteMap.jsx`)

```jsx
import React from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function MapBoundsUpdater({ points }) {
  const map = useMap();
  React.useEffect(() => {
    if (points && points.length > 0) {
      const latLngs = points.map(p => [p.lat, p.lng]);
      map.fitBounds(latLngs, { padding: [50, 50] });
    }
  }, [points, map]);
  return null;
}

export default function RouteMap({ points }) {
  if (!points || points.length === 0) return null;

  const polylineCoords = points.map(p => [p.lat, p.lng]);
  const startPoint = polylineCoords[0];
  const endPoint = polylineCoords[polylineCoords.length - 1];

  return (
    <div className="map-container-wrapper" style={{ position: 'relative', width: '100%', height: '600px' }}>
      <MapContainer '100%', '12px' borderRadius: center="{startPoint}" height: style="{{" width: zoom="{13}" }}>
        <TileLayer attribution="&copy; <a href=" [https://www.openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)"">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Polyline color="#2563eb" positions="{polylineCoords}" weight="{5}"/>
        <Marker position="{startPoint}">
          <Popup>Start of Trip</Popup>
        </Marker>
        <Marker position="{endPoint}">
          <Popup>End of Trip</Popup>
        </Marker>
        <MapBoundsUpdater points="{points}"/>
      </MapContainer>
    </div>
  );
}

```

### C. UI Header Component with Custom SVG Icons (`src/components/Header.jsx`)

```jsx
import React from 'react';

export default function Header() {
  return (
    <header className="app-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 2rem', background: '#0f172a', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Map Pin SVG Icon */}
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>ClipToTrack</h1>
      </div>
      <div>
        <a 
          href="https://github.com/your-username/ClipToTrack" 
          target="_blank" 
          rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#cbd5e1', textDecoration: 'none', fontSize: '0.9rem' }}
        >
          {/* GitHub SVG Icon */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
          </svg>
          GitHub
        </a>
      </div>
    </header>
  );
}

```

```

```
