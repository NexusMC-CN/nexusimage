import { formatFromMimeType, type ImageFormat, supportedImageFormats } from './format';
import type { DecodeMode, ImageCapabilities } from './types';

type BrowserGlobal = typeof globalThis & {
  ImageDecoder?: unknown;
  createImageBitmap?: unknown;
  Image?: unknown;
  OffscreenCanvas?: { new (width: number, height: number): unknown; prototype?: { convertToBlob?: unknown } };
  HTMLCanvasElement?: { prototype?: { toBlob?: unknown } };
};

export function getCapabilities(): ImageCapabilities {
  const globals = globalThis as BrowserGlobal;
  const htmlImage = typeof globals.Image === 'function';
  const canvasToBlob = typeof globals.HTMLCanvasElement?.prototype?.toBlob === 'function';
  const imageDecoder = typeof globals.ImageDecoder === 'function';
  const createImageBitmap = typeof globals.createImageBitmap === 'function';
  const offscreenCanvas = typeof globals.OffscreenCanvas === 'function';
  const decodeFormats: readonly ImageFormat[] = imageDecoder || createImageBitmap || htmlImage
    ? supportedImageFormats
    : [];
  const encodeFormats: readonly ImageFormat[] = canvasToBlob || typeof globals.OffscreenCanvas?.prototype?.convertToBlob === 'function'
    ? ['png', 'jpeg', 'webp']
    : [];
  return {
    imageDecoder,
    createImageBitmap,
    htmlImage,
    offscreenCanvas,
    canvasToBlob: canvasToBlob || typeof globals.OffscreenCanvas?.prototype?.convertToBlob === 'function',
    decodeFormats,
    encodeFormats,
    canDecode: (type: string) => decodeFormats.includes(formatFromMimeType(type)),
    canEncode: (type: string) => encodeFormats.includes(formatFromMimeType(type)),
  };
}

/** Returns whether the current browser exposes a decoder path for a MIME type. */
export function canDecode(type: string, capabilities = getCapabilities()): boolean {
  return capabilities.canDecode?.(type) ?? capabilities.decodeFormats?.includes(formatFromMimeType(type)) ?? false;
}

/** Returns whether the current browser exposes a canvas encoder for a MIME type. */
export function canEncode(type: string, capabilities = getCapabilities()): boolean {
  return capabilities.canEncode?.(type) ?? capabilities.encodeFormats?.includes(formatFromMimeType(type)) ?? false;
}

export function availableModes(capabilities: ImageCapabilities, mode: DecodeMode): DecodeMode[] {
  if (mode !== 'auto') {
    const supported = mode === 'image-decoder'
      ? capabilities.imageDecoder
      : mode === 'create-image-bitmap'
        ? capabilities.createImageBitmap
        : capabilities.htmlImage;
    return supported ? [mode] : [];
  }
  const modes: DecodeMode[] = [];
  if (capabilities.imageDecoder) modes.push('image-decoder');
  if (capabilities.createImageBitmap) modes.push('create-image-bitmap');
  if (capabilities.htmlImage) modes.push('html-image');
  return modes;
}
