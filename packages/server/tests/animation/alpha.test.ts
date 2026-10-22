import { describe, expect, it } from 'vitest';
import { createAlphaProbeCommand, parseAlphaProbeOutput } from '../../src/animation/alpha.js';

const opaque =
  'frame:0    pts:0       pts_time:0\n' +
  'lavfi.signalstats.YMIN=255\n' +
  'frame:1    pts:40      pts_time:0.04\n' +
  'lavfi.signalstats.YMIN=255\n';

describe('animation alpha probe', () => {
  it('maps the selected first playback cycle and prints each frame alpha minimum', () => {
    const args = createAlphaProbeCommand('input.avif', 'avif', 1, 2);
    expect(args).toContain('0:v:1');
    expect(args[args.indexOf('-frames:v') + 1]).toBe('3');
    expect(args[args.indexOf('-fps_mode') + 1]).toBe('passthrough');
    expect(args[args.indexOf('-vf') + 1]).toBe(
      'format=rgba,alphaextract,signalstats,metadata=mode=print:key=lavfi.signalstats.YMIN:file=-',
    );
    expect(args).not.toContain('-ignore_loop');
    expect(createAlphaProbeCommand('input.gif', 'gif', 0, 2)).toContain('-ignore_loop');
  });

  it('does not mistake a GIF alpha channel containing only opaque pixels for transparency', () => {
    expect(parseAlphaProbeOutput(opaque, 2)).toBe(false);
  });

  it('detects transparency in a later frame', () => {
    expect(parseAlphaProbeOutput(opaque.replace(/YMIN=255\n$/, 'YMIN=0\n'), 2)).toBe(true);
  });

  it.each([
    opaque.replace('frame:1', 'frame:2'),
    opaque.replace(/lavfi\.signalstats\.YMIN=255\n$/, ''),
    opaque.replace(/YMIN=255\n$/, 'YMIN=256\n'),
    opaque + 'frame:2    pts:100\nlavfi.signalstats.YMIN=255\n',
  ])('rejects incomplete or inconsistent alpha measurements', (output) => {
    expect(() => parseAlphaProbeOutput(output, 2)).toThrowError(
      expect.objectContaining({ code: 'DECODE_FAILED', stage: 'decode' }),
    );
  });
});
