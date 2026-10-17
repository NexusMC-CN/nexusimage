import { NexusImageError, throwIfAborted } from '@nexusmc-cn/nexusimage/contracts';
import type { NodeImageSource } from '../types.js';

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

export async function toInputBuffer(
  source: NodeImageSource,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; mimeType?: string }> {
  throwIfAborted(signal, 'source');
  // Snapshot borrowed bytes before yielding so metadata and later decoding use the same input.
  if (Buffer.isBuffer(source)) return { buffer: Buffer.from(source) };
  if (source instanceof Uint8Array) return { buffer: Buffer.from(source) };
  if (source instanceof ArrayBuffer) return { buffer: Buffer.from(new Uint8Array(source)) };
  if (isBlob(source)) {
    try {
      const bytes = await source.arrayBuffer();
      throwIfAborted(signal, 'source');
      return { buffer: Buffer.from(bytes), mimeType: source.type || undefined };
    } catch (error) {
      if (error instanceof NexusImageError) throw error;
      throw new NexusImageError('INVALID_SOURCE', 'source', 'Unable to read Blob source.', error);
    }
  }
  throw new NexusImageError(
    'INVALID_SOURCE',
    'source',
    'NodeImageSource must be a Buffer, Uint8Array, ArrayBuffer, Blob, or File.',
  );
}

export function sourceSizeHint(source: NodeImageSource): number | undefined {
  if (Buffer.isBuffer(source)) return source.byteLength;
  if (source instanceof Uint8Array) return source.byteLength;
  if (source instanceof ArrayBuffer) return source.byteLength;
  if (isBlob(source)) return source.size;
  return undefined;
}
