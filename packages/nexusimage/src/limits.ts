import { NexusImageError, type NexusImageErrorStage } from './errors';
import type { ResourceLimits } from './types';

/** Conservative browser defaults that prevent accidental unbounded allocations. */
export const DEFAULT_RESOURCE_LIMITS: Required<ResourceLimits> = Object.freeze({
  maxInputBytes: 64 * 1024 * 1024,
  maxInputPixels: 100_000_000,
  maxInputWidth: 16_384,
  maxInputHeight: 16_384,
  maxOutputBytes: 64 * 1024 * 1024,
  maxOutputPixels: 100_000_000,
  maxOutputWidth: 16_384,
  maxOutputHeight: 16_384,
  fetchTimeoutMs: 30_000,
});

export type ResolvedResourceLimits = Required<ResourceLimits>;

function validateLimit(name: keyof ResourceLimits, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new NexusImageError('INVALID_SOURCE', 'source', `${name} must be a positive finite number.`);
  }
}

export function resolveResourceLimits(limits?: ResourceLimits): ResolvedResourceLimits {
  const resolved = { ...DEFAULT_RESOURCE_LIMITS, ...limits };
  for (const [name, value] of Object.entries(resolved) as [keyof ResourceLimits, number][]) validateLimit(name, value);
  return resolved;
}

export function assertWithinLimit(
  value: number,
  limit: number,
  label: string,
  stage: NexusImageErrorStage,
): void {
  if (value > limit) {
    throw new NexusImageError('RESOURCE_LIMIT', stage, `${label} exceeds the configured resource limit (${limit}).`);
  }
}

export function assertInputBytes(size: number, limits: ResolvedResourceLimits): void {
  assertWithinLimit(size, limits.maxInputBytes, 'Input bytes', 'source');
}

export function assertDecodedDimensions(width: number, height: number, limits: ResolvedResourceLimits): void {
  assertWithinLimit(width, limits.maxInputWidth, 'Input width', 'decode');
  assertWithinLimit(height, limits.maxInputHeight, 'Input height', 'decode');
  assertWithinLimit(width * height, limits.maxInputPixels, 'Input pixels', 'decode');
}

export function assertOutputDimensions(width: number, height: number, limits: ResolvedResourceLimits): void {
  assertWithinLimit(width, limits.maxOutputWidth, 'Output width', 'render');
  assertWithinLimit(height, limits.maxOutputHeight, 'Output height', 'render');
  assertWithinLimit(width * height, limits.maxOutputPixels, 'Output pixels', 'render');
}

export function assertEncodedBytes(size: number, limits: ResolvedResourceLimits): void {
  assertWithinLimit(size, limits.maxOutputBytes, 'Encoded bytes', 'encode');
}

