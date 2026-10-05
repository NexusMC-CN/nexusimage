import { NexusImageError, throwIfAborted } from '../errors';
import { awaitWithAbort } from '../abort';
import type { NormalizedSource } from '../source';
import type { DecodeAdapter, DecodedImage, DrawTarget } from './adapter';

type BitmapFactory = (source: Blob) => Promise<{ width: number; height: number; close?: () => void }>;

export function createImageBitmapAdapter(factory?: BitmapFactory): DecodeAdapter {
  return {
    name: 'create-image-bitmap',
    async decode(source: NormalizedSource, signal?: AbortSignal): Promise<DecodedImage> {
      throwIfAborted(signal, 'decode');
      const create =
        factory ?? (globalThis as typeof globalThis & { createImageBitmap?: BitmapFactory }).createImageBitmap;
      if (!create) throw new NexusImageError('UNSUPPORTED', 'decode', 'createImageBitmap is unavailable.');
      let bitmap: Awaited<ReturnType<BitmapFactory>>;
      try {
        bitmap = await awaitWithAbort(
          create(source.blob),
          signal,
          (lateBitmap) => lateBitmap.close?.(),
          undefined,
          'decode',
        );
      } catch (error) {
        if (error instanceof NexusImageError) throw error;
        throw new NexusImageError('DECODE_FAILED', 'decode', 'createImageBitmap failed.', error);
      }
      try {
        throwIfAborted(signal, 'decode');
      } catch (error) {
        bitmap.close?.();
        throw error;
      }
      let disposed = false;
      return {
        name: 'create-image-bitmap',
        width: bitmap.width,
        height: bitmap.height,
        draw(target: DrawTarget, dx, dy, dw, dh) {
          target.drawImage(bitmap, dx, dy, dw, dh);
        },
        dispose() {
          if (!disposed) {
            disposed = true;
            bitmap.close?.();
          }
        },
      };
    },
  };
}
