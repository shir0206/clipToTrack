import type { MovieInfo, Mp4ErrorCode } from './parser';
import type { WorkerRequest, WorkerResponse } from './messages';

export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerResponse>) => void,
  ): void;
  addEventListener(type: 'error' | 'messageerror', listener: () => void): void;
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerResponse>) => void,
  ): void;
  removeEventListener(
    type: 'error' | 'messageerror',
    listener: () => void,
  ): void;
  terminate(): void;
}

export interface ParseOperation {
  result: Promise<MovieInfo>;
  cancel(): void;
}

export interface ClientError extends Error {
  code: Mp4ErrorCode | 'INVALID_GPMF' | 'UNKNOWN';
  offset?: number;
}

interface PendingRequest {
  resolve(value: MovieInfo): void;
  reject(reason: ClientError): void;
  onProgress?: (progress: number) => void;
}

function clientError(
  code: Mp4ErrorCode | 'INVALID_GPMF' | 'UNKNOWN',
  message: string,
  offset?: number,
): ClientError {
  return Object.assign(new Error(message), { code, offset });
}

export class Mp4WorkerClient {
  private readonly pending = new Map<string, PendingRequest>();
  private nextId = 0;

  constructor(private readonly worker: WorkerLike) {
    worker.addEventListener('message', this.handleMessage);
    worker.addEventListener('error', this.handleWorkerFailure);
    worker.addEventListener('messageerror', this.handleWorkerFailure);
  }

  get pendingCount() {
    return this.pending.size;
  }

  parse(file: File, onProgress?: (progress: number) => void): ParseOperation {
    const requestId = `mp4-${++this.nextId}`;
    let resolve!: (value: MovieInfo) => void;
    let reject!: (reason: ClientError) => void;
    const result = new Promise<MovieInfo>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    this.pending.set(requestId, { resolve, reject, onProgress });
    this.worker.postMessage({ type: 'parse', requestId, file });
    return {
      result,
      cancel: () => {
        const request = this.pending.get(requestId);
        if (!request) return;
        this.pending.delete(requestId);
        this.worker.postMessage({ type: 'cancel', requestId });
        request.reject(clientError('CANCELLED', 'MP4 parsing was cancelled'));
      },
    };
  }

  dispose() {
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleWorkerFailure);
    this.worker.removeEventListener('messageerror', this.handleWorkerFailure);
    for (const request of this.pending.values())
      request.reject(clientError('CANCELLED', 'MP4 parser was disposed'));
    this.pending.clear();
    this.worker.terminate();
  }

  private readonly handleMessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const request = this.pending.get(message.requestId);
    if (!request) return;
    if (message.type === 'progress') {
      request.onProgress?.(message.progress);
      return;
    }
    this.pending.delete(message.requestId);
    if (message.type === 'result') request.resolve(message.result);
    else if (message.type === 'cancelled')
      request.reject(clientError('CANCELLED', 'MP4 parsing was cancelled'));
    else
      request.reject(
        clientError(
          message.error.code,
          message.error.message,
          message.error.offset,
        ),
      );
  };

  private readonly handleWorkerFailure = () => {
    for (const request of this.pending.values())
      request.reject(
        clientError('UNKNOWN', 'The MP4 parser worker stopped unexpectedly'),
      );
    this.pending.clear();
  };
}

export function createMp4WorkerClient() {
  return new Mp4WorkerClient(
    new Worker(new URL('../../workers/mp4.worker.ts', import.meta.url), {
      type: 'module',
    }),
  );
}
