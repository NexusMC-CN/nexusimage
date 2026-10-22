import {
  assertDecodedDimensions,
  assertOutputDimensions,
  NexusImageError,
  resolveResourceLimits,
  type ResourceLimits,
} from '@nexusmc-cn/nexusimage/contracts';

/** Node animation budgets in addition to the shared image budgets. */
export interface AnimationResourceLimits extends ResourceLimits {
  maxFrames?: number;
  maxDurationMs?: number;
  maxTotalPixels?: number;
  maxProcessingMs?: number;
}

export type ResolvedAnimationLimits = Required<AnimationResourceLimits>;

export const DEFAULT_ANIMATION_LIMITS: Readonly<ResolvedAnimationLimits> = Object.freeze({
  ...resolveResourceLimits(),
  maxFrames: 120,
  maxDurationMs: 30_000,
  maxTotalPixels: 200_000_000,
  maxProcessingMs: 60_000,
});

function validateLimits(limits: AnimationResourceLimits | undefined): void {
  if (!limits) return;
  for (const key of Object.keys(DEFAULT_ANIMATION_LIMITS) as (keyof AnimationResourceLimits)[]) {
    const value = limits[key];
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      throw new NexusImageError('INVALID_SOURCE', 'source', `${key} must be a positive finite number.`);
    }
    if (value !== undefined && key !== 'maxDurationMs' && key !== 'fetchTimeoutMs' && !Number.isSafeInteger(value)) {
      throw new NexusImageError('INVALID_SOURCE', 'source', `${key} must be a positive safe integer.`);
    }
  }
}

/** Hosts configure ceilings; individual requests can only lower those ceilings. */
export function resolveAnimationLimits(
  host?: AnimationResourceLimits,
  request?: AnimationResourceLimits,
): ResolvedAnimationLimits {
  validateLimits(host);
  validateLimits(request);
  const resolved = { ...DEFAULT_ANIMATION_LIMITS };
  for (const key of Object.keys(resolved) as (keyof ResolvedAnimationLimits)[]) {
    resolved[key] = Math.min(host?.[key] ?? resolved[key], request?.[key] ?? Infinity);
  }
  return resolved;
}

export function assertAnimationBudget(
  budget: { width: number; height: number; frameCount: number; durationMs: number },
  limits: ResolvedAnimationLimits,
  stage: 'decode' | 'encode',
): void {
  const { width, height, frameCount, durationMs } = budget;
  if (
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    !Number.isSafeInteger(height) ||
    height <= 0 ||
    !Number.isSafeInteger(frameCount) ||
    frameCount <= 0 ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    throw new NexusImageError('RESOURCE_LIMIT', stage, 'Animation measurements must be finite and valid.');
  }
  try {
    if (stage === 'decode') assertDecodedDimensions(width, height, limits);
    else assertOutputDimensions(width, height, limits);
  } catch (error) {
    if (error instanceof NexusImageError && error.code === 'RESOURCE_LIMIT' && error.stage !== stage) {
      throw new NexusImageError('RESOURCE_LIMIT', stage, error.message, error);
    }
    throw error;
  }
  for (const [value, maximum, label] of [
    [frameCount, limits.maxFrames, 'Animation frame count'],
    [durationMs, limits.maxDurationMs, 'Animation duration'],
    [width * height * frameCount, limits.maxTotalPixels, 'Animation total pixels'],
  ] as const) {
    if (!Number.isFinite(value) || value > maximum) {
      throw new NexusImageError(
        'RESOURCE_LIMIT',
        stage,
        `${label} exceeds the configured resource limit (${maximum}).`,
      );
    }
  }
}
