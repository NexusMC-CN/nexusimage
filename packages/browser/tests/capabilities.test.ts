import { describe, expect, it, vi } from 'vitest';
import { getCapabilities, probeCapabilities } from '../src/capabilities';
import { canDecode, canEncode } from '../src/capabilities';

describe('capability detection', () => {
  it('keeps synchronous capability results to a conservative lower bound', () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal('HTMLCanvasElement', { prototype: { toBlob: vi.fn() } });

    const capabilities = getCapabilities();

    expect(capabilities.decodeFormats).toEqual(['jpeg', 'png']);
    expect(capabilities.encodeFormats).toEqual(['png']);
    expect(canDecode('image/avif', capabilities)).toBe(false);
    expect(canEncode('image/webp', capabilities)).toBe(false);
  });

  it('probes ImageDecoder and canvas output MIME types before claiming support', async () => {
    const supportedTypes = new Set(['image/png', 'image/webp']);
    vi.stubGlobal('ImageDecoder', {
      isTypeSupported: vi.fn(async (type: string) => supportedTypes.has(type)),
    });
    const toBlob = vi.fn((callback: (blob: Blob | null) => void, type?: string) => {
      callback(type && supportedTypes.has(type) ? new Blob(['x'], { type }) : new Blob(['x'], { type: 'image/png' }));
    });
    vi.stubGlobal('HTMLCanvasElement', { prototype: { toBlob } });

    const capabilities = await probeCapabilities();

    expect(capabilities.decodeFormats).toEqual(['png', 'webp']);
    expect(capabilities.encodeFormats).toEqual(['png', 'webp']);
    expect(canDecode('image/png', capabilities)).toBe(true);
    expect(canDecode('image/avif', capabilities)).toBe(false);
    expect(canEncode('image/webp', capabilities)).toBe(true);
    expect(canEncode('image/jpeg', capabilities)).toBe(false);
    expect(toBlob).toHaveBeenCalled();
  });
});
