/// <reference lib="webworker" />

import { parseMp4 } from '../lib/mp4/parser';
import {
  isParseRequest,
  serializeMp4Error,
  type WorkerRequest,
  type WorkerResponse,
} from '../lib/mp4/messages';

const scope: DedicatedWorkerGlobalScope =
  self as unknown as DedicatedWorkerGlobalScope;
const controllers = new Map<string, AbortController>();

function send(message: WorkerResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

scope.addEventListener(
  'message',
  async (event: MessageEvent<WorkerRequest>) => {
    const message = event.data;
    if (message?.type === 'cancel' && typeof message.requestId === 'string') {
      controllers.get(message.requestId)?.abort();
      return;
    }
    if (!isParseRequest(message)) return;
    const controller = new AbortController();
    controllers.set(message.requestId, controller);
    try {
      const result = await parseMp4(message.file, {
        signal: controller.signal,
        onProgress: (progress) =>
          send({ type: 'progress', requestId: message.requestId, progress }),
      });
      const transfer = result.telemetrySamples.map((sample) => sample.data);
      send({ type: 'result', requestId: message.requestId, result }, transfer);
    } catch (error) {
      if (controller.signal.aborted)
        send({ type: 'cancelled', requestId: message.requestId });
      else
        send({
          type: 'error',
          requestId: message.requestId,
          error: serializeMp4Error(error),
        });
    } finally {
      controllers.delete(message.requestId);
    }
  },
);

export {};
