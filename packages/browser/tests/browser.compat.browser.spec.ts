import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const bundle = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
const bundleUrl = `data:text/javascript;base64,${Buffer.from(bundle, 'utf8').toString('base64')}`;
const png = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
);

test('loads, resizes and encodes a static image in the browser', async ({ page }) => {
  const result = await page.evaluate(
    async ({ bundleUrl, png }) => {
      const { NexusImage } = await import(bundleUrl);
      const asset = await NexusImage.load(new Blob([new Uint8Array(png)], { type: 'image/png' }));
      const processed = await NexusImage.process(asset, { resize: { width: 2 } });
      const encoded = await NexusImage.encode(processed, { type: 'image/png' });
      const output = {
        input: [asset.metadata.width, asset.metadata.height],
        output: [processed.width, processed.height],
        type: encoded.blob.type,
        size: encoded.blob.size,
        capabilities: NexusImage.getCapabilities(),
      };
      processed.dispose();
      asset.dispose();
      return output;
    },
    { bundleUrl, png: Array.from(png) },
  );

  expect(result.input).toEqual([1, 1]);
  expect(result.output).toEqual([2, 2]);
  expect(result.type).toBe('image/png');
  expect(result.size).toBeGreaterThan(0);
  expect(result.capabilities.canvasToBlob).toBe(true);
});

test('resizes a landscape image by height and encodes the expected dimensions', async ({ page }) => {
  const result = await page.evaluate(async (bundleUrl) => {
    const { NexusImage } = await import(bundleUrl);
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const source = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG fixture encoding failed.'))), 'image/png');
    });
    const processed = await NexusImage.process(source, { resize: { height: 400 } });
    try {
      const encoded = await NexusImage.encode(processed, { type: 'image/png' });
      const output = await NexusImage.load(encoded.blob);
      try {
        return {
          processed: [processed.width, processed.height],
          encoded: [output.metadata.width, output.metadata.height],
        };
      } finally {
        output.dispose();
      }
    } finally {
      processed.dispose();
    }
  }, bundleUrl);

  expect(result.processed).toEqual([600, 400]);
  expect(result.encoded).toEqual([600, 400]);
});

test('probes PNG, JPEG and WebP encoders in Chromium', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'This regression asserts Chromium codec support.');
  const result = await page.evaluate(async (bundleUrl) => {
    const { probeCapabilities, canEncode } = await import(bundleUrl);
    const capabilities = await probeCapabilities({ cache: false });
    return {
      encodeFormats: capabilities.encodeFormats,
      png: canEncode('image/png', capabilities),
      jpeg: canEncode('image/jpeg', capabilities),
      webp: canEncode('image/webp', capabilities),
      avif: canEncode('image/avif', capabilities),
    };
  }, bundleUrl);

  expect(result.encodeFormats).toEqual(['png', 'jpeg', 'webp']);
  expect(result.png).toBe(true);
  expect(result.jpeg).toBe(true);
  expect(result.webp).toBe(true);
  expect(result.avif).toBe(false);
});
