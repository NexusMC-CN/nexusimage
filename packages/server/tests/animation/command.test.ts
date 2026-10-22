import { describe, expect, it } from 'vitest';
import type { AnimationTranscodeOptions } from '../../src/types.js';
import { createAnimationCommand, createAnimationFilter } from '../../src/animation/command.js';

const base: AnimationTranscodeOptions = { type: 'image/webp' };
const input = { width: 120, height: 80 };
const tail = 'settb=1/1000,setpts=PTS-STARTPTS';
const filter = (options: Partial<AnimationTranscodeOptions> = {}) =>
  createAnimationFilter({ ...base, ...options }, input);
const command = (options: Partial<AnimationTranscodeOptions> = {}, source: 'gif' | 'webp' | 'avif' = 'gif') =>
  createAnimationCommand('input path ; &.gif', 'output path.webp', source, 3, 125, { ...base, ...options }, tail, 5000);
const value = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe('animation transform filter', () => {
  it('preserves dimensions and rebases millisecond timestamps', () => {
    expect(filter()).toEqual({ width: 120, height: 80, filter: tail });
  });
  it('crops source space before clockwise rotation and flips', () => {
    expect(
      filter({ crop: { x: 10, y: 20, width: 60, height: 40 }, rotate: 90, flip: { horizontal: true, vertical: true } }),
    ).toEqual({
      width: 40,
      height: 60,
      filter: `crop=60:40:10:20:exact=1,transpose=clock,hflip,vflip,${tail}`,
    });
  });
  it.each([
    [{ width: 60 }, 60, 40, 'scale=60:40', undefined],
    [{ height: 40 }, 60, 40, 'scale=60:40', undefined],
    [{ width: 60, height: 60 }, 60, 60, 'scale=60:40,pad=60:60:0:10:color=0x000000', { width: 60, height: 40 }],
    [{ width: 60, height: 60, fit: 'cover' }, 60, 60, 'scale=90:60,crop=60:60:15:0:exact=1', { width: 90, height: 60 }],
    [{ width: 60, height: 60, fit: 'fill' }, 60, 60, 'scale=60:60', undefined],
  ] as const)('projects resize %j to the encoded canvas', (resize, width, height, graph, scaleCanvas) => {
    expect(filter({ resize })).toEqual({
      width,
      height,
      filter: `${graph},${tail}`,
      ...(scaleCanvas && { scaleCanvas }),
    });
  });
  it('exposes a cover scale canvas that can dwarf the final canvas', () => {
    expect(
      createAnimationFilter(
        { type: 'image/gif', resize: { width: 1, height: 10_000, fit: 'cover' } },
        {
          width: 10_000,
          height: 1,
        },
      ).scaleCanvas,
    ).toEqual({ width: 100_000_000, height: 10_000 });
  });
  it('converts strict hexadecimal padding colors to FFmpeg color syntax', () => {
    expect(filter({ resize: { width: 60, height: 60 }, background: '#aBcD12' }).filter).toContain('color=0xaBcD12');
  });
  it.each([
    { rotate: 45 },
    { rotate: '90,split' },
    { rotate: NaN },
    { crop: { x: -1, y: 0, width: 10, height: 10 } },
    { crop: { x: 119, y: 0, width: 2, height: 10 } },
    { crop: { x: 0, y: 0, width: 1.2, height: 10 } },
    { crop: null },
    { flip: { horizontal: 'true' } },
    { flip: null },
    { resize: {} },
    { resize: { width: 0 } },
    { resize: { height: Infinity } },
    { resize: { width: '20;movie=x' } },
    { resize: { width: 20, fit: 'outside' } },
    { background: 'red' },
    { background: '#fff' },
    { background: '#ffffff,split' },
  ])('rejects malformed transforms before constructing a graph: %j', (options) => {
    expect(() => filter(options as unknown as AnimationTranscodeOptions)).toThrow(
      expect.objectContaining({ stage: 'render' }),
    );
  });
});

describe('animation command argv', () => {
  it('keeps paths as separate argv and reads only the first input loop', () => {
    const args = command();
    expect(args.slice(0, 4)).toEqual(['-nostdin', '-loglevel', 'error', '-y']);
    expect(args.slice(4, 12)).toEqual([
      '-ignore_loop',
      '1',
      '-min_delay',
      '0',
      '-default_delay',
      '0',
      '-i',
      'input path ; &.gif',
    ]);
    expect(args.at(-1)).toBe('output path.webp');
    for (const [key, expected] of Object.entries({
      '-map': '0:v:0',
      '-frames:v': '4',
      '-vf': tail,
      '-fps_mode': 'passthrough',
      '-enc_time_base': 'filter',
      '-map_metadata': '-1',
      '-map_chapters': '-1',
      '-fs': '5000',
    }))
      expect(value(args, key)).toBe(expected);
    for (const flag of ['-an', '-sn', '-dn']) expect(args).toContain(flag);
  });
  it('omits GIF and WebP demuxer options for AVIF sources', () => {
    const args = command({}, 'avif');
    expect(args).not.toContain('-ignore_loop');
    expect(args).not.toContain('-min_delay');
    expect(args).not.toContain('-default_delay');
  });
  it('maps the selected AVIF sequence track when a primary still track is also present', () => {
    const args = createAnimationCommand(
      'input.avif',
      'output.gif',
      'avif',
      2,
      130,
      { type: 'image/gif' },
      tail,
      5000,
      1,
    );
    expect(value(args, '-map')).toBe('0:v:1');
  });
  it('selects GIF loop and final-frame delay', () => {
    const args = command({ type: 'image/gif' });
    expect(value(args, '-c:v')).toBe('gif');
    expect(value(args, '-final_delay')).toBe('13');
    expect(value(args, '-f')).toBe('gif');
    expect(value(args, '-loop')).toBe('0');
  });
  it('keeps sub-centisecond GIF final-frame delays positive', () => {
    const args = createAnimationCommand('in.gif', 'out.gif', 'gif', 2, 1, { type: 'image/gif' }, tail, 5000);
    expect(value(args, '-final_delay')).toBe('1');
  });
  it('maps normalized WebP and AVIF quality to their encoder scales', () => {
    const webp = command({ quality: 0.8 }, 'webp');
    expect(value(webp, '-c:v')).toBe('libwebp');
    expect(value(webp, '-quality')).toBe('80');
    expect(value(webp, '-pix_fmt')).toBe('yuva420p');
    const avif = command({ type: 'image/avif', quality: 1 });
    expect(value(avif, '-c:v')).toBe('libaom-av1');
    expect(value(avif, '-crf')).toBe('0');
    expect(value(avif, '-movie_timescale')).toBe('1000');
    expect(value(avif, '-pix_fmt')).toBe('yuv420p');
    expect(value(avif, '-f')).toBe('avif');
    expect(value(command({ type: 'image/avif', quality: 0 }), '-crf')).toBe('63');
  });
  it.each([
    { quality: -1 },
    { quality: 1.1 },
    { quality: NaN },
    { quality: '90 -i evil' },
    { type: 'image/gif', quality: 0.5 },
    { type: 'image/png' },
  ])('rejects malformed encoder settings: %j', (options) => {
    expect(() => command(options as unknown as AnimationTranscodeOptions)).toThrow(
      expect.objectContaining({ stage: 'encode' }),
    );
  });
});
