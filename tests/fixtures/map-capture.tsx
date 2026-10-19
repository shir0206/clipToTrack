import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import MapCapture from '../../src/components/MapCapture/MapCapture';
import type { MapCaptureSource } from '../../src/components/TrackMap/TrackMap';

function Fixture() {
  const [open, setOpen] = useState(true);
  const [playback, setPlayback] = useState({ clipId: 'clip-1', playing: true });
  const canvas = useRef<HTMLCanvasElement>(null);
  const getSource = (): MapCaptureSource => ({
    canvas: canvas.current!,
    subscribeRender: () => () => {},
    requestRender: () => {},
    setRecordingActive: () => {},
  });
  return (
    <>
      <div style={{ height: 50 }}>
        <button
          onClick={() =>
            setPlayback((value) => ({ ...value, playing: !value.playing }))
          }
        >
          Toggle source playback
        </button>
        <button
          onClick={() => setPlayback({ clipId: 'clip-2', playing: true })}
        >
          Switch source clip
        </button>
        <button onClick={() => setOpen(false)}>Remove capture</button>
      </div>
      <main
        style={{
          position: 'relative',
          width: '100vw',
          height: 'calc(100dvh - 50px)',
          background: '#336655',
        }}
      >
        <canvas
          ref={canvas}
          width={1920}
          height={1080}
          style={{ position: 'absolute', width: '100%', height: '100%' }}
        />
        {open && (
          <MapCapture
            getSource={getSource}
            playback={playback}
            preparePlayback={async (position, signal) => {
              Object.assign(window, {
                capturePreparedPosition: position,
                captureResumed: false,
              });
              signal.throwIfAborted();
              return async () => {
                signal.throwIfAborted();
                Object.assign(window, {
                  captureResumed: true,
                  captureResumedAfterReady: !!(
                    window as unknown as { captureFirstFrameReady?: boolean }
                  ).captureFirstFrameReady,
                });
                setPlayback((value) => ({ ...value, playing: true }));
              };
            }}
            clipTitle={'ride:/clip.mp4'}
            hasRoute
            insetBottom={0}
            onClose={() => setOpen(false)}
          />
        )}
      </main>
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
