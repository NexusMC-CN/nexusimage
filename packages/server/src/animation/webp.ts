import { NexusImageError } from '@nexusmc-cn/nexusimage/contracts';

function invalid(message: string): never {
  throw new NexusImageError('ENCODE_FAILED', 'encode', message);
}

/**
 * libwebp_anim encodes the final ANMF delay from the preceding timestamp gap.
 * Replace that one RIFF field with the measured source final-frame duration.
 */
export function patchLastWebpFrameDuration(input: Buffer, expectedFrames: number, durationMs: number): Buffer {
  const duration = Math.round(durationMs);
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 0xffffff)
    return invalid('The final frame duration is not representable in WebP.');
  if (!Number.isSafeInteger(expectedFrames) || expectedFrames < 2)
    return invalid('Expected at least two WebP animation frames.');
  if (
    !Buffer.isBuffer(input) ||
    input.byteLength < 12 ||
    input.toString('ascii', 0, 4) !== 'RIFF' ||
    input.toString('ascii', 8, 12) !== 'WEBP' ||
    input.readUInt32LE(4) !== input.byteLength - 8
  )
    return invalid('FFmpeg produced an invalid WebP RIFF container.');

  let offset = 12;
  let frameCount = 0;
  let lastDurationOffset = -1;
  let hasAnimationChunk = false;
  while (offset < input.byteLength) {
    if (offset + 8 > input.byteLength) return invalid('FFmpeg produced a truncated WebP chunk.');
    const tag = input.toString('ascii', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const payload = offset + 8;
    const end = payload + size;
    const paddedEnd = end + (size & 1);
    if (!Number.isSafeInteger(end) || paddedEnd > input.byteLength)
      return invalid('FFmpeg produced an invalid WebP chunk size.');
    if (size & 1 && input[end] !== 0) return invalid('FFmpeg produced an invalid WebP chunk padding byte.');
    if (tag === 'ANIM') {
      if (size < 6) return invalid('FFmpeg produced an invalid WebP animation header.');
      hasAnimationChunk = true;
    }
    if (tag === 'ANMF') {
      if (size < 16) return invalid('FFmpeg produced an invalid WebP animation frame.');
      frameCount += 1;
      lastDurationOffset = payload + 12;
    }
    offset = paddedEnd;
  }
  if (!hasAnimationChunk || frameCount !== expectedFrames || lastDurationOffset < 0)
    return invalid('FFmpeg produced an unexpected WebP frame count.');
  const patched = Buffer.from(input);
  patched.writeUIntLE(duration, lastDurationOffset, 3);
  return patched;
}
