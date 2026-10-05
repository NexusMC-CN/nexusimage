import { expect, it } from 'vitest';
import { NexusImageError } from '../src/errors';
import { getCapabilities } from '../src/capabilities';

it('preserves the actionable error code, stage and cause', () => {
  const cause = new Error('codec failed');
  const error = new NexusImageError('DECODE_FAILED', 'decode', 'Cannot decode', cause);
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ name: 'NexusImageError', code: 'DECODE_FAILED', stage: 'decode', cause });
});

it('can query capabilities during SSR without browser globals', () => {
  expect(getCapabilities()).toMatchObject({
    imageDecoder: false,
    createImageBitmap: false,
    htmlImage: false,
    offscreenCanvas: false,
    canvasToBlob: false,
  });
});
