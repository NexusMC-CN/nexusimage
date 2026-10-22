import { describe, expect, it } from 'vitest';
import { patchLastWebpFrameDuration } from '../../src/animation/webp.js';

function chunk(tag: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(tag, 0, 'ascii');
  header.writeUInt32LE(payload.byteLength, 4);
  return Buffer.concat([header, payload, payload.byteLength % 2 ? Buffer.from([0]) : Buffer.alloc(0)]);
}

function webp(durations: number[]): Buffer {
  const frames = durations.map((duration) => {
    const header = Buffer.alloc(16);
    header.writeUIntLE(duration, 12, 3);
    return chunk('ANMF', header);
  });
  const body = Buffer.concat([Buffer.from('WEBP'), chunk('ANIM', Buffer.alloc(6)), ...frames]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.byteLength, 4);
  return Buffer.concat([riff, body]);
}

describe('WebP final-frame duration', () => {
  it('sets only the last ANMF duration and leaves the supplied buffer unchanged', () => {
    const encoded = webp([40, 40]);
    const patched = patchLastWebpFrameDuration(encoded, 2, 130);

    const lastDurationOffset = 12 + (8 + 6) + (8 + 16) + 8 + 12;
    expect(encoded.readUIntLE(lastDurationOffset, 3)).toBe(40);
    expect(patched.readUIntLE(lastDurationOffset, 3)).toBe(130);
    expect(patched.byteLength).toBe(encoded.byteLength);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0x1000000])(
    'rejects a frame duration that WebP cannot represent: %s',
    (duration) => {
      expect(() => patchLastWebpFrameDuration(webp([40, 40]), 2, duration)).toThrow(
        expect.objectContaining({ code: 'ENCODE_FAILED', stage: 'encode' }),
      );
    },
  );

  it('rejects a frame-count mismatch and malformed RIFF sizes', () => {
    expect(() => patchLastWebpFrameDuration(webp([40]), 2, 130)).toThrow(
      expect.objectContaining({ code: 'ENCODE_FAILED', stage: 'encode' }),
    );
    const malformed = webp([40, 40]);
    malformed.writeUInt32LE(999, 4);
    expect(() => patchLastWebpFrameDuration(malformed, 2, 130)).toThrow(
      expect.objectContaining({ code: 'ENCODE_FAILED', stage: 'encode' }),
    );
  });
});
