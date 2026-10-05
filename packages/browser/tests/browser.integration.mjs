import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const executablePath = process.env.NEXUSIMAGE_CHROME;
const bundle = await readFile(new URL('../dist/index.js', import.meta.url), 'utf8');
const bundleUrl = `data:text/javascript;base64,${Buffer.from(bundle, 'utf8').toString('base64')}`;
const png = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
);

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
try {
  const page = await browser.newPage();
  const result = await page.evaluate(
    async ({ bundleUrl, png }) => {
      const { NexusImage } = await import(bundleUrl);
      const asset = await NexusImage.load(new Blob([new Uint8Array(png)], { type: 'image/png' }));
      const processed = await NexusImage.process(asset, { resize: { width: 2 }, orientation: 'normalize' });
      const encoded = await NexusImage.encode(processed, { type: 'image/webp', quality: 0.8 });
      const output = {
        input: [asset.metadata.width, asset.metadata.height],
        output: [processed.width, processed.height],
        type: encoded.blob.type,
        size: encoded.blob.size,
      };
      processed.dispose();
      asset.dispose();
      return output;
    },
    { bundleUrl, png: Array.from(png) },
  );
  if (
    result.input[0] !== 1 ||
    result.input[1] !== 1 ||
    result.output[0] !== 2 ||
    result.output[1] !== 2 ||
    result.type !== 'image/webp' ||
    result.size <= 0
  ) {
    throw new Error(`Unexpected browser result: ${JSON.stringify(result)}`);
  }
  console.log(`browser integration passed: ${JSON.stringify(result)}`);

  const orientationResult = await page.evaluate(async (bundleUrl) => {
    const { NexusImage } = await import(bundleUrl);
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 2;
    sourceCanvas.height = 4;
    const context = sourceCanvas.getContext('2d');
    context.fillStyle = '#f00';
    context.fillRect(0, 0, 2, 2);
    context.fillStyle = '#00f';
    context.fillRect(0, 2, 2, 2);
    const jpeg = await new Promise((resolve) => sourceCanvas.toBlob(resolve, 'image/jpeg', 0.95));
    const raw = new Uint8Array(await jpeg.arrayBuffer());
    const tiff = new Uint8Array([
      0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const payload = new Uint8Array(6 + tiff.length);
    payload.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
    payload.set(tiff, 6);
    const segment = new Uint8Array(4 + payload.length);
    segment.set([0xff, 0xe1, 0x00, payload.length + 2], 0);
    segment.set(payload, 4);
    const oriented = new Uint8Array(raw.length + segment.length);
    oriented.set(raw.subarray(0, 2), 0);
    oriented.set(segment, 2);
    oriented.set(raw.subarray(2), 2 + segment.length);
    const asset = await NexusImage.load(new Blob([oriented], { type: 'image/jpeg' }));
    const processed = await NexusImage.process(asset, { orientation: 'normalize' });
    const encoded = await NexusImage.encode(processed, { type: 'image/png' });
    const bitmap = await createImageBitmap(encoded.blob);
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = bitmap.width;
    outputCanvas.height = bitmap.height;
    const outputContext = outputCanvas.getContext('2d');
    outputContext.drawImage(bitmap, 0, 0);
    const pixels = outputContext.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const sample = (x, y) => [pixels[(y * bitmap.width + x) * 4], pixels[(y * bitmap.width + x) * 4 + 2]];
    bitmap.close();
    const output = {
      metadata: [asset.metadata.width, asset.metadata.height, asset.metadata.orientation],
      processed: [processed.width, processed.height],
      pixels: [sample(1, 1), sample(3, 1)],
    };
    processed.dispose();
    asset.dispose();
    return output;
  }, bundleUrl);
  if (
    orientationResult.metadata[0] !== 2 ||
    orientationResult.metadata[1] !== 4 ||
    orientationResult.metadata[2] !== 6 ||
    orientationResult.processed[0] !== 4 ||
    orientationResult.processed[1] !== 2 ||
    orientationResult.pixels[0][1] <= orientationResult.pixels[0][0] ||
    orientationResult.pixels[1][0] <= orientationResult.pixels[1][1]
  ) {
    throw new Error(`Unexpected EXIF orientation result: ${JSON.stringify(orientationResult)}`);
  }
  console.log(`browser EXIF orientation integration passed: ${JSON.stringify(orientationResult)}`);
} finally {
  await browser.close();
}
