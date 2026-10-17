import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { SharpImageEngine, type NodeImageSource } from '../../src/index.js';

const sourceKinds = ['Uint8Array', 'ArrayBuffer', 'Buffer', 'Uint8Array subarray'] as const;
type SourceKind = (typeof sourceKinds)[number];

let originalPng: Buffer;
let replacementPng: Buffer;

beforeAll(async () => {
  originalPng = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  replacementPng = await sharp({
    create: { width: 20, height: 20, channels: 3, background: { r: 0, g: 0, b: 255 } },
  })
    .png()
    .toBuffer();
});

function createMutableSource(kind: SourceKind): { source: NodeImageSource; bytes: Uint8Array } {
  const length = Math.max(originalPng.byteLength, replacementPng.byteLength);
  const offset = kind === 'Uint8Array subarray' ? 7 : 0;
  const padding = kind === 'Uint8Array subarray' ? 11 : 0;
  const storage = new Uint8Array(offset + length + padding).fill(0xa5);
  const bytes = storage.subarray(offset, offset + length);
  bytes.fill(0);
  bytes.set(originalPng);

  if (kind === 'ArrayBuffer') return { source: storage.buffer, bytes };
  if (kind === 'Buffer') return { source: Buffer.from(storage.buffer), bytes };
  return { source: bytes, bytes };
}

function createBoundedEngine(): SharpImageEngine {
  return new SharpImageEngine({ limits: { maxInputPixels: 4, maxInputWidth: 2, maxInputHeight: 2 } });
}

async function expectOriginalRedPixel(png: Buffer): Promise<void> {
  const decoded = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });

  expect(decoded.info).toMatchObject({ width: 1, height: 1, channels: 3 });
  expect(Array.from(decoded.data)).toEqual([255, 0, 0]);
}

describe('Node input ownership', () => {
  it.each(sourceKinds)('owns %s bytes after load when the caller replaces its storage', async (kind) => {
    const engine = createBoundedEngine();
    const { source, bytes } = createMutableSource(kind);
    const asset = await engine.load(source);

    try {
      bytes.fill(0);
      bytes.set(replacementPng);

      const processed = await engine.process(asset, { resize: { width: 1, height: 1 } });
      try {
        const encoded = await engine.encode(processed, { type: 'image/png' });

        await expectOriginalRedPixel(encoded.buffer);
      } finally {
        processed.dispose();
      }
    } finally {
      asset.dispose();
    }
  });

  it.each(sourceKinds)('owns %s bytes before process returns its promise', async (kind) => {
    const engine = createBoundedEngine();
    const { source, bytes } = createMutableSource(kind);

    const pending = engine.process(source, { resize: { width: 1, height: 1 } });
    bytes.fill(0);
    bytes.set(replacementPng);

    const processed = await pending;
    try {
      const encoded = await engine.encode(processed, { type: 'image/png' });

      await expectOriginalRedPixel(encoded.buffer);
    } finally {
      processed.dispose();
    }
  });
});
