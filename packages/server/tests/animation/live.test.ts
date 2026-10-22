import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createFfmpegAnimationEngine } from '../../src/ffmpeg.js';

const ffmpegPath = process.env.NEXUSIMAGE_TEST_FFMPEG ?? 'ffmpeg';
const ffprobePath = process.env.NEXUSIMAGE_TEST_FFPROBE ?? 'ffprobe';
const available = [ffmpegPath, ffprobePath].every(
  (path) => spawnSync(path, ['-version'], { windowsHide: true, timeout: 5_000 }).status === 0,
);
const required = process.env.NEXUSIMAGE_FFMPEG_TEST_REQUIRED === '1';
const supportsAnimatedWebp =
  available &&
  [ffmpegPath, ffprobePath].every((path) => {
    const output = spawnSync(path, ['-hide_banner', '-h', 'demuxer=webp_anim'], { windowsHide: true, timeout: 5_000 });
    return output.status === 0 && output.stdout.toString().includes('Demuxer webp_anim');
  });

async function twoColorAnimation(format: 'gif' | 'webp', loop = 0): Promise<Buffer> {
  const first = Buffer.alloc(4 * 2 * 3);
  const second = Buffer.alloc(4 * 2 * 3);
  for (let index = 0; index < first.length; index += 3) {
    first[index] = 255;
    second[index + 2] = 255;
  }
  const raw = sharp(Buffer.concat([first, second]), { raw: { width: 4, height: 4, channels: 3, pageHeight: 2 } });
  return format === 'gif'
    ? raw.gif({ delay: [40, 130], loop }).toBuffer()
    : raw.webp({ delay: [40, 130], loop }).toBuffer();
}

