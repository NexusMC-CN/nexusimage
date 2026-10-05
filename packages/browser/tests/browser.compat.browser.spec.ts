import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const bundle = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
const bundleUrl = `data:text/javascript;base64,${Buffer.from(bundle, 'utf8').toString('base64')}`;
const png = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
));

test('loads, resizes and encodes a static image in the browser', async ({ page }) => {
  const result = await page.evaluate(async ({ bundleUrl, png }) => {
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
  }, { bundleUrl, png: Array.from(png) });

  expect(result.input).toEqual([1, 1]);
  expect(result.output).toEqual([2, 2]);
  expect(result.type).toBe('image/png');
  expect(result.size).toBeGreaterThan(0);
  expect(result.capabilities.canvasToBlob).toBe(true);
});
