import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const bundle = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
const bundleUrl = `data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`;

for (const scenario of [
  'native',
  'unavailable',
  'constructor throws',
  'context null',
  'context throws',
  'encoding rejects',
  'encoding throws',
  'MIME mismatch',
] as const) {
  test(`probes actual encoding support: ${scenario}`, async ({ page, browserName }) => {
    const result = await page.evaluate(
      async ({ bundleUrl, scenario }) => {
        const formats = ['png', 'jpeg', 'webp'];
        // Use the native HTML encoder as an independent browser-specific oracle.
        const expected: string[] = [];
        for (const format of formats) {
          const type = `image/${format}`;
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          canvas.getContext('2d');
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type));
          if (blob?.type === type && blob.size > 0) expected.push(format);
        }
        const NativeOffscreen = globalThis.OffscreenCanvas;
        let contextCalls = 0;
        let encodingCalls = 0;
        let fallbackCalls = 0;
        const originalToBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (...args) {
          fallbackCalls++;
          return originalToBlob.apply(this, args);
        };
        if (scenario === 'unavailable') {
          Object.defineProperty(globalThis, 'OffscreenCanvas', { value: undefined, configurable: true });
        } else if (scenario !== 'native') {
          class ProbeOffscreen {
            private canvas: OffscreenCanvas;
            constructor(width: number, height: number) {
              if (scenario === 'constructor throws') throw new Error('construction failed');
              this.canvas = new NativeOffscreen(width, height);
            }
            getContext() {
              contextCalls++;
              if (scenario === 'context null') return null;
              if (scenario === 'context throws') throw new Error('context failed');
              return this.canvas.getContext('2d');
            }
            convertToBlob(options?: ImageEncodeOptions) {
              encodingCalls++;
              if (scenario === 'encoding throws') throw new Error('encoding failed');
              if (scenario === 'encoding rejects') {
                return Promise.reject(new DOMException('encoding failed', 'EncodingError'));
              }
              // Exercise a real native PNG fallback rather than inventing a blob type.
              return this.canvas.convertToBlob({ ...options, type: 'image/png' });
            }
          }
          Object.defineProperty(globalThis, 'OffscreenCanvas', { value: ProbeOffscreen, configurable: true });
        }
        const { probeCapabilities } = await import(bundleUrl);
        const capabilities = await probeCapabilities();
        const cached = await probeCapabilities();
        const callsBeforeUncached = contextCalls + encodingCalls + fallbackCalls;
        const fresh = await probeCapabilities({ cache: false });
        return {
          expected,
          formats: capabilities.encodeFormats,
          queries: formats.filter((format) => capabilities.canEncode(`image/${format}`)),
          sameCached: cached === capabilities,
          freshObject: fresh !== capabilities,
          freshFormats: fresh.encodeFormats,
          contextCalls,
          encodingCalls,
          fallbackCalls,
          callsBeforeUncached,
        };
      },
      { bundleUrl, scenario },
    );

    const expected = scenario === 'MIME mismatch' ? ['png'] : result.expected;
    expect(result.formats).toEqual(expected);
    expect(result.queries).toEqual(expected);
    expect(result.sameCached).toBe(true);
    expect(result.freshObject).toBe(true);
    expect(result.freshFormats).toEqual(expected);
    if (browserName === 'chromium' && scenario === 'native') {
      expect(result.formats).toEqual(['png', 'jpeg', 'webp']);
    }
    if (scenario === 'context null' || scenario === 'context throws') {
      expect(result.contextCalls).toBeGreaterThan(0);
      expect(result.encodingCalls).toBe(0);
    }
    if (scenario === 'MIME mismatch') {
      expect(result.fallbackCalls).toBe(0);
    } else if (scenario !== 'native') {
      expect(result.fallbackCalls).toBeGreaterThan(0);
    }
    if (scenario !== 'native') {
      expect(result.contextCalls + result.encodingCalls + result.fallbackCalls).toBeGreaterThan(
        result.callsBeforeUncached,
      );
    }
  });
}
