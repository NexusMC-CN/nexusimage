import { NexusImageError, throwIfAborted } from '../errors';
import { awaitWithAbort } from '../abort';
import { createObjectUrl } from '../source';
import type { NormalizedSource } from '../source';
import type { DecodeAdapter, DecodedImage, DrawTarget } from './adapter';

type ImageConstructor = new () => HTMLImageElement;

export function htmlImageAdapter(ctor?: ImageConstructor): DecodeAdapter {
  return {
    name: 'html-image',
    async decode(source: NormalizedSource, signal?: AbortSignal): Promise<DecodedImage> {
      throwIfAborted(signal, 'decode');
      const ImageCtor = ctor ?? (globalThis as typeof globalThis & { Image?: ImageConstructor }).Image;
      if (!ImageCtor) throw new NexusImageError('UNSUPPORTED', 'decode', 'HTMLImageElement is unavailable.');
      const objectUrl = createObjectUrl(source.blob);
      let image: HTMLImageElement | undefined;
      let eventsDetached = false;
      let sourceCleared = false;
      const cleanup = (clearSource: boolean) => {
        objectUrl.dispose();
        if (!image) return;
        if (!eventsDetached) {
          image.onload = null;
          image.onerror = null;
          eventsDetached = true;
        }
        if (clearSource && !sourceCleared) {
          sourceCleared = true;
          image.src = '';
        }
      };
      try {
        const loadedImage = new ImageCtor();
        image = loadedImage;
        loadedImage.decoding = 'async';
        const load = new Promise<void>((resolve, reject) => {
          loadedImage.onload = () => resolve();
          loadedImage.onerror = () => reject(new Error('HTML image failed to load.'));
          loadedImage.src = objectUrl.url;
        });
        await awaitWithAbort(load, signal, undefined, () => cleanup(true), 'decode');
        throwIfAborted(signal, 'decode');
        cleanup(false);
        let disposed = false;
        return {
          name: 'html-image',
          width: loadedImage.naturalWidth,
          height: loadedImage.naturalHeight,
          draw(target: DrawTarget, dx, dy, dw, dh) {
            target.drawImage(loadedImage, dx, dy, dw, dh);
          },
          dispose() {
            if (!disposed) {
              disposed = true;
              cleanup(true);
            }
          },
        };
      } catch (error) {
        cleanup(true);
        if (error instanceof NexusImageError) throw error;
        throw new NexusImageError('DECODE_FAILED', 'decode', 'HTML image failed to load.', error);
      }
    },
  };
}
