import { NexusImageError, throwIfAborted } from '../errors';
import { awaitWithAbort } from '../abort';
import type { NormalizedSource } from '../source';
import type { DecodeAdapter, DecodedImage, DrawTarget } from './adapter';

interface DecoderResult {
  image: {
    displayWidth?: number;
    displayHeight?: number;
    codedWidth?: number;
    codedHeight?: number;
    close?: () => void;
  };
}
interface DecoderInstance {
  decode(options?: { frameIndex?: number }): Promise<DecoderResult>;
  close(): void;
}
type DecoderConstructor = new (options: { data: ArrayBuffer; type: string }) => DecoderInstance;

export function imageDecoderAdapter(ctor?: DecoderConstructor): DecodeAdapter {
  return {
    name: 'image-decoder',
    async decode(source: NormalizedSource, signal?: AbortSignal): Promise<DecodedImage> {
      throwIfAborted(signal, 'decode');
      const Decoder = ctor ?? (globalThis as typeof globalThis & { ImageDecoder?: DecoderConstructor }).ImageDecoder;
      if (!Decoder) throw new NexusImageError('UNSUPPORTED', 'decode', 'ImageDecoder is unavailable.');
      let decoder: DecoderInstance | undefined;
      let image: DecoderResult['image'] | undefined;
      try {
        const bytes = source.bytes;
        throwIfAborted(signal, 'decode');
        decoder = new Decoder({ data: bytes, type: source.mimeType });
        const result = await awaitWithAbort(
          decoder.decode({ frameIndex: 0 }),
          signal,
          (lateResult) => lateResult.image.close?.(),
          () => decoder?.close(),
          'decode',
        );
        image = result.image;
        throwIfAborted(signal, 'decode');
        const width = image.displayWidth ?? image.codedWidth ?? 0;
        const height = image.displayHeight ?? image.codedHeight ?? 0;
        if (!width || !height) throw new Error('ImageDecoder returned an invalid frame.');
        decoder.close();
        decoder = undefined;
        let disposed = false;
        return {
          name: 'image-decoder',
          width,
          height,
          draw(target: DrawTarget, dx, dy, dw, dh) {
            target.drawImage(image, dx, dy, dw, dh);
          },
          dispose() {
            if (disposed) return;
            disposed = true;
            image?.close?.();
            decoder?.close();
          },
        };
      } catch (error) {
        image?.close?.();
        decoder?.close();
        if (error instanceof NexusImageError) throw error;
        throw new NexusImageError('DECODE_FAILED', 'decode', 'ImageDecoder failed.', error);
      }
    },
  };
}
