import { useRef, useState } from 'react';
import SvgIcon from '../common/SvgIcon';
import type { UploadProgress } from '../../types';

type Props = {
  onFiles: (files: File[]) => void;
  busy?: boolean;
  progress?: UploadProgress | null;
};

const LABEL = {
  index: 'Reading file index…',
  telemetry: 'Reading telemetry',
  thumbnail: 'Creating thumbnail…',
};

export default function UploadZone({ onFiles, busy, progress }: Props) {
  const pct = progress?.frac == null ? null : Math.round(progress.frac * 100);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handle = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) =>
      /\.(mp4|lrv|json)$/i.test(f.name),
    );
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
      <strong>
        {busy
          ? progress
            ? `${LABEL[progress.phase]}${pct !== null ? ` ${pct}%` : ''}`
            : 'Working…'
          : 'Drag & drop GoPro videos'}
      </strong>
      {busy && progress ? (
        <>
          <span className="ctt-upload-file">
            {progress.of > 1 ? `${progress.n}/${progress.of} · ` : ''}
            {progress.name}
          </span>
          <div
            className="ctt-bar"
            role="progressbar"
            aria-label="Reading file"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
          >
            <i
              className={pct === null ? 'is-indeterminate' : ''}
              style={pct === null ? undefined : { width: `${pct}%` }}
            />
          </div>
        </>
      ) : (
        <span>
          or click to browse · MP4 / LRV or metadata JSON · Processed locally
        </span>
      )}
      <input
        ref={input}
        type="file"
        accept=".mp4,.lrv,video/mp4,.json,application/json"
        multiple
        hidden
        onChange={(e) => handle(e.target.files)}
      />
    </div>
  );
}
