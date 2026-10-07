import { useEffect, useRef } from 'react';
import SvgIcon from './common/SvgIcon';
import './playback/PlaybackHelp.css';

export type UploadChoice = 'keep' | 'auto' | 'cancel';

type Props = {
  /** 'auto' = let the app group the new clips into their own project; 'keep' = add to the example */
  onChoose: (choice: UploadChoice) => void;
};

/**
 * Shown when the person uploads videos while looking at the example project.
 */
export default function ExampleUploadPrompt({ onChoose }: Props) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
  }, []);

  return (
    <div
      className="help-backdrop"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation(); // don't also close the Projects dialog underneath
        onChoose('cancel');
      }}
    >
      <div
        className="help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ctt-up-title"
      >
        <header className="help-header">
          <SvgIcon name="info" size={18} />
          <h2 className="help-title" id="ctt-up-title">
            Add your videos to a new project?
          </h2>
        </header>
        <p className="help-text">
          You’re looking at the example project. Your own videos work best in a
          project of their own: they’ll be grouped by date and place, like any
          other upload, and the example stays as it is.
        </p>
        <footer className="help-footer">
          <button className="link-button" onClick={() => onChoose('cancel')}>
            Cancel
          </button>
          <span className="settings-actions">
            <button className="link-button" onClick={() => onChoose('keep')}>
              Add to the example
            </button>
            <button
              ref={primary}
              className="help-confirm"
              onClick={() => onChoose('auto')}
            >
              New project (recommended)
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}
