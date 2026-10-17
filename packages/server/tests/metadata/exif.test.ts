import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { SharpImageEngine } from '../../src/index.js';

const red = [255, 0, 0];
const green = [0, 255, 0];
const blue = [0, 0, 255];
const yellow = [255, 255, 0];
const magenta = [255, 0, 255];
const cyan = [0, 255, 255];
// Stored rows are red/green/blue and yellow/magenta/cyan. Each pixel is distinct
// so rotation and mirroring can be checked independently of image dimensions.
const storedPixels = [...red, ...green, ...blue, ...yellow, ...magenta, ...cyan];

async function createOrientedImage(format: 'png' | 'webp' | 'tiff', orientation: number): Promise<Buffer> {
  const image = sharp(Buffer.from(storedPixels), { raw: { width: 3, height: 2, channels: 3 } }).withMetadata({
    orientation,
  });
  switch (format) {
    case 'png':
      return image.png().toBuffer();
    case 'webp':
      return image.webp({ lossless: true }).toBuffer();
    case 'tiff':
      return image.tiff({ compression: 'lzw' }).toBuffer();
  }
}

async function readPixels(buffer: Buffer): Promise<number[]> {
  return Array.from(await sharp(buffer).removeAlpha().raw().toBuffer());
}

describe('SharpImageEngine EXIF metadata', () => {
  it.each(['png', 'webp', 'tiff'] as const)('inspects and normalizes orientation 6 from %s EXIF', async (format) => {
    const engine = new SharpImageEngine();
    const input = await createOrientedImage(format, 6);

    const metadata = await engine.inspect(input);
    expect(metadata).toMatchObject({ width: 3, height: 2, orientation: 6, format });

    const processed = await engine.process(input);
    try {
      expect([processed.width, processed.height]).toEqual([2, 3]);
      expect(processed.metadata.orientation).toBe(1);
    } finally {
      processed.dispose();
    }
  });

  it('normalizes orientation 8 when processing a loaded PNG asset', async () => {
    const engine = new SharpImageEngine();
    const asset = await engine.load(await createOrientedImage('png', 8));
    try {
      const processed = await engine.process(asset);
      try {
        expect([processed.width, processed.height]).toEqual([2, 3]);
        expect(processed.metadata.orientation).toBe(1);
        const encoded = await engine.encode(processed);
        // A counterclockwise turn puts blue/cyan at the top and red/yellow at the bottom.
        expect(await readPixels(encoded.buffer)).toEqual([...blue, ...cyan, ...green, ...magenta, ...red, ...yellow]);
      } finally {
        processed.dispose();
      }
    } finally {
      asset.dispose();
    }
  });

  it('normalizes mirrored orientation 2 without changing the dimensions', async () => {
    const engine = new SharpImageEngine();
    const processed = await engine.process(await createOrientedImage('png', 2));
    try {
      expect([processed.width, processed.height]).toEqual([3, 2]);
      expect(processed.metadata.orientation).toBe(1);
      const encoded = await engine.encode(processed);
      expect(await readPixels(encoded.buffer)).toEqual([...blue, ...green, ...red, ...cyan, ...magenta, ...yellow]);
    } finally {
      processed.dispose();
    }
  });

  it.each(['process', 'load'] as const)('honors an explicit preserve orientation option on %s', async (method) => {
    const engine = new SharpImageEngine();
    const input = await createOrientedImage('png', 6);
    const asset = method === 'load' ? await engine.load(input, { orientation: 'preserve' }) : undefined;
    try {
      const processed = asset ? await engine.process(asset) : await engine.process(input, { orientation: 'preserve' });
      try {
        expect([processed.width, processed.height]).toEqual([3, 2]);
        expect(processed.metadata.orientation).toBe(6);
        const encoded = await engine.encode(processed);
        expect(await readPixels(encoded.buffer)).toEqual(storedPixels);
      } finally {
        processed.dispose();
      }
    } finally {
      asset?.dispose();
    }
  });

  it('removes source EXIF from the default encoded output', async () => {
    const engine = new SharpImageEngine();
    const input = await createOrientedImage('png', 8);
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const processed = await engine.process(input);
    try {
      const encoded = await engine.encode(processed);
      const metadata = await sharp(encoded.buffer).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.orientation).toBeUndefined();
    } finally {
      processed.dispose();
    }
  });
});
