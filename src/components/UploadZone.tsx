import { useRef, useState } from 'react';

type Props = { onFiles: (files: File[]) => void };

export default function UploadZone({ onFiles }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handle = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => /\.json$/i.test(f.name));
    if (files.length) onFiles(files);
    if (input.current) input.current.value = ''; // allow re-selecting the same file
  };

  return (
    <div
      className={`ctt-upload${over ? ' is-over' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Add clip metadata JSON"
      onClick={() => input.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
    >
      <strong>Drag &amp; drop clip metadata</strong>
      <span>or click to browse · JSON · Processed locally</span>
      <input ref={input} type="file" accept=".json,application/json" multiple hidden onChange={(e) => handle(e.target.files)} />
    </div>
  );
}
