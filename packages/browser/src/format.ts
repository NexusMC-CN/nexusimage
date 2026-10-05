/** Image container formats that NexusImage can identify from a byte signature. */
export type ImageFormat =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'avif'
  | 'bmp'
  | 'ico'
  | 'tiff'
  | 'unknown';

export interface ImageFormatInfo {
  readonly format: ImageFormat;
  readonly mimeType: string;
  readonly extension: string;
  readonly animated: boolean;
}

const FORMAT_MIME: Record<Exclude<ImageFormat, 'unknown'>, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tiff: 'image/tiff',
};

const FORMAT_EXTENSION: Record<Exclude<ImageFormat, 'unknown'>, string> = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp',
  gif: '.gif',
  avif: '.avif',
  bmp: '.bmp',
  ico: '.ico',
  tiff: '.tiff',
};

const KNOWN_MIME = new Map<string, Exclude<ImageFormat, 'unknown'>>([
  ['image/jpeg', 'jpeg'],
  ['image/jpg', 'jpeg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
  ['image/bmp', 'bmp'],
  ['image/x-icon', 'ico'],
  ['image/vnd.microsoft.icon', 'ico'],
  ['image/tiff', 'tiff'],
]);

function toBytes(source: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (source instanceof Uint8Array) return source;
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  return new Uint8Array(source);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > bytes.length) return '';
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function hasBytes(bytes: Uint8Array, offset: number, values: readonly number[]): boolean {
  return offset >= 0 && offset + values.length <= bytes.length && values.every((value, index) => bytes[offset + index] === value);
}

function isAnimatedGif(bytes: Uint8Array): boolean {
  // A GIF has one image descriptor per rendered frame. This deliberately avoids
  // parsing extensions and is enough to distinguish the common single-frame case.
  let frames = 0;
  for (let index = 13; index < bytes.length; index += 1) {
    if (bytes[index] === 0x2c) frames += 1;
    if (frames > 1) return true;
  }
  return false;
}

function isAnimatedWebp(bytes: Uint8Array): boolean {
  // VP8X animation flag is bit 1 of the feature flags byte. ANIM is also
  // accepted because some encoders do not expose a complete VP8X header.
  if (hasBytes(bytes, 12, [0x56, 0x50, 0x38, 0x58]) && bytes.length > 20) return (bytes[20]! & 0x02) !== 0;
  return ascii(bytes, 12, 4) === 'ANIM' || ascii(bytes, 16, 4) === 'ANIM';
}

function isAnimatedAvif(bytes: Uint8Array): boolean {
  // ISO-BMFF brands use `avis` for animated AVIF and `avif` for still images.
  for (let offset = 8; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
    if (ascii(bytes, offset, 4) === 'avis') return true;
  }
  return false;
}

function fromFormat(format: ImageFormat, animated = false, fallbackMimeType?: string): ImageFormatInfo {
  if (format === 'unknown') {
    const mimeType = fallbackMimeType || 'application/octet-stream';
    return { format, mimeType, extension: '', animated };
  }
  return { format, mimeType: FORMAT_MIME[format], extension: FORMAT_EXTENSION[format], animated };
}

function normalizedMimeType(type?: string): string {
  return type?.split(';', 1)[0]?.trim().toLowerCase() || '';
}

/**
 * Identifies a common image container from its magic bytes.
 *
 * The byte signature wins over the declared MIME type. A declared known image
 * MIME type is used as a fallback when a browser-provided Blob has no prefix
 * available (for example, when only a short header was retained).
 */
export function detectImageFormat(source: ArrayBuffer | ArrayBufferView, fallbackMimeType?: string): ImageFormatInfo {
  const bytes = toBytes(source);
  let format: ImageFormat = 'unknown';
  let animated = false;

  if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) format = 'jpeg';
  else if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) format = 'png';
  else if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') {
    format = 'gif';
    animated = isAnimatedGif(bytes);
  } else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    format = 'webp';
    animated = isAnimatedWebp(bytes);
  } else if (ascii(bytes, 4, 4) === 'ftyp' && ['avif', 'avis'].includes(ascii(bytes, 8, 4))) {
    format = 'avif';
    animated = isAnimatedAvif(bytes);
  } else if (hasBytes(bytes, 0, [0x42, 0x4d])) format = 'bmp';
  else if (hasBytes(bytes, 0, [0x00, 0x00, 0x01, 0x00])) format = 'ico';
  else if (hasBytes(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) || hasBytes(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])) format = 'tiff';

  if (format === 'unknown') {
    const declared = KNOWN_MIME.get(normalizedMimeType(fallbackMimeType));
    if (declared) format = declared;
  }
  return fromFormat(format, animated, normalizedMimeType(fallbackMimeType));
}

export function formatMimeType(format: ImageFormat): string {
  return format === 'unknown' ? 'application/octet-stream' : FORMAT_MIME[format];
}

export function formatFromMimeType(type?: string): ImageFormat {
  return KNOWN_MIME.get(normalizedMimeType(type)) ?? 'unknown';
}

export const supportedImageFormats: readonly ImageFormat[] = Object.freeze([
  'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'ico', 'tiff',
]);

