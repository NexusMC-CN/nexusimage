export type NexusImageErrorCode = 'INVALID_SOURCE' | 'RESOURCE_LIMIT' | 'ABORTED' | 'UNSUPPORTED' | 'DECODE_FAILED' | 'EXIF_FAILED' | 'RENDER_FAILED' | 'ENCODE_FAILED';
export type NexusImageErrorStage = 'source' | 'capability' | 'exif' | 'decode' | 'render' | 'encode';

export class NexusImageError extends Error {
  readonly name = 'NexusImageError';
  constructor(readonly code: NexusImageErrorCode, readonly stage: NexusImageErrorStage, message: string, readonly cause?: unknown) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function throwIfAborted(signal?: AbortSignal, stage: NexusImageErrorStage = 'source'): void {
  if (signal?.aborted) throw new NexusImageError('ABORTED', stage, 'The image operation was aborted.', signal.reason);
}
