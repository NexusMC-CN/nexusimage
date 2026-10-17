import type { Sharp } from 'sharp';
import { formatFromMimeType, NexusImageError } from '@nexusmc-cn/nexusimage/contracts';

export function applyEncoding(pipeline: Sharp, type: string, quality?: number): { pipeline: Sharp; type: string } {
  const format = formatFromMimeType(type);
  const qualityValue = quality === undefined ? undefined : Math.max(1, Math.round(quality * 100));
  switch (format) {
    case 'jpeg':
      return {
        pipeline: pipeline.jpeg(qualityValue === undefined ? {} : { quality: qualityValue }),
        type: 'image/jpeg',
      };
    case 'png':
      return { pipeline: pipeline.png(qualityValue === undefined ? {} : { quality: qualityValue }), type: 'image/png' };
    case 'webp':
      return {
        pipeline: pipeline.webp(qualityValue === undefined ? {} : { quality: qualityValue }),
        type: 'image/webp',
      };
    case 'avif':
      return {
        pipeline: pipeline.avif(qualityValue === undefined ? {} : { quality: qualityValue }),
        type: 'image/avif',
      };
    case 'gif':
      return { pipeline: pipeline.gif(), type: 'image/gif' };
    case 'tiff':
      return {
        pipeline: pipeline.tiff(qualityValue === undefined ? {} : { quality: qualityValue }),
        type: 'image/tiff',
      };
    default:
      throw new NexusImageError('ENCODE_FAILED', 'encode', `Unsupported output type: ${type}.`);
  }
}
