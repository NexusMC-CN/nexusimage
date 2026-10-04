import { expect, it, vi } from 'vitest';
import { selectDecoder } from '../src/decode/select';
import { imageDecoderAdapter } from '../src/decode/image-decoder';
import { createImageBitmapAdapter } from '../src/decode/image-bitmap';
import { htmlImageAdapter } from '../src/decode/html-image';

const source = {
  blob: new Blob(['image'], { type: 'image/png' }),
  mimeType: 'image/png',
  size: 5,
  dispose() {},
};

it('uses ImageDecoder before createImageBitmap in auto mode', () => {
  const decoder = selectDecoder({ imageDecoder: true, createImageBitmap: true, htmlImage: true, offscreenCanvas: true, canvasToBlob: true }, 'auto');
  expect(decoder.name).toBe('image-decoder');
});

it('reports explicit decoder capability errors', () => {
  expect(() => selectDecoder({ imageDecoder: false, createImageBitmap: false, htmlImage: false, offscreenCanvas: false, canvasToBlob: false }, 'image-decoder'))
    .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED', stage: 'decode' }));
});

it('closes ImageDecoder after decoding while retaining the frame until dispose', async () => {
  let decoderCloseCount = 0;
  let frameCloseCount = 0;
  const frame = { displayWidth: 4, displayHeight: 2, close: () => { frameCloseCount += 1; } };
  class FakeDecoder {
    constructor(_options: { data: ArrayBuffer; type: string }) {}
    async decode() { return { image: frame }; }
    close() { decoderCloseCount += 1; }
  }

  const decoded = await imageDecoderAdapter(FakeDecoder).decode(source);
  expect(decoderCloseCount).toBe(1);
  expect(frameCloseCount).toBe(0);
  decoded.dispose();
  decoded.dispose();
  expect(frameCloseCount).toBe(1);
  expect(decoderCloseCount).toBe(1);
});

it('closes a createImageBitmap result that arrives after cancellation', async () => {
  let resolveBitmap!: (bitmap: { width: number; height: number; close: () => void }) => void;
  const create = vi.fn(() => new Promise<{ width: number; height: number; close: () => void }>((resolve) => {
    resolveBitmap = resolve;
  }));
  const controller = new AbortController();
  const pending = createImageBitmapAdapter(create).decode(source, controller.signal);

  controller.abort();
  const close = vi.fn();
  resolveBitmap({ width: 4, height: 2, close });
  await expect(pending).rejects.toMatchObject({ code: 'ABORTED', stage: 'decode' });
  await Promise.resolve();
  await Promise.resolve();
  expect(close).toHaveBeenCalledTimes(1);
});

it('revokes the HTML image URL and detaches events on cancellation', async () => {
  const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  class FakeImage {
    static instance: FakeImage;
    decoding = '';
    naturalWidth = 4;
    naturalHeight = 2;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { FakeImage.instance = this; }
  }

  const controller = new AbortController();
  const pending = htmlImageAdapter(FakeImage).decode(source, controller.signal);
  await Promise.resolve();
  controller.abort();
  FakeImage.instance.onload?.();
  await expect(pending).rejects.toMatchObject({ code: 'ABORTED', stage: 'decode' });
  expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  expect(FakeImage.instance.onload).toBeNull();
  expect(FakeImage.instance.onerror).toBeNull();
  createObjectUrl.mockRestore();
  revokeObjectUrl.mockRestore();
});

it('revokes the HTML image URL once and detaches events after success', async () => {
  const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  class FakeImage {
    static instance: FakeImage;
    decoding = '';
    naturalWidth = 4;
    naturalHeight = 2;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { FakeImage.instance = this; }
  }

  const pending = htmlImageAdapter(FakeImage).decode(source);
  await Promise.resolve();
  FakeImage.instance.onload?.();
  const decoded = await pending;
  expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  expect(FakeImage.instance.onload).toBeNull();
  expect(FakeImage.instance.onerror).toBeNull();
  decoded.dispose();
  expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
});

it('revokes the HTML image URL once and detaches events after failure', async () => {
  const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  class FakeImage {
    static instance: FakeImage;
    decoding = '';
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { FakeImage.instance = this; }
  }

  const pending = htmlImageAdapter(FakeImage).decode(source);
  await Promise.resolve();
  FakeImage.instance.onerror?.();
  await expect(pending).rejects.toMatchObject({ code: 'DECODE_FAILED', stage: 'decode' });
  expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  expect(FakeImage.instance.onload).toBeNull();
  expect(FakeImage.instance.onerror).toBeNull();
  vi.restoreAllMocks();
});
