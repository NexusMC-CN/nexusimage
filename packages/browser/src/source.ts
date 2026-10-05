import { NexusImageError, throwIfAborted } from './errors';
import { awaitWithAbort } from './abort';
import { detectImageFormat, type ImageFormatInfo } from './format';
import { assertInputBytes, resolveResourceLimits, type ResolvedResourceLimits } from './limits';
import type { ImageSource, ResourceLimits } from './types';

export interface NormalizedSource {
  readonly blob: Blob;
  /** Bytes read while normalizing the source, reused by metadata and decoders. */
  readonly bytes: ArrayBuffer;
  readonly mimeType: string;
  readonly size: number;
  readonly name?: string;
  readonly format?: ImageFormatInfo;
  dispose(): void;
}

function isFileLike(source: ImageSource): source is File {
  return typeof File !== 'undefined' && source instanceof File;
}
function isBlobLike(source: ImageSource): source is Blob {
  return typeof Blob !== 'undefined' && source instanceof Blob;
}

export async function readBlobBytes(blob: Blob, signal?: AbortSignal): Promise<ArrayBuffer> {
  throwIfAborted(signal);
  if (typeof blob.arrayBuffer === 'function') {
    const bytes = await awaitWithAbort(blob.arrayBuffer(), signal, undefined, undefined, 'source');
    throwIfAborted(signal);
    return bytes;
  }
  if (typeof FileReader === 'undefined')
    throw new NexusImageError('UNSUPPORTED', 'source', 'Blob reading is unavailable.');
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => reader.abort();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed.'));
    reader.onabort = () => reject(new NexusImageError('ABORTED', 'source', 'The image read was aborted.'));
    signal?.addEventListener('abort', abort, { once: true });
    reader.onloadend = () => signal?.removeEventListener('abort', abort);
    if (signal?.aborted) {
      signal.removeEventListener('abort', abort);
      reject(new NexusImageError('ABORTED', 'source', 'The image read was aborted.', signal.reason));
      return;
    }
    try {
      reader.readAsArrayBuffer(blob);
    } catch (error) {
      signal?.removeEventListener('abort', abort);
      reject(error);
    }
  });
  throwIfAborted(signal);
  return bytes;
}

interface TimeoutContext {
  readonly signal?: AbortSignal;
  readonly timedOut: () => boolean;
  dispose(): void;
}

function createTimeoutContext(signal: AbortSignal | undefined, timeoutMs: number): TimeoutContext {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return signal === undefined
      ? { timedOut: () => false, dispose() {} }
      : { signal, timedOut: () => false, dispose() {} };
  }
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) abortFromCaller();
    else signal.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('Image fetch timed out.'));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

function throwFetchError(error: unknown, context: TimeoutContext, signal?: AbortSignal): never {
  if (context.timedOut())
    throw new NexusImageError('RESOURCE_LIMIT', 'source', 'Image fetch exceeded the configured timeout.', error);
  if (signal?.aborted) throw new NexusImageError('ABORTED', 'source', 'The image fetch was aborted.', error);
  throw new NexusImageError('INVALID_SOURCE', 'source', 'Unable to fetch image source.', error);
}

export async function normalizeSource(
  source: ImageSource,
  signal?: AbortSignal,
  requestedLimits?: ResourceLimits,
): Promise<NormalizedSource> {
  throwIfAborted(signal);
  const limits: ResolvedResourceLimits = resolveResourceLimits(requestedLimits);
  let blob: Blob;
  let name: string | undefined;
  if (isFileLike(source)) {
    blob = source;
    name = source.name;
  } else if (isBlobLike(source)) blob = source;
  else if (source instanceof ArrayBuffer) blob = new Blob([source]);
  else if (source instanceof Uint8Array) blob = new Blob([source as unknown as BlobPart]);
  else if (typeof source === 'string' || source instanceof URL) {
    const timeout = createTimeoutContext(signal, limits.fetchTimeoutMs);
    let response: Response;
    try {
      response = await fetch(String(source), timeout.signal ? { signal: timeout.signal } : {});
      if (!response.ok)
        throw new NexusImageError('INVALID_SOURCE', 'source', `Unable to fetch image source (${response.status}).`);
      blob = await awaitWithAbort(response.blob(), timeout.signal, undefined, undefined, 'source');
    } catch (error) {
      if (error instanceof NexusImageError && !timeout.timedOut()) throw error;
      throwFetchError(error, timeout, signal);
    } finally {
      timeout.dispose();
    }
  } else throw new NexusImageError('INVALID_SOURCE', 'source', 'Unsupported image source.');

  if (blob.size === 0) throw new NexusImageError('INVALID_SOURCE', 'source', 'Image source is empty.');
  assertInputBytes(blob.size, limits);
  const bytes = await readBlobBytes(blob, signal);
  const detected = detectImageFormat(new Uint8Array(bytes), blob.type);
  const mimeType = detected.format === 'unknown' ? blob.type || detected.mimeType : detected.mimeType;
  return {
    blob,
    bytes,
    mimeType,
    size: blob.size,
    format: detected,
    ...(name ? { name } : {}),
    dispose() {},
  };
}

export function createObjectUrl(source: Blob): { url: string; dispose(): void } {
  if (typeof URL.createObjectURL !== 'function')
    throw new NexusImageError('UNSUPPORTED', 'source', 'URL.createObjectURL is unavailable.');
  const url = URL.createObjectURL(source);
  let disposed = false;
  return {
    url,
    dispose() {
      if (!disposed) {
        disposed = true;
        URL.revokeObjectURL(url);
      }
    },
  };
}
