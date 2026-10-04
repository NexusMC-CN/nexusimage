import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { NexusImageError } from 'nexusimage/contracts';
import { SharpImageEngine } from '../src/index.js';

async function createPng(width = 4, height = 2): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 40, g: 120, b: 220, alpha: 1 },
    },
  }).png().toBuffer();
}

async function createOrientedJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 4,
      channels: 3,
      background: { r: 240, g: 30, b: 30 },
    },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
}

describe('SharpImageEngine', () => {
  it('inspects a Buffer and returns shared metadata', async () => {
    const engine = new SharpImageEngine();
    const input = await createPng();

    const metadata = await engine.inspect(input);

    expect(metadata).toMatchObject({
      width: 4,
      height: 2,
      format: 'png',
      mimeType: 'image/png',
      size: input.byteLength,
      orientation: 1,
      animated: false,
    });
  });

  it('accepts Blob and ArrayBuffer sources', async () => {
    const engine = new SharpImageEngine();
    const input = await createPng(3, 5);

    const inputBytes = new Uint8Array(input);
    const fromBlob = await engine.inspect(new Blob([inputBytes.buffer as ArrayBuffer], { type: 'image/png' }));
    const fromArrayBuffer = await engine.inspect(inputBytes.buffer as ArrayBuffer);

    expect([fromBlob.width, fromBlob.height]).toEqual([3, 5]);
    expect([fromArrayBuffer.width, fromArrayBuffer.height]).toEqual([3, 5]);
  });

  it('normalizes EXIF orientation while preserving it in inspect metadata', async () => {
    const engine = new SharpImageEngine();
    const input = await createOrientedJpeg();

    const inspected = await engine.inspect(input);
    const processed = await engine.process(input);

    expect(inspected.orientation).toBe(6);
    expect([processed.width, processed.height]).toEqual([4, 2]);
    expect(processed.metadata.orientation).toBe(1);
    processed.dispose();
  });

  it('processes resize and encodes a Buffer result', async () => {
    const engine = new SharpImageEngine();
    const input = await createPng(12, 8);
    const processed = await engine.process(input, { resize: { width: 6, height: 4 } });

    const encoded = await engine.encode(processed, { type: 'image/webp', quality: 0.7 });

    expect([encoded.width, encoded.height]).toEqual([6, 4]);
    expect(encoded.type).toBe('image/webp');
    expect(Buffer.isBuffer(encoded.buffer)).toBe(true);
    expect(encoded.buffer.length).toBeGreaterThan(0);
    await expect(sharp(encoded.buffer).metadata()).resolves.toMatchObject({ width: 6, height: 4, format: 'webp' });
    processed.dispose();
  });

  it('applies crop, rotation, and flip operations in one process call', async () => {
    const engine = new SharpImageEngine();
    const input = await createPng(10, 6);

    const processed = await engine.process(input, {
      crop: { x: 1, y: 1, width: 2, height: 4 },
      rotate: 90,
      flip: { horizontal: true, vertical: true },
    });

    expect([processed.width, processed.height]).toEqual([4, 2]);
    processed.dispose();
  });

  it('reports Node decoder and encoder capabilities without browser adapters', () => {
    const capabilities = new SharpImageEngine().getCapabilities();

    expect(capabilities.imageDecoder).toBe(false);
    expect(capabilities.createImageBitmap).toBe(false);
    expect(capabilities.canDecode?.('image/jpeg')).toBe(true);
    expect(capabilities.canEncode?.('image/webp')).toBe(true);
    expect(capabilities.canEncode?.('image/bmp')).toBe(false);
  });

  it('uses PNG as the default encode format like the browser contract', async () => {
    const engine = new SharpImageEngine();
    const processed = await engine.process(await createPng());

    const encoded = await engine.encode(processed);

    expect(encoded.type).toBe('image/png');
    await expect(sharp(encoded.buffer).metadata()).resolves.toMatchObject({ format: 'png' });
    processed.dispose();
  });

  it('enforces input and output resource limits at the engine boundary', async () => {
    const engine = new SharpImageEngine();
    const input = await createPng(20, 10);

    await expect(engine.inspect(input, { limits: { maxInputBytes: input.length - 1 } })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
      stage: 'source',
    });
    await expect(engine.process(input, { limits: { maxInputPixels: 100 } })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
      stage: 'decode',
    });
    await expect(engine.process(input, { resize: { width: 20, height: 10 }, limits: { maxOutputPixels: 100 } })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
      stage: 'render',
    });

    const boundedEngine = new SharpImageEngine({ limits: { maxInputBytes: input.length - 1 } });
    await expect(boundedEngine.inspect(input, { limits: { maxInputBytes: input.length * 2 } })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
      stage: 'source',
    });
  });

  it('rejects unsupported browser-only sources with a shared error', async () => {
    const engine = new SharpImageEngine();

    await expect(engine.inspect('https://example.test/image.png' as never)).rejects.toBeInstanceOf(NexusImageError);
    await expect(engine.inspect('https://example.test/image.png' as never)).rejects.toMatchObject({
      code: 'INVALID_SOURCE',
      stage: 'source',
    });
  });
});