describe('FFmpeg animation integration', () => {
  if (required) it('has FFmpeg and FFprobe available', () => expect(available).toBe(true));
  if (required)
    it('has animated WebP demuxers for the full format integration tests', () =>
      expect(supportsAnimatedWebp).toBe(true));

  const live = available ? it : it.skip;
  const webpLive = supportsAnimatedWebp ? it : it.skip;

  live('preserves two GIF frames and their distinct delays through a resize', async () => {
    const engine = createFfmpegAnimationEngine({ ffmpegPath, ffprobePath });
    const input = await twoColorAnimation('gif');
    const result = await engine.transcodeAnimation(input, {
      type: 'image/gif',
      resize: { width: 8, height: 4, fit: 'fill' },
    });

    expect(result).toMatchObject({ type: 'image/gif', width: 8, height: 4, frameCount: 2 });
    expect(result.durationMs).toBeGreaterThanOrEqual(160);
    expect(result.durationMs).toBeLessThanOrEqual(180);
    const metadata = await sharp(result.buffer, { animated: true }).metadata();
    expect(metadata).toMatchObject({ format: 'gif', pages: 2, pageHeight: 4, width: 8 });
    expect(metadata.delay).toEqual([40, 130]);
    const decoded = await sharp(result.buffer, { animated: true }).raw().toBuffer({ resolveWithObject: true });
    const frameStride = 8 * 4 * decoded.info.channels;
    expect(decoded.data[0]).toBeGreaterThan(decoded.data[2]!);
    expect(decoded.data[frameStride + 2]).toBeGreaterThan(decoded.data[frameStride]!);
  });

  live('rejects an oversized frame count and duration before encoding', async () => {
    const input = await twoColorAnimation('gif');
    const frameLimited = createFfmpegAnimationEngine({ ffmpegPath, ffprobePath, limits: { maxFrames: 1 } });
    const durationLimited = createFfmpegAnimationEngine({
      ffmpegPath,
      ffprobePath,
      limits: { maxDurationMs: 100 },
    });

    await expect(frameLimited.transcodeAnimation(input, { type: 'image/gif' })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
      stage: 'decode',
    });
    await expect(durationLimited.transcodeAnimation(input, { type: 'image/gif' })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
      stage: 'decode',
    });
  });

  live('reports a truncated output as an output-byte resource limit', async () => {
    const engine = createFfmpegAnimationEngine({ ffmpegPath, ffprobePath, limits: { maxOutputBytes: 100 } });
    await expect(
      engine.transcodeAnimation(await twoColorAnimation('gif'), { type: 'image/gif' }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
      stage: 'encode',
    });
  });

  live('applies the documented infinite output loop policy to finite-loop GIF input', async () => {
    const input = await twoColorAnimation('gif', 1);
    expect((await sharp(input, { animated: true }).metadata()).loop).toBe(1);
    const engine = createFfmpegAnimationEngine({ ffmpegPath, ffprobePath });
    const output = await engine.transcodeAnimation(input, { type: 'image/gif' });
    expect((await sharp(output.buffer, { animated: true }).metadata()).loop).toBe(0);
  });

  webpLive('converts every GIF frame to WebP after crop, rotation, and contain resize', async () => {
    const engine = createFfmpegAnimationEngine({ ffmpegPath, ffprobePath });
    const result = await engine.transcodeAnimation(await twoColorAnimation('gif'), {
      type: 'image/webp',
      crop: { x: 1, y: 0, width: 2, height: 2 },
      rotate: 90,
      resize: { width: 6, height: 4, fit: 'contain' },
      quality: 0.75,
    });

    expect(result).toMatchObject({ type: 'image/webp', width: 6, height: 4, frameCount: 2 });
    expect(result.durationMs).toBeGreaterThanOrEqual(167);
    expect(result.durationMs).toBeLessThanOrEqual(173);
    const metadata = await sharp(result.buffer, { animated: true }).metadata();
    expect(metadata).toMatchObject({ format: 'webp', pages: 2, pageHeight: 4, width: 6 });
  });

  webpLive('retains identical consecutive frames in WebP output', async () => {
    const source = spawnSync(
      ffmpegPath,
      [
        '-nostdin',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=4x2:r=10:d=0.2',
        '-frames:v',
        '2',
        '-c:v',
        'gif',
        '-f',
        'gif',
        '-',
      ],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    expect(source.status).toBe(0);
    const engine = createFfmpegAnimationEngine({ ffmpegPath, ffprobePath });

    const result = await engine.transcodeAnimation(source.stdout, { type: 'image/webp' });
    expect(result.frameCount).toBe(2);
    expect((await sharp(result.buffer, { animated: true }).metadata()).pages).toBe(2);
  });

  webpLive('encodes an opaque GIF animation as AVIF', async () => {
    const engine = createFfmpegAnimationEngine({ ffmpegPath, ffprobePath });
    const result = await engine.transcodeAnimation(await twoColorAnimation('gif'), { type: 'image/avif' });

    expect(result).toMatchObject({ type: 'image/avif', width: 4, height: 2, frameCount: 2 });
    expect(result.durationMs).toBeGreaterThanOrEqual(167);
    expect(result.durationMs).toBeLessThanOrEqual(173);
  });

  webpLive('encodes an opaque WebP animation as AVIF and accepts the AVIF as animated input', async () => {
    const engine = createFfmpegAnimationEngine({ ffmpegPath, ffprobePath });
    const avif = await engine.transcodeAnimation(await twoColorAnimation('webp'), {
      type: 'image/avif',
      quality: 0.7,
    });

    expect(avif).toMatchObject({ type: 'image/avif', width: 4, height: 2, frameCount: 2 });
    expect(avif.durationMs).toBeGreaterThanOrEqual(167);
    expect(avif.durationMs).toBeLessThanOrEqual(173);
    const gif = await engine.transcodeAnimation(avif.buffer, { type: 'image/gif' });
    expect(gif).toMatchObject({ type: 'image/gif', width: 4, height: 2, frameCount: 2 });
  });

  webpLive('rejects AVIF encoding when a later WebP frame contains transparency', async () => {
    const pixels = Buffer.alloc(4 * 4 * 4, 255);
    pixels[4 * 2 * 4 + 3] = 0;
    const input = await sharp(pixels, { raw: { width: 4, height: 4, channels: 4, pageHeight: 2 } })
      .webp({ lossless: true, delay: [40, 130] })
      .toBuffer();
    const engine = createFfmpegAnimationEngine({ ffmpegPath, ffprobePath });

    await expect(engine.transcodeAnimation(input, { type: 'image/avif' })).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      stage: 'capability',
    });
  });
});
