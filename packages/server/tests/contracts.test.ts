import { expect, it } from 'vitest';
import type { EncodedImageBase, ImageMetadata } from 'nexusimage/contracts';
import type { NodeEncodedImage } from '../src/types.js';

const metadata: ImageMetadata = {
  width: 1,
  height: 1,
  mimeType: 'image/png',
  size: 1,
  orientation: 1,
  exif: {},
  format: 'png',
  animated: false,
};

it('extends the shared encoded image base shape with Node output fields', () => {
  const encoded: NodeEncodedImage = {
    buffer: Buffer.from([1]),
    type: 'image/png',
    width: 1,
    height: 1,
    metadata,
  };
  const base: EncodedImageBase = encoded;

  expect(base).toMatchObject({ type: 'image/png', width: 1, height: 1 });
  expect(Buffer.isBuffer(encoded.buffer)).toBe(true);
});
