import { useRef, useState } from 'react';

type Props = { onFiles: (files: File[]) => void };

export default function UploadZone({ onFiles }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handle = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => /\.(mp4|lrv)$/i.test(f.name));
    if (files.length) onFiles(files);
  };

  return (
    <div
      className={`ctt-upload${over ? ' is-over' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Add GoPro clips"
      onClick={() => input.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
    >
      <strong>Drag &amp; drop GoPro clips</strong>
      <span>or click to browse · MP4 / LRV · Processed locally</span>
      <input ref={input} type="file" accept=".mp4,.lrv,video/mp4" multiple hidden onChange={(e) => handle(e.target.files)} />
    </div>
  );
}
