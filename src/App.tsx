import {
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import ExportPanel from './ExportPanel';
import ClipToTrack from '/components/ClipToTrack';
import { discoverClips, type SourceFile } from './lib/discovery';
import {
  collectDirectory,
  collectDrop,
  detectCapabilities,
  type DirectoryHandle,
  type ImportResult,
} from './lib/imports';

type DirectoryWindow = Window & {
  showDirectoryPicker?: () => Promise<DirectoryHandle>;
};

function fileSources(files: FileList | File[]): SourceFile[] {
  return Array.from(files).map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
}

function formatBytes(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export default function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [sources, setSources] = useState<SourceFile[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const discovery = useMemo(() => discoverClips(sources), [sources]);
  const capabilities = detectCapabilities(
    window,
    document.createElement('input'),
  );

  function accept(result: ImportResult | SourceFile[]) {
    setSources(Array.isArray(result) ? result : result.files);
    setImportWarnings(Array.isArray(result) ? [] : result.warnings);
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) accept(fileSources(event.target.files));
    event.target.value = '';
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    accept(await collectDrop(event.dataTransfer));
  }

  async function chooseFolder() {
    const picker = (window as DirectoryWindow).showDirectoryPicker;
    if (typeof picker === 'function') {
      try {
        accept(await collectDirectory(await picker()));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        setImportWarnings([
          'The folder could not be opened. Try choosing the files instead.',
        ]);
      }
      return;
    }
    folderInput.current?.click();
  }

  const ignoredLabel = `${discovery.ignoredCount} unrelated ${discovery.ignoredCount === 1 ? 'file' : 'files'} ignored`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ClipToTrack home">
          <span className="brand-mark" aria-hidden="true">
            CT
          </span>
          <span>ClipToTrack</span>
        </a>
        <div className="privacy-pill">
          <span className="privacy-dot" aria-hidden="true" />
          Local processing
        </div>
      </header>
      <main id="top">
        <section className="intro" aria-labelledby="page-title">
          <p className="eyebrow">GoPro telemetry workspace</p>
          <h1 id="page-title">ClipToTrack</h1>
          <p className="lede">
            Select a GoPro recording to find its MP4, LRV, and thumbnail
            companions, then export GPX, CSV, GeoJSON, or complete JSON. Your
            files stay in this browser.
          </p>
        </section>
        <section
          className={`drop-zone${dragging ? ' is-dragging' : ''}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDragging(false);
          }}
          onDrop={handleDrop}
          aria-label="File drop area"
        >
          <div className="drop-icon" aria-hidden="true">
            <span />
          </div>
          <h2>Drop GoPro files or a folder</h2>
          <p>MP4, LRV, and THM files are recognized automatically.</p>
          <div className="actions">
            <button
              className="button primary"
              type="button"
              onClick={() => fileInput.current?.click()}
            >
              Choose files
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={chooseFolder}
            >
              Choose folder
            </button>
          </div>
          <input
            ref={fileInput}
            data-testid="file-input"
            className="visually-hidden"
            type="file"
            accept=".mp4,.lrv,.thm"
            multiple
            onChange={handleFiles}
          />
          <input
            ref={(node) => {
              folderInput.current = node;
              node?.setAttribute('webkitdirectory', '');
            }}
            data-testid="folder-input"
            className="visually-hidden"
            type="file"
            multiple
            onChange={handleFiles}
          />
          <p className="fallback-note">
            {capabilities.directoryPicker
              ? 'Direct folder access is available in this browser.'
              : 'Folder selection uses your browser’s compatible file picker.'}
          </p>
        </section>
        {(importWarnings.length > 0 || discovery.ignoredCount > 0) && (
          <div className="scan-notes" role="status">
            {discovery.ignoredCount > 0 && <span>{ignoredLabel}</span>}
            {importWarnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        )}
        {sources.length === 0 ? (
          <section
            className="empty-state"
            aria-label="How file discovery works"
          >
            <div>
              <strong>01</strong>
              <span>Choose recordings</span>
            </div>
            <div>
              <strong>02</strong>
              <span>Review clip groups</span>
            </div>
            <div>
              <strong>03</strong>
              <span>LRV is preferred</span>
            </div>
          </section>
        ) : (
          <section className="results" aria-labelledby="results-title">
            <div className="results-heading">
              <div>
                <p className="eyebrow">Discovery complete</p>
                <h2 id="results-title">
                  {discovery.clips.length}{' '}
                  {discovery.clips.length === 1 ? 'clip' : 'clips'} found
                </h2>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() => accept([])}
              >
                Clear selection
              </button>
            </div>
            <div className="clip-grid">
              {discovery.clips.map((clip) => (
                <article
                  className="clip-card"
                  data-testid="clip-card"
                  key={clip.id}
                >
                  <div className="clip-card-top">
                    <div>
                      <p className="clip-directory">
                        {clip.directory || 'Selected files'}
                      </p>
                      <h3>{clip.name}</h3>
                    </div>
                    <span className="file-count">
                      {clip.files.length} files
                    </span>
                  </div>
                  <dl className="clip-details">
                    <div>
                      <dt>Telemetry source</dt>
                      <dd>
                        {clip.telemetrySource?.file.name ?? 'None available'}
                      </dd>
                    </div>
                    <div>
                      <dt>Total size</dt>
                      <dd>{formatBytes(clip.totalSize)}</dd>
                    </div>
                  </dl>
                  <div className="file-list" aria-label="Files in clip">
                    {clip.files.map((source) => (
                      <div key={`${source.path}:${source.file.size}`}>
                        <span>{source.file.name}</span>
                        <span>{formatBytes(source.file.size)}</span>
                      </div>
                    ))}
                  </div>
                  {clip.warnings.length > 0 && (
                    <ul className="warnings">
                      {clip.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  <ExportPanel
                    key={clip.id}
                    clip={clip}
                    savePickerAvailable={capabilities.saveFilePicker}
                  />
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      <ClipToTrack></ClipToTrack>
      <footer>
        <span>Files never leave your device</span>
        <span>Phase 6 · Export formats</span>
      </footer>
    </div>
  );
}
