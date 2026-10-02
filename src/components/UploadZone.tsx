import { useRef, useState } from 'react';
import SvgIcon from './SvgIcon';

type Props = { onFiles: (files: File[]) => void; busy?: boolean };

export default function UploadZone({ onFiles, busy }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handle = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => /\.(mp4|json)$/i.test(f.name));
    if (files.length) onFiles(files);
    if (input.current) input.current.value = ''; // allow re-selecting the same file
  };

  return (
    <div
      className={`ctt-upload${over ? ' is-over' : ''}${busy ? ' is-busy' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Add GoPro video"
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files);
      }}
    >
      <span className="ctt-upload-ico">
        <SvgIcon name="upload" size={20} />
      </span>
      <strong>{busy ? 'Reading telemetry…' : 'Drag & drop GoPro videos'}</strong>
      <span>or click to browse · MP4 or metadata JSON · Processed locally</span>
      <input
        ref={input}
        type="file"
        accept=".mp4,video/mp4,.json,application/json"
        multiple
        hidden
        onChange={(e) => handle(e.target.files)}
      />
    </div>
  );
}
