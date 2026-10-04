import { NexusImageError } from './errors';
import type { NexusImageErrorStage } from './errors';

export function awaitWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  onLateResult?: (value: T) => void,
  onAbort?: () => void,
  stage: NexusImageErrorStage = 'source',
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    onAbort?.();
    void promise.then(onLateResult, () => undefined);
    return Promise.reject(new NexusImageError('ABORTED', stage, 'The image operation was aborted.', signal.reason));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      onAbort?.();
      reject(new NexusImageError('ABORTED', stage, 'The image operation was aborted.', signal.reason));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (settled) onLateResult?.(value);
        else { settled = true; resolve(value); }
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        if (!settled) { settled = true; reject(error); }
      },
    );
  });
}
