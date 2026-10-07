import { useCallback, useRef, useState } from 'react';
import ExampleUploadPrompt, {
  type UploadChoice,
} from '../components/ExampleUploadPrompt';
import { exampleState } from '../components/exampleProject';

/**
 * Guards uploads made while the example project is open.
 *
 *   const { ask, prompt } = useExampleUploadPrompt();
 *   // in the upload handler:
 *   const choice = await ask(activeProjectId);
 *   if (choice === 'cancel') return;
 *   const ids = await addFiles(files);
 *   if (choice === 'keep') <existing code: adopt ids into the viewed project>
 *   // 'auto': do not adopt; the automatic grouping places the clips
 *   // and render {prompt} once in App.
 */
const AUTO_KEY = 'clip-to-track:example-upload-auto:v1';
const rememberedAuto = () => {
  try {
    return localStorage.getItem(AUTO_KEY) === '1';
  } catch {
    return false;
  }
};

export function useExampleUploadPrompt() {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((c: UploadChoice) => void) | null>(null);

  const ask = useCallback((activeProjectId: string | null) => {
    const { enabled, projectId } = exampleState();
    const inExample = enabled && !!projectId && activeProjectId === projectId;
    if (!inExample) return Promise.resolve<UploadChoice>('keep'); // today's behaviour
    // they picked "New Project" before: don't ask again
    if (rememberedAuto()) return Promise.resolve<UploadChoice>('auto');
    resolver.current?.('cancel'); // a second upload while the popup is open replaces it
    return new Promise<UploadChoice>((resolve) => {
      resolver.current = resolve;
      setOpen(true);
    });
  }, []);

  const choose = useCallback((c: UploadChoice) => {
    if (c === 'auto') {
      try {
        localStorage.setItem(AUTO_KEY, '1');
      } catch {
        /* ignore */
      }
    }
    resolver.current?.(c);
    resolver.current = null;
    setOpen(false);
  }, []);

  return {
    ask,
    prompt: open ? <ExampleUploadPrompt onChoose={choose} /> : null,
  };
}
