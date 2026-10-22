import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canDecode, canEncode, getCapabilities, probeCapabilities } from '../src/capabilities.js';

type ContextState = 'available' | 'missing' | 'throws';

function encodedBlob(type: string): Blob {
  return new Blob(['encoded image'], { type });
}

function installHtmlCanvas(
  encode: (type: string) => Blob | null | undefined = encodedBlob,
  context: ContextState = 'available',
): void {
  class HtmlCanvas {
    width = 300;
    height = 150;

    getContext(type: string) {
      if (context === 'throws') throw new Error('Context creation failed.');
      return type === '2d' && context === 'available' ? { canvas: this } : null;
    }

    toBlob(callback: (blob: Blob | null) => void, type = 'image/png') {
      const blob = encode(type);
      if (blob !== undefined) callback(blob);
    }
  }
  vi.stubGlobal('HTMLCanvasElement', HtmlCanvas);
  vi.stubGlobal('document', {
    createElement(name: string) {
      if (name !== 'canvas') throw new Error('Expected a canvas element.');
      return new HtmlCanvas();
    },
  });
}

function installOffscreenCanvas(
  encode: (type: string) => Blob = encodedBlob,
  context: ContextState | 'constructor-throws' = 'available',
): void {
  class OffscreenCanvas {
    private initialized = false;

    constructor(
      readonly width: number,
      readonly height: number,
    ) {
      if (context === 'constructor-throws') throw new Error('Canvas creation failed.');
    }

    getContext(type: string) {
      if (context === 'throws') throw new Error('Context creation failed.');
      this.initialized = type === '2d' && context === 'available';
      return this.initialized ? { canvas: this } : null;
    }

    async convertToBlob({ type = 'image/png' } = {}) {
      if (!this.initialized) throw new Error('A rendering context must be initialized before encoding.');
      if (this.width <= 0 || this.height <= 0) throw new Error('Canvas dimensions must be positive.');
      return encode(type);
    }
  }
  vi.stubGlobal('OffscreenCanvas', OffscreenCanvas);
}

