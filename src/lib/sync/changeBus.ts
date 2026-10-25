import type { SyncField } from './syncKeys';

const listeners = new Set<(field: SyncField) => void>();
export const onLocalChange = (listener: (field: SyncField) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const emitLocalChange = (field: SyncField) => {
  listeners.forEach((listener) => listener(field));
};
