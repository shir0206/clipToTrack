import { useState } from 'react';
import ClipCard from './ClipCard';
import TrackMap from './TrackMap';
import UploadZone from './UploadZone';
import { clipFromMetadata } from './clipFromMetadata';
import { ROUTE_COLORS, type Clip } from './types';
import sampleMetadata from './GX010753_metadata.json';
import './ClipToTrack.css';

export default function ClipToTrack() {
  // Seeded with the bundled sample; use useState<Clip[]>([]) to start empty.
  const [clips, setClips] = useState<Clip[]>(() => [
    clipFromMetadata(sampleMetadata, 1),
  ]);
  const [error, setError] = useState<string | null>(null);
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
    const added: Clip[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        added.push(clipFromMetadata(JSON.parse(await file.text())));
      } catch (e) {
        errors.push(
          `${file.name}: ${e instanceof Error ? e.message : 'invalid JSON'}`,
        );
      }
    }
    setError(errors.length ? errors.join(' · ') : null);
    if (!added.length) return;

    setClips((prev) => {
      // same id (file + GPS start time) replaces the existing clip in place
      const byId = new Map(prev.map((c) => [c.id, c]));
      added.forEach((c) => byId.set(c.id, c));
      return [...byId.values()].map((c, i) => ({
        ...c,
        index: i + 1,
        color: ROUTE_COLORS[i % ROUTE_COLORS.length],
      }));
    });
    setSelectedClipId(added[0].id);
    setTimeout(() => select(added[0].id), 0); // scroll the new card into view after render
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
            Clips <span>{clips.length}</span>
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
            <div className="ctt-empty">
              <h2>No tracks yet</h2>
              <p>Drop a clip metadata JSON to map your adventure.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
