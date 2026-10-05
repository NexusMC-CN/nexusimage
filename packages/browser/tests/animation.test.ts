import { expect, it } from 'vitest';
import { inspectAnimation } from '../src/decode/animation';

it('reads animated track metadata without decoding a frame', async () => {
  let closeCount = 0;
  let arrayBufferReads = 0;
  const source = new Blob(['animation'], { type: 'image/gif' });
  const decoder = class {
    tracks = {
      ready: Promise.resolve(),
      selectedTrack: { animated: true, frameCount: 12, duration: 840, repetitionCount: 2 },
    };
    constructor(options: { data: ArrayBuffer; type: string }) {
      expect(options.type).toBe('image/gif');
      expect(options.data.byteLength).toBeGreaterThan(0);
    }
    close() {
      closeCount += 1;
    }
  };
  const original = Blob.prototype.arrayBuffer;
  Blob.prototype.arrayBuffer = async function arrayBuffer() {
    arrayBufferReads += 1;
    return original.call(this);
  };
  try {
    await expect(inspectAnimation(source, {}, { decoder })).resolves.toEqual({
      format: 'gif',
      animated: true,
      frameCount: 12,
      duration: 840,
      repetitionCount: 2,
    });
    expect(arrayBufferReads).toBe(1);
    expect(closeCount).toBe(1);
  } finally {
    Blob.prototype.arrayBuffer = original;
  }
});

it('reports a static track when the browser omits animation fields', async () => {
  const decoder = class {
    tracks = { selectedTrack: {} };
    close() {}
  };
  await expect(inspectAnimation(new Blob(['png'], { type: 'image/png' }), {}, { decoder })).resolves.toMatchObject({
    format: 'png',
    animated: false,
    frameCount: 1,
  });
});
