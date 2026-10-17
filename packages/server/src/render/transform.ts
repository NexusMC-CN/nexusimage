import { NexusImageError, type ImageMetadata, type ProcessOptions } from '@nexusmc-cn/nexusimage/contracts';

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new NexusImageError('RENDER_FAILED', 'render', `${label} must be a positive finite number.`);
  }
}

export function integerCrop(
  crop: NonNullable<ProcessOptions['crop']>,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  for (const [name, value] of Object.entries(crop)) {
    if (!Number.isFinite(value) || (name === 'x' || name === 'y' ? value < 0 : value <= 0)) {
      throw new NexusImageError(
        'RENDER_FAILED',
        'render',
        `${name === 'x' || name === 'y' ? `crop.${name} must be non-negative` : `crop.${name} must be positive`} and finite.`,
      );
    }
  }
  const result = {
    left: Math.round(crop.x),
    top: Math.round(crop.y),
    width: Math.round(crop.width),
    height: Math.round(crop.height),
  };
  if (
    result.left < 0 ||
    result.top < 0 ||
    result.width < 1 ||
    result.height < 1 ||
    result.left + result.width > width ||
    result.top + result.height > height
  ) {
    throw new NexusImageError('RENDER_FAILED', 'render', 'crop must be contained within the decoded image.');
  }
  return result;
}

export function orientedDimensions(
  width: number,
  height: number,
  orientation: number,
): { width: number; height: number } {
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

function rotatedDimensions(width: number, height: number, degrees: number): { width: number; height: number } {
  if (!degrees) return { width, height };
  const radians = (Math.abs(degrees) * Math.PI) / 180;
  return {
    width: Math.max(1, Math.ceil(Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians)))),
    height: Math.max(1, Math.ceil(Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians)))),
  };
}

export function estimatedOutputDimensions(
  metadata: ImageMetadata,
  options: ProcessOptions,
): { width: number; height: number } {
  const normalize = (options.orientation ?? 'normalize') === 'normalize';
  let { width, height } = normalize
    ? orientedDimensions(metadata.width, metadata.height, metadata.orientation)
    : { width: metadata.width, height: metadata.height };
  if (options.crop) {
    const crop = integerCrop(options.crop, width, height);
    width = crop.width;
    height = crop.height;
  }
  if (options.rotate !== undefined) {
    if (!Number.isFinite(options.rotate))
      throw new NexusImageError('RENDER_FAILED', 'render', 'rotate must be finite.');
    ({ width, height } = rotatedDimensions(width, height, options.rotate));
  }
  if (options.resize) {
    const resize = options.resize;
    if (resize.width !== undefined) assertFinitePositive(resize.width, 'resize.width');
    if (resize.height !== undefined) assertFinitePositive(resize.height, 'resize.height');
    if (resize.width !== undefined && resize.height !== undefined)
      ({ width, height } = { width: Math.round(resize.width), height: Math.round(resize.height) });
    else if (resize.width !== undefined)
      ({ width, height } = {
        width: Math.round(resize.width),
        height: Math.max(1, Math.round((resize.width * height) / width)),
      });
    else if (resize.height !== undefined)
      ({ width, height } = {
        width: Math.max(1, Math.round((resize.height * width) / height)),
        height: Math.round(resize.height),
      });
  }
  if (width < 1 || height < 1)
    throw new NexusImageError('RENDER_FAILED', 'render', 'Output dimensions must be at least one pixel.');
  return { width, height };
}
