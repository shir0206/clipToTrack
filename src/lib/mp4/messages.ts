import { Mp4Error, type MovieInfo, type Mp4ErrorCode } from './parser';
import { GpmfError } from '../gpmf/decoder';

export interface ParseRequest {
  type: 'parse';
  requestId: string;
  file: File;
}

export interface CancelRequest {
  type: 'cancel';
  requestId: string;
}

export type WorkerRequest = ParseRequest | CancelRequest;

export interface WorkerError {
  code: Mp4ErrorCode | 'INVALID_GPMF' | 'UNKNOWN';
  message: string;
  offset?: number;
}

export type WorkerResponse =
  | { type: 'progress'; requestId: string; progress: number }
  | { type: 'result'; requestId: string; result: MovieInfo }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; error: WorkerError };

export function isParseRequest(value: unknown): value is ParseRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ParseRequest>;
  return (
    candidate.type === 'parse' &&
    typeof candidate.requestId === 'string' &&
    candidate.requestId.length > 0 &&
    candidate.file instanceof Blob
  );
}

export function serializeMp4Error(error: unknown): WorkerError {
  if (error instanceof Mp4Error) {
    return { code: error.code, message: error.message, offset: error.offset };
  }
  if (error instanceof GpmfError) {
    return {
      code: 'INVALID_GPMF',
      message: error.message,
      offset: error.offset,
    };
  }
  return {
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : 'Unknown parser error',
  };
}
