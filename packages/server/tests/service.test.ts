import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { NexusImageError } from '@nexusmc-cn/nexusimage/contracts';
import type {
  EncodeOptions,
  ImageCapabilities,
  ImageMetadata,
  LoadOptions,
  ProcessOptions,
} from '@nexusmc-cn/nexusimage/contracts';
import {
  createNexusImageService,
  NexusImageService,
  type NodeEncodedImage,
  type NodeImageAsset,
  type NodeProcessedImage,
  type NexusImageServiceApi,
  type NodeAnimationEngineApi,
} from '../src/index.js';

const metadata: ImageMetadata = {
  width: 2,
  height: 1,
  mimeType: 'image/png',
  size: 8,
  orientation: 1,
  exif: {},
  format: 'png',
  animated: false,
};

function createEngineMock(): NexusImageServiceApi {
  const asset: NodeImageAsset = { metadata, dispose: vi.fn() };
  const processed: NodeProcessedImage = { width: 2, height: 1, metadata, dispose: vi.fn() };
  const encoded: NodeEncodedImage = {
    buffer: Buffer.from([1, 2, 3]),
    type: 'image/png',
    width: 2,
    height: 1,
    metadata,
  };
  return {
    load: vi.fn(async (_source: Buffer, _options?: LoadOptions) => asset),
    inspect: vi.fn(async (_source: Buffer, _options?: LoadOptions) => metadata),
    process: vi.fn(async (_source: Buffer | NodeImageAsset, _options?: ProcessOptions) => processed),
    encode: vi.fn(async (_image: NodeProcessedImage, _options?: EncodeOptions) => encoded),
    getCapabilities: vi.fn((): ImageCapabilities => ({
      htmlImage: false,
      offscreenCanvas: false,
      createImageBitmap: false,
      imageDecoder: false,
      canvasToBlob: false,
    })),
  };
}

describe('NexusImageService', () => {
  it('delegates the public service operations to the injected engine', async () => {
    const engine = createEngineMock();
    const service = new NexusImageService({ engine });
    const source = Buffer.from([1, 2, 3]);
    const processOptions = { rotate: 90 } satisfies ProcessOptions;
    const encodeOptions = { type: 'image/webp', quality: 0.8 } satisfies EncodeOptions;

    await expect(service.load(source)).resolves.toBe(await engine.load(source));
    await expect(service.inspect(source)).resolves.toBe(metadata);
    const processed = await service.process(source, processOptions);
    const encoded = await service.encode(processed, encodeOptions);

    expect(processed).toBe(await engine.process(source, processOptions));
    expect(encoded).toBe(await engine.encode(processed, encodeOptions));
    expect(service.getCapabilities()).toEqual(engine.getCapabilities());
    expect(engine.inspect).toHaveBeenCalledWith(source, undefined);
    expect(engine.process).toHaveBeenCalledWith(source, processOptions);
    expect(engine.encode).toHaveBeenCalledWith(processed, encodeOptions);
  });

  it('creates a working Sharp-backed service by default', async () => {
    const input = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 4,
        background: { r: 30, g: 60, b: 90, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const service = createNexusImageService();

    const inspected = await service.inspect(input);
    const processed = await service.process(input, { resize: { width: 2, height: 2 } });

    expect(inspected).toMatchObject({ width: 3, height: 2, format: 'png' });
    expect([processed.width, processed.height]).toEqual([2, 2]);
    processed.dispose();
  });

  it('delegates explicit animation transcoding to the configured engine', async () => {
    const engine = createEngineMock();
    const source = Buffer.from([1, 2, 3]);
    const options = { type: 'image/gif' as const, resize: { width: 24 } };
    const result = {
      buffer: Buffer.from([4, 5, 6]),
      type: 'image/gif' as const,
      width: 24,
      height: 12,
      frameCount: 2,
      durationMs: 120,
    };
    const animationEngine: NodeAnimationEngineApi = { transcodeAnimation: vi.fn(async () => result) };
    const service = new NexusImageService({ engine, animationEngine });

    await expect(service.transcodeAnimation(source, options)).resolves.toBe(result);
    expect(animationEngine.transcodeAnimation).toHaveBeenCalledWith(source, options);
    expect(engine.process).not.toHaveBeenCalled();
    expect(engine.encode).not.toHaveBeenCalled();
  });

  it('reports the missing optional animation engine without first-frame fallback', async () => {
    const engine = createEngineMock();
    const service = new NexusImageService({ engine });

    await expect(service.transcodeAnimation(Buffer.from([1]), { type: 'image/gif' })).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      stage: 'capability',
    } satisfies Partial<NexusImageError>);
    expect(engine.process).not.toHaveBeenCalled();
    expect(engine.encode).not.toHaveBeenCalled();
  });

  it('reports missing animation options with the public error contract', async () => {
    const service = new NexusImageService({ engine: createEngineMock() });

    await expect(
      service.transcodeAnimation(Buffer.from([1]), undefined as unknown as { type: 'image/gif' }),
    ).rejects.toMatchObject({ code: 'ENCODE_FAILED', stage: 'encode' });
  });
});
