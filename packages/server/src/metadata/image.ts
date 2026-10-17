import sharp, { type Metadata } from 'sharp';
import {
  detectImageFormat,
  formatMimeType,
  parseExif,
  NexusImageError,
  type ImageFormat,
  type ImageMetadata,
} from '@nexusmc-cn/nexusimage/contracts';

function formatFromSharpName(value?: string): ImageFormat {
  switch (value?.toLowerCase()) {
    case 'jpeg':
    case 'jpg':
      return 'jpeg';
    case 'png':
      return 'png';
    case 'webp':
      return 'webp';
    case 'gif':
      return 'gif';
    case 'avif':
      return 'avif';
    case 'bmp':
      return 'bmp';
    case 'ico':
      return 'ico';
    case 'tiff':
    case 'tif':
      return 'tiff';
    default:
      return 'unknown';
  }
}

function createMetadata(input: Buffer, mimeType: string | undefined, metadata: Metadata): ImageMetadata {
  const detected = detectImageFormat(input, mimeType);
  const format = detected.format === 'unknown' ? formatFromSharpName(metadata.format) : detected.format;
  const resolvedMimeType =
    detected.format === 'unknown' && format !== 'unknown'
      ? formatMimeType(format)
      : detected.mimeType || mimeType || formatMimeType(format);
  const exif = parseExif(input);
  const orientation = metadata.orientation;
  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  if (!width || !height) throw new NexusImageError('DECODE_FAILED', 'decode', 'Sharp did not return image dimensions.');
  return {
    width,
    height,
    mimeType: resolvedMimeType,
    size: input.byteLength,
    orientation:
      orientation !== undefined && Number.isInteger(orientation) && orientation >= 1 && orientation <= 8
        ? orientation
        : exif.orientation,
    exif: exif.exif,
    format,
    animated: (metadata.pages ?? 1) > 1 || detected.animated,
  };
}

export async function readImageMetadata(input: Buffer, mimeType?: string): Promise<ImageMetadata> {
  let metadata: Metadata;
  try {
    // Processing uses the first frame; loading all frames here would apply limits to their stacked height.
    metadata = await sharp(input, { animated: false }).metadata();
  } catch (error) {
    throw new NexusImageError('DECODE_FAILED', 'decode', 'Sharp could not decode the image.', error);
  }
  return createMetadata(input, mimeType, metadata);
}
