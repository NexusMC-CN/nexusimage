import { expect, it } from 'vitest';
import { NexusImage } from '../src/index';
import { vi } from 'vitest';
import { parseExif } from '../src/exif/parser';
import { fixtureWithOrientation6AndDate } from './fixtures';

it('exposes the approved public service', () => {
  for (const key of ['load', 'inspect', 'process', 'encode', 'getCapabilities'] as const) {
    expect(typeof NexusImage[key]).toBe('function');
  }
});

it('rejects empty input with a source error', async () => {
  await expect(NexusImage.load(new Blob())).rejects.toMatchObject({ code: 'INVALID_SOURCE', stage: 'source' });
});

it('rejects decoding in Node with a clear capability error', async () => {
  await expect(NexusImage.load(new Blob(['bytes'], { type: 'image/png' })))
    .rejects.toMatchObject({ code: 'UNSUPPORTED', stage: 'decode' });
});

it('falls back to createImageBitmap after a non-abort ImageDecoder failure', async () => {
  class BrokenDecoder {
    constructor(_options: { data: ArrayBuffer; type: string }) {}
    async decode() { throw new Error('unsupported codec'); }
    close() {}
  }
  const close = vi.fn();
  vi.stubGlobal('ImageDecoder', BrokenDecoder);
  vi.stubGlobal('createImageBitmap', async () => ({ width: 3, height: 2, close }));
  const asset = await NexusImage.load(new Blob(['image'], { type: 'image/png' }));
  expect(asset.metadata).toMatchObject({ width: 3, height: 2 });
  asset.dispose();
  expect(close).toHaveBeenCalledTimes(1);
});

it('strips JPEG EXIF orientation before browser decoding', async () => {
  let decodedBlob: Blob | undefined;
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    decodedBlob = blob;
    return { width: 2, height: 4, close() {} };
  });
  const asset = await NexusImage.load(new Blob([fixtureWithOrientation6AndDate()], { type: 'image/jpeg' }));
  expect(parseExif(new Uint8Array(await decodedBlob!.arrayBuffer())).orientation).toBe(1);
  expect(asset.metadata.orientation).toBe(6);
  asset.dispose();
});

it('releases a processed surface when encoding is aborted', async () => {
  let pendingEncode!: (blob: Blob) => void;
  class FakeImage {
    decoding = '';
    naturalWidth = 1;
    naturalHeight = 1;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
  }
  const context = { save() {}, restore() {}, translate() {}, scale() {}, transform() {}, fillRect() {}, drawImage() {}, fillStyle: '' };
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context, toBlob: (callback: (blob: Blob | null) => void) => { pendingEncode = (blob) => callback(blob); } }) });
  const asset = await NexusImage.load(new Blob(['image'], { type: 'image/png' }));
  const processed = await NexusImage.process(asset);
  const controller = new AbortController();
  const pending = NexusImage.encode(processed, { signal: controller.signal });
  controller.abort();
  pendingEncode(new Blob(['encoded'], { type: 'image/png' }));
  await expect(pending).rejects.toMatchObject({ code: 'ABORTED', stage: 'encode' });
  await expect(NexusImage.encode(processed)).rejects.toMatchObject({ code: 'INVALID_SOURCE' });
  asset.dispose();
});

it('preserves cancellation before allocating browser resources', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(NexusImage.process(new Blob(['x']), { signal: controller.signal }))
    .rejects.toMatchObject({ code: 'ABORTED' });
});

it('loads, processes, and encodes through the HTML image and canvas fallbacks', async () => {
  const drawImage = vi.fn();
  const context = {
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), transform: vi.fn(),
    fillRect: vi.fn(), drawImage, fillStyle: '',
  };
  const toBlob = vi.fn((callback: (blob: Blob | null) => void, type?: string) => callback(new Blob(['encoded'], { type })));
  class FakeImage {
    decoding = '';
    naturalWidth = 4;
    naturalHeight = 2;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context, toBlob }) });
  const asset = await NexusImage.load(new Blob(['image'], { type: 'image/jpeg' }));
  expect(asset.metadata).toMatchObject({ width: 4, height: 2, mimeType: 'image/jpeg', orientation: 1 });
  const processed = await NexusImage.process(asset, { resize: { width: 2 }, orientation: 'normalize' });
  const encoded = await NexusImage.encode(processed, { type: 'image/webp', quality: 0.75 });
  expect(processed).toMatchObject({ width: 2, height: 1 });
  expect(encoded.blob.type).toBe('image/webp');
  expect(drawImage).toHaveBeenCalled();
  processed.dispose();
  asset.dispose();
});

it('releases a temporary asset when canvas creation fails', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  class FakeImage {
    decoding = '';
    naturalWidth = 1;
    naturalHeight = 1;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', undefined);
  await expect(NexusImage.process(new Blob(['image'], { type: 'image/png' })))
    .rejects.toMatchObject({ code: 'UNSUPPORTED', stage: 'render' });
  expect(revoke).toHaveBeenCalledTimes(1);
  revoke.mockRestore();
});

it('releases a temporary asset when resize validation fails', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  class FakeImage {
    decoding = '';
    naturalWidth = 1;
    naturalHeight = 1;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) });
  await expect(NexusImage.process(new Blob(['image'], { type: 'image/png' }), { resize: { width: 0 } }))
    .rejects.toMatchObject({ code: 'RENDER_FAILED', stage: 'render' });
  expect(revoke).toHaveBeenCalledTimes(1);
  revoke.mockRestore();
});

it('applies crop, rotation, and flip through the public process API', async () => {
  const context = {
    save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(), transform: vi.fn(),
    fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '',
  };
  class FakeImage {
    decoding = '';
    naturalWidth = 4;
    naturalHeight = 2;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
  const asset = await NexusImage.load(new Blob(['image'], { type: 'image/png' }));
  const processed = await NexusImage.process(asset, {
    crop: { x: 0, y: 0, width: 2, height: 2 },
    rotate: 90,
    flip: { horizontal: true },
  });
  expect(processed).toMatchObject({ width: 2, height: 2 });
  expect(context.transform).toHaveBeenCalledTimes(1);
  processed.dispose();
  asset.dispose();
});

it('enforces public input, output, and encoded-byte limits', async () => {
  await expect(NexusImage.load(new Blob(['12345'], { type: 'image/png' }), { limits: { maxInputBytes: 4 } }))
    .rejects.toMatchObject({ code: 'RESOURCE_LIMIT', stage: 'source' });

  const context = {
    save() {}, restore() {}, translate() {}, scale() {}, transform() {}, fillRect() {}, drawImage() {}, fillStyle: '',
  };
  class FakeImage {
    decoding = '';
    naturalWidth = 4;
    naturalHeight = 2;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context, toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob(['12345'], { type: 'image/png' })) }) });
  await expect(NexusImage.process(new Blob(['image'], { type: 'image/png' }), { limits: { maxOutputWidth: 2 } }))
    .rejects.toMatchObject({ code: 'RESOURCE_LIMIT', stage: 'render' });
  const processed = await NexusImage.process(new Blob(['image'], { type: 'image/png' }));
  await expect(NexusImage.encode(processed, { limits: { maxOutputBytes: 4 } }))
    .rejects.toMatchObject({ code: 'RESOURCE_LIMIT', stage: 'encode' });
});