describe('capability detection', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal('HTMLCanvasElement', undefined);
    vi.stubGlobal('document', undefined);
  });

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
    installHtmlCanvas((type) => encodedBlob(supportedTypes.has(type) ? type : 'image/png'));

    const capabilities = await probeCapabilities({ cache: false });

    expect(capabilities.decodeFormats).toEqual(['png', 'webp']);
    expect(capabilities.encodeFormats).toEqual(['png', 'webp']);
    expect(canDecode('image/png', capabilities)).toBe(true);
    expect(canDecode('image/avif', capabilities)).toBe(false);
    expect(canEncode('image/webp', capabilities)).toBe(true);
    expect(canEncode('image/jpeg', capabilities)).toBe(false);
  });

  it('initializes an offscreen 2D context before probing encoders in a worker without document', async () => {
    installOffscreenCanvas();

    const capabilities = await probeCapabilities({ cache: false });

    expect(capabilities.encodeFormats).toEqual(['png', 'jpeg', 'webp']);
    expect(canEncode('image/png', capabilities)).toBe(true);
    expect(canEncode('image/jpeg', capabilities)).toBe(true);
    expect(canEncode('image/webp', capabilities)).toBe(true);
  });

  it.each(['constructor-throws', 'missing', 'throws'] as const)(
    'uses HTML canvas when offscreen construction or context is unusable: %s',
    async (context) => {
      installOffscreenCanvas(encodedBlob, context);
      installHtmlCanvas();

      const capabilities = await probeCapabilities({ cache: false });

      expect(capabilities.encodeFormats).toEqual(['png', 'jpeg', 'webp']);
    },
  );

  it('retries rejected encodings and fallback MIME types with the HTML encoder', async () => {
    installOffscreenCanvas((type) => {
      if (type === 'image/jpeg') throw new Error('JPEG encoding failed.');
      return encodedBlob('image/png');
    });
    installHtmlCanvas((type) => (type === 'image/png' ? null : encodedBlob(type)));

    const capabilities = await probeCapabilities({ cache: false });

    expect(capabilities.encodeFormats).toEqual(['png', 'jpeg', 'webp']);
    expect(canEncode('image/jpeg', capabilities)).toBe(true);
    expect(canEncode('image/webp', capabilities)).toBe(true);
  });

  it('does not claim a codec when both encoders return a fallback MIME type', async () => {
    installOffscreenCanvas(() => encodedBlob('image/png'));
    installHtmlCanvas(() => encodedBlob('image/png'));

    const capabilities = await probeCapabilities({ cache: false });

    expect(capabilities.encodeFormats).toEqual(['png']);
    expect(canEncode('image/jpeg', capabilities)).toBe(false);
    expect(canEncode('image/webp', capabilities)).toBe(false);
  });

  it.each(['missing', 'throws'] as const)(
    'rejects an HTML encoder without a usable 2D context: %s',
    async (context) => {
      installHtmlCanvas(encodedBlob, context);

      const capabilities = await probeCapabilities({ cache: false });

      expect(capabilities.encodeFormats).toEqual([]);
    },
  );

  it('returns no supported encoders when none are available', async () => {
    const capabilities = await probeCapabilities({ cache: false });

    expect(capabilities.encodeFormats).toEqual([]);
    expect(canEncode('image/png', capabilities)).toBe(false);
  });

  it('does not treat an HTML prototype as a usable canvas without document', async () => {
    installHtmlCanvas();
    vi.stubGlobal('document', undefined);

    const capabilities = await probeCapabilities({ cache: false });

    expect(capabilities.encodeFormats).toEqual([]);
  });

  it.each(['constructor-throws', 'missing', 'throws'] as const)(
    'returns no encoders in a worker with unusable OffscreenCanvas: %s',
    async (context) => {
      installOffscreenCanvas(encodedBlob, context);

      const capabilities = await probeCapabilities({ cache: false });

      expect(capabilities.encodeFormats).toEqual([]);
    },
  );

  it('rejects null and empty HTML canvas results', async () => {
    installHtmlCanvas((type) => (type === 'image/png' ? null : new Blob([], { type })));

    const capabilities = await probeCapabilities({ cache: false });

    expect(capabilities.encodeFormats).toEqual([]);
  });

  it('falls back to HTML canvas after an empty offscreen encoding', async () => {
    installOffscreenCanvas((type) => new Blob([], { type }));
    installHtmlCanvas((type) => (type === 'image/webp' ? null : encodedBlob(type)));

    const capabilities = await probeCapabilities({ cache: false });

    expect(capabilities.encodeFormats).toEqual(['png', 'jpeg']);
    expect(canEncode('image/webp', capabilities)).toBe(false);
  });

  it('returns unsupported when the HTML toBlob callback never fires', async () => {
    vi.useFakeTimers();
    try {
      installHtmlCanvas(() => undefined);

      const pending = probeCapabilities({ cache: false, timeoutMs: 10 });
      await vi.runAllTimersAsync();
      const capabilities = await pending;

      expect(capabilities.encodeFormats).toEqual([]);
      expect(canEncode('image/png', capabilities)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reuses cached results while cache:false probes again without replacing the cache', async () => {
    vi.resetModules();
    const { probeCapabilities: probeFreshRuntime } = await import('../src/capabilities.js');
    installOffscreenCanvas();
    const first = await probeFreshRuntime();
    expect(first.encodeFormats).toEqual(['png', 'jpeg', 'webp']);

    installOffscreenCanvas(() => encodedBlob('image/png'));
    const cached = await probeFreshRuntime();
    const refreshed = await probeFreshRuntime({ cache: false });

    expect(cached).toBe(first);
    expect(refreshed.encodeFormats).toEqual(['png']);
    expect(await probeFreshRuntime()).toBe(first);
  });
});
