import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { FfmpegAnimationEngine } from '../../src/animation/engine.js';
import type { runImageCommand } from '../../src/animation/runner.js';

const input = Buffer.from('GIF89a' + 'source-animation');
const frames = 'frame|pts_time=0.000000|duration_time=0.040000\nframe|pts_time=0.040000|duration_time=0.130000\n';

function fakeCommands(outputFrames = frames) {
  let outputPath = '';
  let inputPath = '';
  const calls: { executable: string; args: readonly string[] }[] = [];
  const runner: typeof runImageCommand = async (executable, args) => {
    calls.push({ executable, args });
    if (executable === 'test-ffmpeg') {
      inputPath = args[args.indexOf('-i') + 1]!;
      outputPath = args.at(-1)!;
      await writeFile(outputPath, Buffer.from('GIF89a' + 'encoded-animation'));
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args.includes('-show_frames'))
      return { code: 0, stdout: args.at(-1) === outputPath ? outputFrames : frames, stderr: '' };
    return { code: 0, stdout: 'stream|width=2|height=1|pix_fmt=bgra\n', stderr: '' };
  };
  return { runner, calls, paths: () => [inputPath, outputPath] };
}

describe('FfmpegAnimationEngine', () => {
  it('transcodes an explicit two-frame source, verifies the result, and cleans temporary files', async () => {
    const fake = fakeCommands();
    const engine = new FfmpegAnimationEngine({ ffmpegPath: 'test-ffmpeg', ffprobePath: 'test-ffprobe' }, fake.runner);

    const result = await engine.transcodeAnimation(input, { type: 'image/gif' });

    expect(result).toMatchObject({ type: 'image/gif', width: 2, height: 1, frameCount: 2, durationMs: 170 });
    expect(result.buffer.subarray(0, 6).toString()).toBe('GIF89a');
    expect(fake.calls.filter((call) => call.executable === 'test-ffprobe')).toHaveLength(4);
    for (const path of fake.paths()) expect(existsSync(path)).toBe(false);
  });

  it('rejects a static input container before invoking FFmpeg', async () => {
    const fake = fakeCommands();
    const engine = new FfmpegAnimationEngine({ ffmpegPath: 'test-ffmpeg', ffprobePath: 'test-ffprobe' }, fake.runner);

    await expect(
      engine.transcodeAnimation(Buffer.from('not an animation'), { type: 'image/gif' }),
    ).rejects.toMatchObject({
      code: 'INVALID_SOURCE',
      stage: 'source',
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects oversized input before copying or probing', async () => {
    const fake = fakeCommands();
    const engine = new FfmpegAnimationEngine(
      { ffmpegPath: 'test-ffmpeg', ffprobePath: 'test-ffprobe', limits: { maxInputBytes: 8 } },
      fake.runner,
    );

    await expect(engine.transcodeAnimation(input, { type: 'image/gif' })).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT',
      stage: 'source',
    });
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects a huge cover scale canvas before invoking FFmpeg', async () => {
    let encoded = false;
    const runner: typeof runImageCommand = async (executable, args) => {
      if (executable === 'test-ffmpeg') {
        encoded = true;
        throw new Error('The intermediate canvas must be rejected before encoding.');
      }
      if (args.includes('-show_frames')) return { code: 0, stdout: frames, stderr: '' };
      return { code: 0, stdout: 'stream|width=10000|height=1|nb_frames=2\n', stderr: '' };
    };
    const engine = new FfmpegAnimationEngine({ ffmpegPath: 'test-ffmpeg', ffprobePath: 'test-ffprobe' }, runner);

    await expect(
      engine.transcodeAnimation(input, { type: 'image/gif', resize: { width: 1, height: 10_000, fit: 'cover' } }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT', stage: 'encode' });
    expect(encoded).toBe(false);
  });

  it('rejects missing output frames and removes partial files', async () => {
    const fake = fakeCommands('frame|pts_time=0|duration_time=0.04\n');
    const engine = new FfmpegAnimationEngine({ ffmpegPath: 'test-ffmpeg', ffprobePath: 'test-ffprobe' }, fake.runner);

    await expect(engine.transcodeAnimation(input, { type: 'image/gif' })).rejects.toMatchObject({
      code: 'ENCODE_FAILED',
      stage: 'encode',
    });
    for (const path of fake.paths()) expect(existsSync(path)).toBe(false);
  });

  it('reports a missing ffprobe binary without falling back to the first frame', async () => {
    const engine = new FfmpegAnimationEngine({ ffprobePath: 'nexusimage-no-ffprobe-command' });

    await expect(engine.transcodeAnimation(input, { type: 'image/gif' })).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      stage: 'capability',
    });
  });

  it('reports an older FFprobe without animated WebP demuxer options as unsupported', async () => {
    const runner: typeof runImageCommand = async (executable) => {
      if (executable === 'test-ffprobe') {
        return { code: 1, stdout: '', stderr: 'Option ignore_loop not found.' };
      }
      throw new Error('FFmpeg must not run after FFprobe capability failure.');
    };
    const engine = new FfmpegAnimationEngine({ ffmpegPath: 'test-ffmpeg', ffprobePath: 'test-ffprobe' }, runner);

    await expect(engine.transcodeAnimation(Buffer.from('RIFF1234WEBP'), { type: 'image/gif' })).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      stage: 'capability',
    });
  });

  it('accepts opaque animated WebP even when FFprobe decodes frames as argb', async () => {
    const inputWebp = await sharp(Buffer.alloc(2 * 2 * 3, 80), {
      raw: { width: 2, height: 2, channels: 3, pageHeight: 1 },
    })
      .webp({ delay: [40, 130] })
      .toBuffer();
    const avifBytes = Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
    const runner: typeof runImageCommand = async (executable, args) => {
      if (executable === 'test-ffmpeg') {
        if (args.includes('null')) {
          return {
            code: 0,
            stdout:
              'frame:0    pts:0       pts_time:0\nlavfi.signalstats.YMIN=255\n' +
              'frame:1    pts:40      pts_time:0.04\nlavfi.signalstats.YMIN=255\n',
            stderr: '',
          };
        }
        await writeFile(args.at(-1)!, avifBytes);
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args.includes('-show_frames')) return { code: 0, stdout: frames, stderr: '' };
      return { code: 0, stdout: 'stream|width=2|height=1|pix_fmt=argb\n', stderr: '' };
    };
    const engine = new FfmpegAnimationEngine({ ffmpegPath: 'test-ffmpeg', ffprobePath: 'test-ffprobe' }, runner);

    await expect(engine.transcodeAnimation(inputWebp, { type: 'image/avif' })).resolves.toMatchObject({
      type: 'image/avif',
      frameCount: 2,
      durationMs: 170,
    });
  });

  it('uses the AVIF sequence track rather than its primary still track', async () => {
    const avifInput = Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x73]);
    let mappedStream = '';
    const runner: typeof runImageCommand = async (executable, args) => {
      if (executable === 'test-ffmpeg') {
        mappedStream = args[args.indexOf('-map') + 1]!;
        await writeFile(args.at(-1)!, Buffer.from('GIF89a' + 'encoded-animation'));
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args.includes('-show_frames')) {
        const selection = args[args.indexOf('-select_streams') + 1];
        return {
          code: 0,
          stdout: selection === 'v:0' && args.at(-1)?.endsWith('.avif') ? 'frame|pts_time=0|duration_time=1\n' : frames,
          stderr: '',
        };
      }
      if (args.at(-1)?.endsWith('.avif')) {
        return {
          code: 0,
          stdout:
            'stream|index=0|width=2|height=1|pix_fmt=yuv420p|nb_frames=1\n' +
            'stream|index=1|width=2|height=1|pix_fmt=yuv420p|nb_frames=2\n',
          stderr: '',
        };
      }
      return { code: 0, stdout: 'stream|index=0|width=2|height=1|pix_fmt=bgra|nb_frames=2\n', stderr: '' };
    };
    const engine = new FfmpegAnimationEngine({ ffmpegPath: 'test-ffmpeg', ffprobePath: 'test-ffprobe' }, runner);

    await expect(engine.transcodeAnimation(avifInput, { type: 'image/gif' })).resolves.toMatchObject({
      type: 'image/gif',
      frameCount: 2,
    });
    expect(mappedStream).toBe('0:v:1');
  });

  it('rejects an AVIF with multiple animated video tracks as unsupported', async () => {
    const avifInput = Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x73]);
    const runner: typeof runImageCommand = async (_executable, args) => {
      if (args.includes('-show_frames'))
        throw new Error('Ambiguous AVIF tracks must be rejected before frame decoding.');
      return {
        code: 0,
        stdout: 'stream|index=0|width=2|height=1|nb_frames=2\n' + 'stream|index=1|width=2|height=1|nb_frames=2\n',
        stderr: '',
      };
    };
    const engine = new FfmpegAnimationEngine({ ffprobePath: 'test-ffprobe' }, runner);

    await expect(engine.transcodeAnimation(avifInput, { type: 'image/gif' })).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      stage: 'capability',
    });
  });

  it('honors an already aborted signal before probing', async () => {
    const fake = fakeCommands();
    const engine = new FfmpegAnimationEngine({ ffmpegPath: 'test-ffmpeg', ffprobePath: 'test-ffprobe' }, fake.runner);
    const controller = new AbortController();
    controller.abort();

    await expect(
      engine.transcodeAnimation(input, { type: 'image/gif', signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'ABORTED',
      stage: 'source',
    });
    expect(fake.calls).toHaveLength(0);
  });
});
