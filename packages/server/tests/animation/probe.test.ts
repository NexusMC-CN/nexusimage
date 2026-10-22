import { describe, expect, it } from 'vitest';
import { parseFrameProbeOutput } from '../../src/animation/probe.js';

const frames = [
  'frame|best_effort_timestamp_time=2.000000|pkt_duration_time=0.100000',
  'frame|best_effort_timestamp_time=2.100000|pkt_duration_time=0.250000',
  'frame|best_effort_timestamp_time=2.350000|pkt_duration_time=0.050000',
].join('\n');

function parse(output: string, stage: 'decode' | 'encode' = 'decode', maxFrames = 10, maxDurationMs = 1000) {
  return parseFrameProbeOutput(output, stage, maxFrames, maxDurationMs);
}

describe('parseFrameProbeOutput', () => {
  it('uses the full first cycle including the last frame duration and removes timestamp offset', () => {
    expect(parse(frames)).toEqual({ frameCount: 3, durationMs: 400, finalFrameDurationMs: 50 });
  });

  it('accepts pts and duration aliases and CRLF output', () => {
    expect(
      parse(
        'frame|pts_time=0.000000|duration_time=0.100000\r\nframe|best_effort_timestamp_time=N/A|pts_time=0.100000|duration_time=0.200000\r\n',
      ),
    ).toEqual({ frameCount: 2, durationMs: 300, finalFrameDurationMs: 200 });
  });

  it('can obtain intermediate durations from timestamps', () => {
    expect(parse('frame|pts_time=0\nframe|pts_time=0.1|duration_time=0.2').durationMs).toBe(300);
  });

  it.each([
    '',
    'garbage',
    'frame|duration_time=0.1',
    'frame|pts_time=NaN|duration_time=0.1',
    'frame|pts_time=Infinity|duration_time=0.1',
    'frame|pts_time=-1|duration_time=0.1',
    'frame|pts_time=0|duration_time=0',
    'frame|pts_time=0|duration_time=-0.1',
    'frame|pts_time=0|duration_time=0.1junk',
    'frame|pts_time=0',
    'frame|pts_time=0|duration_time=0.1|pkt_duration_time=0.2',
    'frame|best_effort_timestamp_time=0|pts_time=1|duration_time=0.1',
    'frame|pts_time=0|pts_time=0|duration_time=0.1',
    'frame|pts_time=0|duration_time=0.1\nframe|pts_time=0|duration_time=0.1',
    'frame|pts_time=0.2|duration_time=0.1\nframe|pts_time=0.1|duration_time=0.1',
    'frame|pts_time=0|duration_time=0.2\nframe|pts_time=0.1|duration_time=0.1',
  ])('rejects malformed or inconsistent probe data: %s', (output) => {
    expect(() => parse(output)).toThrow(expect.objectContaining({ code: 'DECODE_FAILED', stage: 'decode' }));
    expect(() => parse(output, 'encode')).toThrow(expect.objectContaining({ code: 'ENCODE_FAILED', stage: 'encode' }));
  });

  it('enforces inclusive frame and duration limits without truncation', () => {
    expect(parse(frames, 'decode', 3, 400).frameCount).toBe(3);
    expect(() => parse(frames, 'decode', 2)).toThrow(
      expect.objectContaining({ code: 'RESOURCE_LIMIT', stage: 'decode' }),
    );
    expect(() => parse(frames, 'encode', 3, 399)).toThrow(
      expect.objectContaining({ code: 'RESOURCE_LIMIT', stage: 'encode' }),
    );
  });
});
