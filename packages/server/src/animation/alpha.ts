import { NexusImageError } from '@nexusmc-cn/nexusimage/contracts';

type AnimationFormat = 'gif' | 'webp' | 'avif';

function invalid(message: string): never {
  throw new NexusImageError('DECODE_FAILED', 'decode', message);
}

/** Ask FFmpeg for the minimum decoded alpha value of every frame, without outputting pixels. */
export function createAlphaProbeCommand(
  inputFile: string,
  sourceFormat: AnimationFormat,
  videoOrdinal: number,
  frameCount: number,
): string[] {
  if (
    !['gif', 'webp', 'avif'].includes(sourceFormat) ||
    !Number.isSafeInteger(videoOrdinal) ||
    videoOrdinal < 0 ||
    !Number.isSafeInteger(frameCount) ||
    frameCount < 2 ||
    !Number.isSafeInteger(frameCount + 1)
  )
    return invalid('Invalid animation transparency probe input.');
  const args = ['-nostdin', '-loglevel', 'error'];
  if (sourceFormat !== 'avif') args.push('-ignore_loop', '1', '-min_delay', '0', '-default_delay', '0');
  args.push(
    '-i',
    inputFile,
    '-map',
    `0:v:${videoOrdinal}`,
    '-an',
    '-sn',
    '-dn',
    '-frames:v',
    String(frameCount + 1),
    '-fps_mode',
    'passthrough',
    '-vf',
    'format=rgba,alphaextract,signalstats,metadata=mode=print:key=lavfi.signalstats.YMIN:file=-',
    '-f',
    'null',
    '-',
  );
  return args;
}

/** `metadata=print` emits a frame header followed by one YMIN record per frame. */
export function parseAlphaProbeOutput(output: string, expectedFrames: number): boolean {
  if (!Number.isSafeInteger(expectedFrames) || expectedFrames < 2)
    return invalid('Invalid expected animation frame count.');
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length !== expectedFrames * 2) return invalid('Missing animation transparency measurements.');
  let hasTransparency = false;
  for (let index = 0; index < expectedFrames; index++) {
    const frame = /^frame:(\d+)\s+pts:/.exec(lines[index * 2]!);
    const minimum = /^lavfi\.signalstats\.YMIN=(\d+)$/.exec(lines[index * 2 + 1]!);
    if (!frame || Number(frame[1]) !== index || !minimum || Number(minimum[1]) > 255)
      return invalid('Invalid animation transparency measurement.');
    if (Number(minimum[1]) < 255) hasTransparency = true;
  }
  return hasTransparency;
}
