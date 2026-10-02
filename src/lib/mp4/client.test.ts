import { expect, it } from 'vitest';
import { Mp4WorkerClient, type WorkerLike } from './client';

class FakeWorker implements WorkerLike {
  messages: unknown[] = [];
  terminated = false;
  listener?: (event: MessageEvent) => void;
  failureListener?: () => void;
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent) => void,
  ): void;
  addEventListener(type: 'error' | 'messageerror', listener: () => void): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: ((event: MessageEvent) => void) | (() => void),
  ) {
    if (type === 'message')
      this.listener = listener as (event: MessageEvent) => void;
    else this.failureListener = listener as () => void;
  }
  removeEventListener() {}
  terminate() {
    this.terminated = true;
  }
}

it('cancels an import and releases pending request state', async () => {
  const worker = new FakeWorker();
  const client = new Mp4WorkerClient(worker);
  const operation = client.parse(new File(['video'], 'clip.mp4'));

  operation.cancel();

  await expect(operation.result).rejects.toMatchObject({ code: 'CANCELLED' });
  expect(
    worker.messages.map((message) => (message as { type: string }).type),
  ).toEqual(['parse', 'cancel']);
  expect(client.pendingCount).toBe(0);
  client.dispose();
  expect(worker.terminated).toBe(true);
});

it('rejects retained operations when the worker crashes', async () => {
  const worker = new FakeWorker();
  const client = new Mp4WorkerClient(worker);
  const operation = client.parse(new File(['video'], 'clip.mp4'));

  worker.failureListener?.();

  await expect(operation.result).rejects.toMatchObject({ code: 'UNKNOWN' });
  expect(client.pendingCount).toBe(0);
});
