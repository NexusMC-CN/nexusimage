import { describe, expect, it } from 'vitest';
import { assertAnimationBudget, resolveAnimationLimits } from '../../src/animation/limits.js';

describe('animation resource limits', () => {
  it('resolves conservative defaults and permits explicit host increases', () => {
    expect(resolveAnimationLimits()).toMatchObject({
      maxFrames: 120,
      maxDurationMs: 30_000,
      maxTotalPixels: 200_000_000,
      maxProcessingMs: 60_000,
    });
    expect(resolveAnimationLimits({ maxFrames: 240 })).toMatchObject({ maxFrames: 240 });
  });

  it('allows requests to lower every host limit but never raise one', () => {
    const host = resolveAnimationLimits();
    for (const key of Object.keys(host) as (keyof typeof host)[]) {
      expect(resolveAnimationLimits(host, { [key]: host[key] / 2 })[key]).toBe(host[key] / 2);
      expect(resolveAnimationLimits(host, { [key]: host[key] * 2 })[key]).toBe(host[key]);
    }
  });

  it('validates host and request values before applying the minimum', () => {
    for (const key of Object.keys(resolveAnimationLimits())) {
      for (const value of [0, -1, NaN, Infinity, -Infinity]) {
        expect(() => resolveAnimationLimits({ [key]: value })).toThrowError(
          expect.objectContaining({ code: 'INVALID_SOURCE', stage: 'source' }),
        );
        expect(() => resolveAnimationLimits(undefined, { [key]: value })).toThrowError(
          expect.objectContaining({ code: 'INVALID_SOURCE', stage: 'source' }),
        );
      }
    }
  });

  it('rejects fractional and unsafe integer ceilings before applying request minima', () => {
    for (const key of Object.keys(resolveAnimationLimits())) {
      if (key === 'maxDurationMs' || key === 'fetchTimeoutMs') continue;
      for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => resolveAnimationLimits({ [key]: value }, { [key]: 1 })).toThrowError(
          expect.objectContaining({ code: 'INVALID_SOURCE', stage: 'source' }),
        );
        expect(() => resolveAnimationLimits({ [key]: 1 }, { [key]: value })).toThrowError(
          expect.objectContaining({ code: 'INVALID_SOURCE', stage: 'source' }),
        );
      }
    }
  });

  it('accepts fractional duration and fetch timeout ceilings', () => {
    expect(
      resolveAnimationLimits(
        { maxDurationMs: 100.5, fetchTimeoutMs: 100.5 },
        {
          maxDurationMs: 50.25,
          fetchTimeoutMs: 50.25,
        },
      ),
    ).toMatchObject({ maxDurationMs: 50.25, fetchTimeoutMs: 50.25 });
  });

  for (const stage of ['decode', 'encode'] as const) {
    it(`accepts exact budget boundaries during ${stage}`, () => {
      const limits = resolveAnimationLimits({ maxFrames: 2, maxDurationMs: 100, maxTotalPixels: 200 });
      expect(() =>
        assertAnimationBudget({ width: 10, height: 10, frameCount: 2, durationMs: 100 }, limits, stage),
      ).not.toThrow();
    });

    it(`rejects frame, duration, total pixels and dimension overflow during ${stage}`, () => {
      const limits = resolveAnimationLimits({
        maxFrames: 2,
        maxDurationMs: 100,
        maxTotalPixels: 200,
        maxInputWidth: 10,
        maxInputHeight: 10,
        maxInputPixels: 100,
        maxOutputWidth: 10,
        maxOutputHeight: 10,
        maxOutputPixels: 100,
      });
      const base = { width: 10, height: 10, frameCount: 2, durationMs: 100 };
      for (const change of [{ frameCount: 3 }, { durationMs: 101 }, { width: 11 }, { height: 11 }]) {
        expect(() => assertAnimationBudget({ ...base, ...change }, limits, stage)).toThrowError(
          expect.objectContaining({ code: 'RESOURCE_LIMIT', stage }),
        );
      }
      expect(() => assertAnimationBudget(base, { ...limits, maxTotalPixels: 199 }, stage)).toThrowError(
        expect.objectContaining({ code: 'RESOURCE_LIMIT', stage }),
      );
      const pixelKey = stage === 'decode' ? 'maxInputPixels' : 'maxOutputPixels';
      expect(() => assertAnimationBudget(base, { ...limits, [pixelKey]: 99 }, stage)).toThrowError(
        expect.objectContaining({ code: 'RESOURCE_LIMIT', stage }),
      );
    });

    it(`rejects malformed decoded measurements during ${stage}`, () => {
      for (const change of [
        { width: NaN },
        { height: 0 },
        { frameCount: 0 },
        { frameCount: 1.5 },
        { durationMs: -1 },
        { durationMs: Infinity },
      ]) {
        expect(() =>
          assertAnimationBudget(
            { width: 10, height: 10, frameCount: 1, durationMs: 0, ...change },
            resolveAnimationLimits(),
            stage,
          ),
        ).toThrowError(expect.objectContaining({ code: 'RESOURCE_LIMIT', stage }));
      }
    });
  }
});
