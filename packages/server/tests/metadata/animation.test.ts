import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { SharpImageEngine } from '../../src/index.js';

async function createLargeAnimation(): Promise<Buffer> {
  const frame = await sharp({
    create: { width: 1000, height: 1000, channels: 3, background: '#ff0033' },
  })
    .gif()
    .toBuffer();

  // A GIF starts with a 13-byte header/logical screen descriptor, followed by
  // its optional global color table. Keep that prefix once, repeat the complete
  // single-frame blocks, then append one trailer. This avoids rendering or
  // allocating a 300-million-pixel fixture just to exercise metadata inspection.
  const packed = frame[10];
  const colorTableBytes = packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0;
  const headerBytes = 13 + colorTableBytes;
  const frameBlocks = frame.subarray(headerBytes, frame.length - 1);
  return Buffer.concat([
    frame.subarray(0, headerBytes),
    ...Array.from({ length: 300 }, () => frameBlocks),
    Buffer.from([0x3b]),
  ]);
}

describe('SharpImageEngine animation metadata', () => {
  let input: Buffer;

  beforeAll(async () => {
    input = await createLargeAnimation();
  });

  it('inspects one-frame dimensions even when total animation pixels exceed the Sharp limit', async () => {
    const metadata = await new SharpImageEngine().inspect(input);

    expect(metadata).toMatchObject({ width: 1000, height: 1000, animated: true, format: 'gif' });
  });

  it('processes the first frame when the remaining animation frames exceed the Sharp limit', async () => {
    const engine = new SharpImageEngine();
    const processed = await engine.process(input, { resize: { width: 1, height: 1 } });
    try {
      expect([processed.width, processed.height]).toEqual([1, 1]);
      const encoded = await engine.encode(processed);
      await expect(sharp(encoded.buffer).metadata()).resolves.toMatchObject({ width: 1, height: 1, format: 'png' });
    } finally {
      processed.dispose();
    }
  });

  it('still rejects a single frame that exceeds the configured input pixel limit', async () => {
    const engine = new SharpImageEngine({ limits: { maxInputPixels: 999_999 } });

    await expect(engine.inspect(input)).rejects.toMatchObject({ code: 'RESOURCE_LIMIT', stage: 'decode' });
    await expect(engine.process(input, { resize: { width: 1, height: 1 } })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
      stage: 'decode',
    });
  });
});
