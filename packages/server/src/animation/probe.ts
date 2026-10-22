import { NexusImageError } from '@nexusmc-cn/nexusimage/contracts';

type ProbeStage = 'decode' | 'encode';

/** Parse one complete first-cycle video frame listing produced by ffprobe. */
export function parseFrameProbeOutput(
  output: string,
  stage: ProbeStage,
  maxFrames: number,
  maxDurationMs: number,
): { frameCount: number; durationMs: number; finalFrameDurationMs: number } {
  const invalid = (message: string): never => {
    throw new NexusImageError(stage === 'decode' ? 'DECODE_FAILED' : 'ENCODE_FAILED', stage, message);
  };
  const limit = (message: string): never => {
    throw new NexusImageError('RESOURCE_LIMIT', stage, message);
  };
  if (!Number.isSafeInteger(maxFrames) || maxFrames < 1 || !Number.isFinite(maxDurationMs) || maxDurationMs <= 0) {
    return limit('Invalid animation frame or duration limit.');
  }
  const numeric = (value: string | undefined): number | undefined => {
    if (value === undefined || value === 'N/A') return undefined;
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return invalid('Invalid frame timing value.');
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return invalid('Invalid frame timing value.');
    return parsed;
  };
  // ffprobe prints times to microsecond precision; allow one rounding unit when
  // comparing independently rounded timestamps and frame durations.
  const sameTime = (a: number, b: number) => Math.abs(a - b) <= 0.0000011;
  const alias = (fields: Map<string, string>, primary: string, fallback: string): number | undefined => {
    const a = numeric(fields.get(primary));
    const b = numeric(fields.get(fallback));
    if (a !== undefined && b !== undefined && !sameTime(a, b)) return invalid('Conflicting frame timing values.');
    return a ?? b;
  };
  let frameCount = 0;
  let firstPts = 0;
  let lastPts = 0;
  let finalDuration: number | undefined;
  for (const rawLine of output.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const parts = rawLine.split('|');
    if (parts.shift() !== 'frame') return invalid('Unexpected frame probe record.');
    const fields = new Map<string, string>();
    for (const part of parts) {
      const separator = part.indexOf('=');
      if (separator < 1) return invalid('Malformed frame probe field.');
      const name = part.slice(0, separator);
      if (fields.has(name)) return invalid('Duplicate frame probe field.');
      fields.set(name, part.slice(separator + 1));
    }
    const pts = alias(fields, 'best_effort_timestamp_time', 'pts_time');
    const duration = alias(fields, 'duration_time', 'pkt_duration_time');
    if (pts === undefined || (duration !== undefined && duration <= 0))
      return invalid('Missing or invalid frame timing.');
    if (frameCount > 0) {
      if (pts <= lastPts) return invalid('Frame timestamps must strictly increase.');
      if (finalDuration !== undefined && !sameTime(pts - lastPts, finalDuration))
        return invalid('Frame duration conflicts with timestamps.');
    } else {
      firstPts = pts;
    }
    frameCount++;
    if (frameCount > maxFrames) return limit('Animation exceeds the frame limit.');
    lastPts = pts;
    finalDuration = duration;
    if ((lastPts - firstPts) * 1000 > maxDurationMs) return limit('Animation exceeds the duration limit.');
  }
  if (frameCount === 0 || finalDuration === undefined) return invalid('Missing final frame duration.');
  // Remove binary floating point noise, retaining sub-microsecond milliseconds.
  const milliseconds = (seconds: number) => Math.round(seconds * 1e9) / 1e6;
  const durationMs = milliseconds(lastPts - firstPts + finalDuration);
  const finalFrameDurationMs = milliseconds(finalDuration);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || finalFrameDurationMs <= 0)
    return invalid('Invalid animation duration.');
  if (durationMs > maxDurationMs) return limit('Animation exceeds the duration limit.');
  return { frameCount, durationMs, finalFrameDurationMs };
}
