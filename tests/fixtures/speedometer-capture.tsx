import { useEffect, useRef, useState } from 'react';
import {
  RecordingTargetContext,
  type RecordingTarget,
} from '../../src/components/MapCapture/RecordingTargetContext';
import { createRoot } from 'react-dom/client';
import SpeedometerCapture from '../../src/components/SpeedometerCapture/SpeedometerCapture';
import '../../src/styles.css';
import type { Clip } from '../../src/types';
const duration = new URLSearchParams(location.search).has('long') ? 10 : 2;
const clip: Clip = {
  id: 'test',
  index: 0,
  title: 'Telemetry test',
  color: '#2878ff',
  date: '',
  duration: '0:02',
  distance: '20 m',
  maxSpeed: '40 km/h',
  altitude: '120 m',
  camera: '',
  gpsQuality: '',
  addedAt: 0,
  sort: { duration },
  coordinates: [
    [0, 0],
    [0, 0],
  ],
  samples: [
    {
      lat: 0,
      lon: 0,
      speed3dKmh: 0,
      altM: 100,
      cumulativeDistM: 0,
      utc: '2026-01-01T00:00:00Z',
    },
    {
      lat: 0,
      lon: 0,
      speed3dKmh: 40,
      altM: 120,
      cumulativeDistM: 20,
      utc: new Date(
        Date.parse('2026-01-01T00:00:00Z') + duration * 1000,
      ).toISOString(),
    },
  ],
};
function Fixture() {
  const [target, setTarget] = useState<RecordingTarget | null>(null);
  const [probe, setProbe] = useState(0);
  const virtual = new URLSearchParams(location.search).has('virtual');
  const [playing, setPlaying] = useState(false);
  const [pausedTime, setPausedTime] = useState(1);
  const media = useRef({ time: 1, started: 0, playing: false });
  const currentTime = () =>
    Math.min(
      duration,
      media.current.time +
        (media.current.playing
          ? (performance.now() - media.current.started) / 1000
          : 0),
    );
  const pausePlayback = () => {
    media.current.time = currentTime();
    setPausedTime(media.current.time);
    media.current.playing = false;
    setPlaying(false);
  };
  useEffect(() => {
    const timer = setInterval(() => {
      if (media.current.playing && currentTime() >= duration) {
        media.current.time = duration;
        setPausedTime(duration);
        media.current.playing = false;
        setPlaying(false);
      }
    }, 20);
    return () => clearInterval(timer);
  }, []);
  return (
    <RecordingTargetContext.Provider
      value={{
        target,
        setTarget,
        getCurrentTime: virtual ? () => undefined : currentTime,
        playback: { clipId: clip.id, playing },
        pausePlayback,
        preparePlayback: async (_clipId, position) => {
          pausePlayback();
          if (position === 'beginning') media.current.time = 0;
          return async () => {
            media.current.started = performance.now();
            media.current.playing = true;
            setPlaying(true);
          };
        },
      }}
    >
      <div
        className="app-shell map-column"
        style={{ height: 800, width: 1200 }}
      >
        <div
          className="map-stage"
          style={{
            height: 440,
            flex: 'none',
            background: '#336655',
            position: 'relative',
          }}
        >
          <span>Map stays visible</span>
          <output aria-label="Playback time">{pausedTime.toFixed(2)}</output>
          <button
            onClick={() => setProbe(1)}
            style={{ position: 'absolute', right: 20, bottom: 60 }}
          >
            Jump probe
          </button>
          <span role="status">{playing ? 'Clip playing' : 'Clip paused'}</span>
          <button
            style={{ position: 'absolute', right: 20, bottom: 20 }}
            onClick={pausePlayback}
          >
            Pause clip
          </button>
        </div>
        <div style={{ height: 300, display: 'flex' }}>
          <SpeedometerCapture clip={clip} probe={probe} />
        </div>
      </div>
    </RecordingTargetContext.Provider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
