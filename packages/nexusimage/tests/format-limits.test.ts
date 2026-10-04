import { expect, it, vi } from 'vitest';
import { canDecode, canEncode, getCapabilities } from '../src/capabilities';
import { detectImageFormat, formatFromMimeType } from '../src/format';
import { normalizeSource } from '../src/source';
import {
  assertDecodedDimensions,
  assertEncodedBytes,
  assertInputBytes,
  assertOutputDimensions,
  DEFAULT_RESOURCE_LIMITS,
  resolveResourceLimits,
} from '../src/limits';

it('detects common image signatures and animation markers', () => {
  expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff])).format).toBe('jpeg');
  expect(detectImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).format).toBe('png');
  const gif = new Uint8Array(23);
  gif.set(new TextEncoder().encode('GIF89a'), 0);
  gif[13] = 0x2c;
  gif[22] = 0x2c;
  expect(detectImageFormat(gif).animated).toBe(true);
  const webp = new Uint8Array(24);
  webp.set(new TextEncoder().encode('RIFF'), 0);
  webp.set(new TextEncoder().encode('WEBP'), 8);
  webp.set(new TextEncoder().encode('VP8X'), 12);
  webp[20] = 0x02;
  expect(detectImageFormat(webp)).toMatchObject({ format: 'webp', animated: true });
  const avif = new Uint8Array(16);
  avif.set(new TextEncoder().encode('ftypavif'), 4);
  expect(detectImageFormat(avif).format).toBe('avif');
});

it('uses a declared MIME type only as a format detection fallback', () => {
  expect(detectImageFormat(new Uint8Array([1, 2, 3]), 'image/jpeg')).toMatchObject({ format: 'jpeg', mimeType: 'image/jpeg' });
  expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff]), 'image/png').format).toBe('jpeg');
  expect(formatFromMimeType('image/jpeg; charset=binary')).toBe('jpeg');
});

it('enforces default and custom resource limits with stable errors', () => {
  expect(DEFAULT_RESOURCE_LIMITS.maxInputBytes).toBeGreaterThan(0);
  const limits = resolveResourceLimits({ maxInputBytes: 10, maxInputPixels: 20, maxInputWidth: 10, maxInputHeight: 10, maxOutputBytes: 10, maxOutputPixels: 20, maxOutputWidth: 10, maxOutputHeight: 10, fetchTimeoutMs: 100 });
  expect(() => assertInputBytes(11, limits)).toThrowError(expect.objectContaining({ code: 'RESOURCE_LIMIT', stage: 'source' }));
  expect(() => assertDecodedDimensions(5, 5, limits)).toThrowError(expect.objectContaining({ code: 'RESOURCE_LIMIT', stage: 'decode' }));
  expect(() => assertOutputDimensions(11, 1, limits)).toThrowError(expect.objectContaining({ code: 'RESOURCE_LIMIT', stage: 'render' }));
  expect(() => assertEncodedBytes(11, limits)).toThrowError(expect.objectContaining({ code: 'RESOURCE_LIMIT', stage: 'encode' }));
  expect(() => resolveResourceLimits({ maxInputBytes: 0 })).toThrowError(expect.objectContaining({ code: 'INVALID_SOURCE' }));
});

it('enforces source byte and URL timeout limits before decoding', async () => {
  await expect(normalizeSource(new Blob(['0123456789']), undefined, { maxInputBytes: 5 }))
    .rejects.toMatchObject({ code: 'RESOURCE_LIMIT', stage: 'source' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: () => new Promise<Blob>(() => {}) })));
  await expect(normalizeSource('https://example.test/slow.png', undefined, { fetchTimeoutMs: 5 }))
    .rejects.toMatchObject({ code: 'RESOURCE_LIMIT', stage: 'source' });
  vi.unstubAllGlobals();
});

it('exposes format capability queries from browser primitives', () => {
  vi.stubGlobal('createImageBitmap', vi.fn());
  vi.stubGlobal('HTMLCanvasElement', { prototype: { toBlob: vi.fn() } });
  const capabilities = getCapabilities();
  expect(capabilities.decodeFormats).toContain('png');
  expect(capabilities.encodeFormats).toEqual(expect.arrayContaining(['png', 'jpeg', 'webp']));
  expect(canDecode('image/png', capabilities)).toBe(true);
  expect(canDecode('image/heic', capabilities)).toBe(false);
  expect(canEncode('image/webp', capabilities)).toBe(true);
  expect(canEncode('image/avif', capabilities)).toBe(false);
  vi.unstubAllGlobals();
});

