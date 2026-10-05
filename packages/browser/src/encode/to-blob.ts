import { NexusImageError, throwIfAborted } from '../errors';
import { awaitWithAbort } from '../abort';
import type { EncodeOptions } from '../types';
import type { CanvasSurface } from '../render/surface';

const DEFAULT_TYPE = 'image/png';

export async function encodeSurface(surface: CanvasSurface, options: EncodeOptions = {}): Promise<{ blob: Blob; type: string }> {
  throwIfAborted(options.signal, 'encode');
  const type = options.type ?? DEFAULT_TYPE;
  if (options.quality !== undefined && (!Number.isFinite(options.quality) || options.quality < 0 || options.quality > 1)) {
    throw new NexusImageError('ENCODE_FAILED', 'encode', 'quality must be between 0 and 1.');
  }
  try {
    if (surface.canvas.convertToBlob) {
      const blob = await awaitWithAbort(
        surface.canvas.convertToBlob({ type, ...(options.quality === undefined ? {} : { quality: options.quality }) }),
        options.signal,
        undefined,
        undefined,
        'encode',
      );
      throwIfAborted(options.signal, 'encode');
      if (!blob) throw new Error('Canvas returned an empty Blob.');
      return { blob, type: blob.type || type };
    }
    if (surface.canvas.toBlob) {
      const blob = await awaitWithAbort(new Promise<Blob>((resolve, reject) => {
        surface.canvas.toBlob!((value) => value ? resolve(value) : reject(new Error('Canvas returned an empty Blob.')), type, options.quality);
      }), options.signal, undefined, undefined, 'encode');
      throwIfAborted(options.signal, 'encode');
      return { blob, type: blob.type || type };
    }
    throw new NexusImageError('UNSUPPORTED', 'encode', 'Canvas Blob encoding is unavailable.');
  } catch (error) {
    if (error instanceof NexusImageError) throw error;
    throw new NexusImageError('ENCODE_FAILED', 'encode', 'Canvas encoding failed.', error);
  }
}
