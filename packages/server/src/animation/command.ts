import { NexusImageError } from '@nexusmc-cn/nexusimage/contracts';
import type { AnimationTranscodeOptions } from '../types.js';

function fail(stage: 'render' | 'encode', message: string): never {
  throw new NexusImageError(stage === 'render' ? 'RENDER_FAILED' : 'ENCODE_FAILED', stage, message);
}

const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Build a numeric-only filter graph and predict its exact output canvas. */
export function createAnimationFilter(
  options: AnimationTranscodeOptions,
  input: { width: number; height: number },
): { filter: string; width: number; height: number; scaleCanvas?: { width: number; height: number } } {
  if (!record(options) || !record(input) || !positiveInteger(input.width) || !positiveInteger(input.height)) {
    return fail('render', 'Invalid animation input dimensions or transforms.');
  }
  let { width, height } = input;
  let scaleCanvas: { width: number; height: number } | undefined;
  const filters: string[] = [];
  if (
    options.background !== undefined &&
    (typeof options.background !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(options.background))
  ) {
    return fail('render', 'Animation background must be a #RRGGBB color.');
  }
  const background = options.background === undefined ? '0x000000' : `0x${options.background.slice(1)}`;
  if (options.crop !== undefined) {
    const crop = options.crop;
    if (
      !record(crop) ||
      !Number.isSafeInteger(crop.x) ||
      !Number.isSafeInteger(crop.y) ||
      crop.x < 0 ||
      crop.y < 0 ||
      !positiveInteger(crop.width) ||
      !positiveInteger(crop.height) ||
      crop.x > width - crop.width ||
      crop.y > height - crop.height
    ) {
      return fail('render', 'Animation crop must be an integer rectangle inside the source image.');
    }
    filters.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1`);
    width = crop.width;
    height = crop.height;
  }
  if (options.rotate !== undefined) {
    if (typeof options.rotate !== 'number' || !Number.isFinite(options.rotate) || options.rotate % 90 !== 0) {
      return fail('render', 'Animation rotation must be a finite multiple of 90 degrees.');
    }
    const rotation = ((options.rotate % 360) + 360) % 360;
    if (rotation === 90 || rotation === 270) {
      filters.push(rotation === 90 ? 'transpose=clock' : 'transpose=cclock');
      [width, height] = [height, width];
    } else if (rotation === 180) filters.push('hflip', 'vflip');
  }
  if (options.flip !== undefined) {
    if (
      !record(options.flip) ||
      (options.flip.horizontal !== undefined && typeof options.flip.horizontal !== 'boolean') ||
      (options.flip.vertical !== undefined && typeof options.flip.vertical !== 'boolean')
    )
      return fail('render', 'Invalid animation flip options.');
    if (options.flip.horizontal) filters.push('hflip');
    if (options.flip.vertical) filters.push('vflip');
  }
  if (options.resize !== undefined) {
    const resize = options.resize;
    if (
      !record(resize) ||
      (resize.width === undefined && resize.height === undefined) ||
      (resize.width !== undefined && !positiveInteger(resize.width)) ||
      (resize.height !== undefined && !positiveInteger(resize.height)) ||
      (resize.fit !== undefined && !['contain', 'cover', 'fill'].includes(resize.fit))
    ) {
      return fail('render', 'Animation resize requires positive integer dimensions and contain, cover, or fill fit.');
    }
    const targetWidth = resize.width ?? Math.max(1, Math.round(width * (resize.height! / height)));
    const targetHeight = resize.height ?? Math.max(1, Math.round(height * (resize.width! / width)));
    if (!positiveInteger(targetWidth) || !positiveInteger(targetHeight))
      return fail('render', 'Animation resize dimensions overflow.');
    const fit = resize.fit ?? 'contain';
    if (resize.width !== undefined && resize.height !== undefined && fit !== 'fill') {
      const ratio =
        fit === 'cover'
          ? Math.max(targetWidth / width, targetHeight / height)
          : Math.min(targetWidth / width, targetHeight / height);
      const scaledWidth = Math.max(1, Math.round(width * ratio));
      const scaledHeight = Math.max(1, Math.round(height * ratio));
      if (!positiveInteger(scaledWidth) || !positiveInteger(scaledHeight))
        return fail('render', 'Animation resize dimensions overflow.');
      scaleCanvas = { width: scaledWidth, height: scaledHeight };
      filters.push(`scale=${scaledWidth}:${scaledHeight}`);
      if (fit === 'cover')
        filters.push(
          `crop=${targetWidth}:${targetHeight}:${Math.floor((scaledWidth - targetWidth) / 2)}:${Math.floor((scaledHeight - targetHeight) / 2)}:exact=1`,
        );
      else
        filters.push(
          `pad=${targetWidth}:${targetHeight}:${Math.floor((targetWidth - scaledWidth) / 2)}:${Math.floor((targetHeight - scaledHeight) / 2)}:color=${background}`,
        );
    } else filters.push(`scale=${targetWidth}:${targetHeight}`);
    width = targetWidth;
    height = targetHeight;
  }
  filters.push('settb=1/1000', 'setpts=PTS-STARTPTS');
  return { filter: filters.join(','), width, height, ...(scaleCanvas && { scaleCanvas }) };
}

/** Return argv only; paths never pass through a shell or a filter expression. */
export function createAnimationCommand(
  inputFile: string,
  outputFile: string,
  sourceFormat: 'gif' | 'webp' | 'avif',
  inputFrameCount: number,
  lastFrameDurationMs: number,
  options: AnimationTranscodeOptions,
  filter: string,
  maxOutputBytes: number,
  sourceVideoOrdinal = 0,
): string[] {
  if (!record(options) || !['image/gif', 'image/webp', 'image/avif'].includes(options.type))
    return fail('encode', 'Unsupported animation output type.');
  if (
    options.quality !== undefined &&
    (typeof options.quality !== 'number' ||
      !Number.isFinite(options.quality) ||
      options.quality < 0 ||
      options.quality > 1)
  )
    return fail('encode', 'Animation quality must be from 0 to 1.');
  if (options.type === 'image/gif' && options.quality !== undefined)
    return fail('encode', 'GIF does not support quality.');
  if (
    !positiveInteger(inputFrameCount) ||
    !Number.isSafeInteger(inputFrameCount + 1) ||
    !Number.isFinite(lastFrameDurationMs) ||
    lastFrameDurationMs <= 0 ||
    !positiveInteger(maxOutputBytes) ||
    !Number.isSafeInteger(sourceVideoOrdinal) ||
    sourceVideoOrdinal < 0 ||
    !['gif', 'webp', 'avif'].includes(sourceFormat)
  )
    return fail('encode', 'Invalid animation command timing or limits.');
  const args = ['-nostdin', '-loglevel', 'error', '-y'];
  if (sourceFormat !== 'avif') args.push('-ignore_loop', '1', '-min_delay', '0', '-default_delay', '0');
  args.push(
    '-i',
    inputFile,
    '-map',
    `0:v:${sourceVideoOrdinal}`,
    '-an',
    '-sn',
    '-dn',
    '-frames:v',
    String(inputFrameCount + 1),
    '-vf',
    filter,
    '-fps_mode',
    'passthrough',
    '-enc_time_base',
    'filter',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-fs',
    String(maxOutputBytes),
  );
  const quality = options.quality ?? 0.8;
  if (options.type === 'image/gif')
    args.push(
      '-c:v',
      'gif',
      '-loop',
      '0',
      '-final_delay',
      String(Math.max(1, Math.round(lastFrameDurationMs / 10))),
      '-f',
      'gif',
    );
  else if (options.type === 'image/webp')
    args.push(
      '-c:v',
      'libwebp',
      '-quality',
      String(Math.round(quality * 100)),
      '-pix_fmt',
      'yuva420p',
      '-loop',
      '0',
      '-f',
      'webp',
    );
  else
    args.push(
      '-c:v',
      'libaom-av1',
      '-b:v',
      '0',
      '-crf',
      String(Math.round((1 - quality) * 63)),
      '-cpu-used',
      '6',
      '-pix_fmt',
      'yuv420p',
      '-movie_timescale',
      '1000',
      '-loop',
      '0',
      '-f',
      'avif',
    );
  args.push(outputFile);
  return args;
}
