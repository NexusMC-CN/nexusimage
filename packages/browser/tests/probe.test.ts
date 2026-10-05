import { expect, it, vi } from 'vitest';
import { NexusImage, probeImage } from '../src/index';

it('probes a cross-origin URL through HTML image when fetch is blocked by CORS', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );
  class FakeImage {
    decoding = '';
    naturalWidth = 4;
    naturalHeight = 2;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      if (value) queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage);

  await expect(probeImage('https://cdn.example.test/no-cors.png')).resolves.toEqual({
    width: 4,
    height: 2,
    format: 'unknown',
    mimeType: 'application/octet-stream',
    animated: false,
  });
});

it('exposes probe through the public service', () => {
  expect(typeof NexusImage.probe).toBe('function');
});

it('enforces the configured timeout for an HTML image fallback', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );
  class HangingImage {
    decoding = '';
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {}
  }
  vi.stubGlobal('Image', HangingImage);

  await expect(
    probeImage('https://cdn.example.test/hangs.png', { limits: { fetchTimeoutMs: 1 } }),
  ).rejects.toMatchObject({
    code: 'RESOURCE_LIMIT',
    stage: 'source',
  });
});
