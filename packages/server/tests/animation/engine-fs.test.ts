import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { NexusImageError } from '@nexusmc-cn/nexusimage/contracts';
import { describe, expect, it, vi } from 'vitest';
import { FfmpegAnimationEngine } from '../../src/animation/engine.js';
import type { runImageCommand } from '../../src/animation/runner.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdtemp: vi.fn(actual.mkdtemp),
    readFile: vi.fn(actual.readFile),
    rm: vi.fn(actual.rm),
    writeFile: vi.fn(actual.writeFile),
  };
});

const input = Buffer.from('GIF89a' + 'source-animation');
const frames = 'frame|pts_time=0.000000|duration_time=0.040000\nframe|pts_time=0.040000|duration_time=0.130000\n';

function engineWithOutput(): FfmpegAnimationEngine {
  const runner: typeof runImageCommand = async (executable, args) => {
    if (executable === 'test-ffmpeg') {
      await writeFile(args.at(-1)!, Buffer.from('GIF89a' + 'encoded-animation'));
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args.includes('-show_frames')) return { code: 0, stdout: frames, stderr: '' };
    return { code: 0, stdout: 'stream|width=2|height=1|pix_fmt=bgra\n', stderr: '' };
  };
  return new FfmpegAnimationEngine({ ffmpegPath: 'test-ffmpeg', ffprobePath: 'test-ffprobe' }, runner);
}

describe('FfmpegAnimationEngine filesystem failures', () => {
  it('reports temporary-directory creation failure as a decode error', async () => {
    const failure = new Error('temporary directory unavailable');
    vi.mocked(mkdtemp).mockRejectedValueOnce(failure);

    await expect(engineWithOutput().transcodeAnimation(input, { type: 'image/gif' })).rejects.toMatchObject({
      code: 'DECODE_FAILED',
      stage: 'decode',
      cause: failure,
    });
  });

  it('reports input staging failure as a decode error', async () => {
    const failure = new Error('input write failed');
    vi.mocked(writeFile).mockRejectedValueOnce(failure);

    await expect(engineWithOutput().transcodeAnimation(input, { type: 'image/gif' })).rejects.toMatchObject({
      code: 'DECODE_FAILED',
      stage: 'decode',
      cause: failure,
    });
  });

  it('reports encoded output read failure as an encode error', async () => {
    const failure = new Error('output read failed');
    vi.mocked(readFile).mockRejectedValueOnce(failure);

    await expect(engineWithOutput().transcodeAnimation(input, { type: 'image/gif' })).rejects.toMatchObject({
      code: 'ENCODE_FAILED',
      stage: 'encode',
      cause: failure,
    });
  });

  it('reports cleanup failure after a successful transcode as an encode error', async () => {
    const failure = new Error('cleanup failed');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rm).mockImplementationOnce(async (path, options) => {
      await actual.rm(path, options);
      throw failure;
    });

    await expect(engineWithOutput().transcodeAnimation(input, { type: 'image/gif' })).rejects.toMatchObject({
      code: 'ENCODE_FAILED',
      stage: 'encode',
      cause: failure,
    });
  });

  it('preserves the primary error if cleanup also fails', async () => {
    const failure = new NexusImageError('UNSUPPORTED', 'capability', 'Probe is unavailable.');
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rm).mockImplementationOnce(async (path, options) => {
      await actual.rm(path, options);
      throw new Error('cleanup failed');
    });
    const runner: typeof runImageCommand = async () => {
      throw failure;
    };
    const engine = new FfmpegAnimationEngine({ ffprobePath: 'test-ffprobe' }, runner);

    await expect(engine.transcodeAnimation(input, { type: 'image/gif' })).rejects.toBe(failure);
  });
});
