import { expect, it } from 'vitest';
import type { EncodedImage, EncodedImageBase } from '../src/types';

it('exposes a shared encoded image base shape for runtime adapters', () => {
  const encoded: EncodedImage = {
    blob: new Blob(['image'], { type: 'image/png' }),
    type: 'image/png',
    width: 1,
    height: 1,
  };
  const base: EncodedImageBase = encoded;

  expect(base).toMatchObject({ type: 'image/png', width: 1, height: 1 });
  expect(encoded.blob).toBeInstanceOf(Blob);
});
