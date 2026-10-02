import { expect, it } from 'vitest';
import { GpmfError } from '../gpmf/decoder';
import { isParseRequest, serializeMp4Error } from './messages';

it('validates worker requests and serializes structured parser errors', () => {
  expect(
    isParseRequest({ type: 'parse', requestId: 'one', file: new Blob() }),
  ).toBe(true);
  expect(
    isParseRequest({ type: 'parse', requestId: '', file: new Blob() }),
  ).toBe(false);
  expect(serializeMp4Error(new Error('boom'))).toEqual({
    code: 'UNKNOWN',
    message: 'boom',
  });
  expect(serializeMp4Error(new GpmfError('bad metadata', 24))).toEqual({
    code: 'INVALID_GPMF',
    message: 'bad metadata',
    offset: 24,
  });
});
