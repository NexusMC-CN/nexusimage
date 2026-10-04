import { NexusImageError } from '../errors';
import { availableModes } from '../capabilities';
import type { DecodeMode, ImageCapabilities } from '../types';
import type { DecodeAdapter } from './adapter';
import { htmlImageAdapter } from './html-image';
import { createImageBitmapAdapter } from './image-bitmap';
import { imageDecoderAdapter } from './image-decoder';

export function selectDecoder(capabilities: ImageCapabilities, mode: DecodeMode): DecodeAdapter {
  const selected = availableModes(capabilities, mode)[0];
  if (!selected) throw new NexusImageError('UNSUPPORTED', 'decode', 'No supported image decoder is available.');
  if (selected === 'image-decoder') return imageDecoderAdapter();
  if (selected === 'create-image-bitmap') return createImageBitmapAdapter();
  return htmlImageAdapter();
}

export function decoderCandidates(capabilities: ImageCapabilities, mode: DecodeMode): DecodeAdapter[] {
  const modes = availableModes(capabilities, mode);
  return modes.map((candidate) => {
    if (candidate === 'image-decoder') return imageDecoderAdapter();
    if (candidate === 'create-image-bitmap') return createImageBitmapAdapter();
    return htmlImageAdapter();
  });
}
