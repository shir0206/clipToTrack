import { useState } from 'react';
import ClipCard from './ClipCard';
import TrackMap from './TrackMap';
import UploadZone from './UploadZone';
import { useClips } from './useClips';
import './ClipToTrack.css';

export default function ClipToTrack() {
  const { clips, error, busy, addFiles, clear } = useClips(); // clips persist in localStorage
  const [selectedClipId, setSelectedClipId] = useState<string | null>(
    clips[0]?.id ?? null,
  ); // single source of truth
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);

  const select = (id: string) => {
    setSelectedClipId(id);
    document
      .getElementById(`ctt-${id}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const handleFiles = async (files: File[]) => {
    const firstId = await addFiles(files);
    if (!firstId) return;
    setSelectedClipId(firstId);
    setTimeout(() => select(firstId), 0); // scroll the new card into view after render
  };

  const handleClear = () => {
    setPlayingClipId(null);
    setSelectedClipId(null);
    clear();
  };

  return (
    <div className="ctt-app">
      <header className="ctt-header">
        <div className="ctt-brand">
          <span className="ctt-logo">clip to track</span>
          <span className="ctt-tagline">
            GoPro clips. Mapped to your adventures.
          </span>
        </div>
        <div className="ctt-header-actions">
          <button>Projects</button>
          <button>Settings</button>
        </div>
      </header>

      <main className="ctt-layout">
        <aside className="ctt-panel">
          <div className="ctt-panel-title">
            Clips{' '}
            <span>
              {clips.length > 0 && (
                <button className="ctt-link" onClick={handleClear}>
                  Clear all
                </button>
              )}
              {clips.length}
            </span>
          </div>
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
          {error && (
            <p className="ctt-error" role="alert">
              Couldn’t load {error}
            </p>
          )}
          <UploadZone onFiles={handleFiles} busy={busy} />
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
            <div className="ctt-empty">
              <h2>No tracks yet</h2>
              <p>Drop a GoPro MP4 to map your adventure.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
