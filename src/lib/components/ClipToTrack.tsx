import { useState } from 'react';
import ClipCard from './ClipCard';
import TrackMap from './TrackMap';
import UploadZone from './UploadZone';
import { MOCK_CLIPS, type Clip } from './data';
import './ClipToTrack.css';

export default function ClipToTrack() {
  const [clips] = useState<Clip[]>(MOCK_CLIPS); // TODO: setClips after telemetry parsing
  const [selectedClipId, setSelectedClipId] = useState<string | null>(clips[0]?.id ?? null); // single source of truth
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);

  const select = (id: string) => {
    setSelectedClipId(id);
    document.getElementById(`ctt-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const handleFiles = (files: File[]) => {
    // TODO: extract GPS telemetry (e.g. gopro-telemetry), build Clip objects, setClips
    console.log('Files to process', files);
  };

  return (
    <div className="ctt-app">
      <header className="ctt-header">
        <div className="ctt-brand">
          <span className="ctt-logo">clip to track</span>
          <span className="ctt-tagline">GoPro clips. Mapped to your adventures.</span>
        </div>
        <div className="ctt-header-actions">
          <button>Projects</button>
          <button>Settings</button>
        </div>
      </header>

      <main className="ctt-layout">
        <aside className="ctt-panel">
          <div className="ctt-panel-title">Clips <span>{clips.length}</span></div>
          <ul className="ctt-list" role="listbox" aria-label="Clips">
            {clips.map((clip) => (
              <ClipCard
                key={clip.id}
                  clip={clip}
                  selected={clip.id === selectedClipId}
                  playing={clip.id === playingClipId}
                  onSelect={() => select(clip.id)}
                  onHover={(h) => setHoveredClipId(h ? clip.id : null)}
                  onTogglePlay={() => {
                    setSelectedClipId(clip.id);
                    setPlayingClipId((p) => (p === clip.id ? null : clip.id));
                  }}
                  onStop={() => setPlayingClipId(null)}
              />
            ))}
          </ul>
          <UploadZone onFiles={handleFiles} />
        </aside>

        <section className="ctt-map-wrap">
          <TrackMap
            clips={clips}
            selectedId={selectedClipId}
            hoveredId={hoveredClipId}
            onSelect={select}
            onHover={setHoveredClipId}
          />
          {clips.length === 0 && (
            <div className="ctt-empty"><h2>No tracks yet</h2><p>Drop GoPro clips to map your adventure.</p></div>
          )}
        </section>
      </main>
    </div>
  );
}
