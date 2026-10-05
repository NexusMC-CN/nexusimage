import sharp, { type Metadata, type Sharp } from 'sharp';
import {
  assertDecodedDimensions,
  assertEncodedBytes,
  assertOutputDimensions,
  detectImageFormat,
  formatFromMimeType,
  formatMimeType,
  parseExif,
  resolveResourceLimits,
  NexusImageError,
  throwIfAborted,
  type EncodeOptions,
  type ImageCapabilities,
  type ImageFormat,
  type ImageMetadata,
  type LoadOptions,
  type ProcessOptions,
  type ResourceLimits,
} from 'nexusimage/contracts';
import type {
  NodeEncodedImage,
  NodeImageAsset,
  NodeImageSource,
  NodeProcessedImage,
  SharpImageEngineApi,
  SharpImageEngineOptions,
} from './types.js';

interface InternalAsset {
  buffer?: Buffer;
  readonly metadata: ImageMetadata;
  readonly orientationMode: 'preserve' | 'normalize';
  disposed: boolean;
}

interface InternalProcessed {
  buffer?: Buffer;
  readonly metadata: ImageMetadata;
  disposed: boolean;
}

interface PreparedSource {
  readonly buffer: Buffer;
  readonly metadata: ImageMetadata;
}

const assets = new WeakMap<object, InternalAsset>();
const processedImages = new WeakMap<object, InternalProcessed>();

const NODE_DECODE_FORMATS: readonly ImageFormat[] = Object.freeze([
  'jpeg',
  'png',
  'webp',
  'gif',
  'avif',
  'bmp',
  'ico',
  'tiff',
]);
const NODE_ENCODE_FORMATS: readonly ImageFormat[] = Object.freeze(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff']);

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function mergeLimits(defaults: ReturnType<typeof resolveResourceLimits>, limits?: ResourceLimits) {
  if (!limits) return defaults;
  const merged: ResourceLimits = {};
  for (const key of [
    'maxInputBytes',
    'maxInputPixels',
    'maxInputWidth',
    'maxInputHeight',
    'maxOutputBytes',
    'maxOutputPixels',
    'maxOutputWidth',
    'maxOutputHeight',
    'fetchTimeoutMs',
  ] as const) {
    const requested = limits[key];
    merged[key] = requested === undefined ? defaults[key] : Math.min(defaults[key], requested);
  }
  return resolveResourceLimits(merged);
}

async function toInputBuffer(
  source: NodeImageSource,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; mimeType?: string }> {
  throwIfAborted(signal, 'source');
  if (Buffer.isBuffer(source)) return { buffer: Buffer.from(source) };
  if (source instanceof Uint8Array) return { buffer: Buffer.from(source.buffer, source.byteOffset, source.byteLength) };
  if (source instanceof ArrayBuffer) return { buffer: Buffer.from(source) };
  if (isBlob(source)) {
    try {
      const bytes = await source.arrayBuffer();
      throwIfAborted(signal, 'source');
      return { buffer: Buffer.from(bytes), mimeType: source.type || undefined };
    } catch (error) {
      if (error instanceof NexusImageError) throw error;
      throw new NexusImageError('INVALID_SOURCE', 'source', 'Unable to read Blob source.', error);
    }
  }
  throw new NexusImageError(
    'INVALID_SOURCE',
    'source',
    'NodeImageSource must be a Buffer, Uint8Array, ArrayBuffer, Blob, or File.',
  );
}

function sourceSizeHint(source: NodeImageSource): number | undefined {
  if (Buffer.isBuffer(source)) return source.byteLength;
  if (source instanceof Uint8Array) return source.byteLength;
  if (source instanceof ArrayBuffer) return source.byteLength;
  if (isBlob(source)) return source.size;
  return undefined;
}

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
  const width = metadata.width;
  const height = metadata.pageHeight ?? metadata.height;
  if (!width || !height) throw new NexusImageError('DECODE_FAILED', 'decode', 'Sharp did not return image dimensions.');
  return {
    width,
    height,
    mimeType: resolvedMimeType,
    size: input.byteLength,
    orientation: exif.orientation,
    exif: exif.exif,
    format,
    animated: (metadata.pages ?? 1) > 1 || detected.animated,
  };
}

function releaseAsset(internal: InternalAsset): void {
  if (internal.disposed) return;
  internal.disposed = true;
  internal.buffer = undefined;
}

function releaseProcessed(internal: InternalProcessed): void {
  if (internal.disposed) return;
  internal.disposed = true;
  internal.buffer = undefined;
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new NexusImageError('RENDER_FAILED', 'render', `${label} must be a positive finite number.`);
  }
}

function integerCrop(
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

function orientedDimensions(width: number, height: number, orientation: number): { width: number; height: number } {
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

function estimatedOutputDimensions(
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

function applyEncoding(pipeline: Sharp, type: string, quality?: number): { pipeline: Sharp; type: string } {
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

export class SharpImageEngine implements SharpImageEngineApi {
  private readonly defaults: ReturnType<typeof resolveResourceLimits>;

  constructor(options: SharpImageEngineOptions = {}) {
    this.defaults = resolveResourceLimits(options.limits);
  }

  getCapabilities(): ImageCapabilities {
    return {
      imageDecoder: false,
      createImageBitmap: false,
      htmlImage: false,
      offscreenCanvas: false,
      canvasToBlob: false,
      decodeFormats: NODE_DECODE_FORMATS,
      encodeFormats: NODE_ENCODE_FORMATS,
      canDecode: (type: string) => NODE_DECODE_FORMATS.includes(formatFromMimeType(type)),
      canEncode: (type: string) => NODE_ENCODE_FORMATS.includes(formatFromMimeType(type)),
    };
  }

  private limits(limits?: ResourceLimits) {
    return mergeLimits(this.defaults, limits);
  }

  private async prepare(source: NodeImageSource, options: LoadOptions = {}): Promise<PreparedSource> {
    const limits = this.limits(options.limits);
    const hintedSize = sourceSizeHint(source);
    if (hintedSize !== undefined && hintedSize > limits.maxInputBytes) {
      throw new NexusImageError(
        'RESOURCE_LIMIT',
        'source',
        `Input bytes exceeds the configured resource limit (${limits.maxInputBytes}).`,
      );
    }
    const input = await toInputBuffer(source, options.signal);
    if (input.buffer.byteLength === 0) throw new NexusImageError('INVALID_SOURCE', 'source', 'Image source is empty.');
    if (input.buffer.byteLength > limits.maxInputBytes)
      throw new NexusImageError(
        'RESOURCE_LIMIT',
        'source',
        `Input bytes exceeds the configured resource limit (${limits.maxInputBytes}).`,
      );
    throwIfAborted(options.signal, 'decode');
    let metadata: Metadata;
    try {
      metadata = await sharp(input.buffer, { animated: true }).metadata();
    } catch (error) {
      throw new NexusImageError('DECODE_FAILED', 'decode', 'Sharp could not decode the image.', error);
    }
    const imageMetadata = createMetadata(input.buffer, input.mimeType, metadata);
    assertDecodedDimensions(imageMetadata.width, imageMetadata.height, limits);
    throwIfAborted(options.signal, 'decode');
    return { buffer: input.buffer, metadata: imageMetadata };
  }

  async inspect(source: NodeImageSource, options: LoadOptions = {}): Promise<ImageMetadata> {
    const prepared = await this.prepare(source, options);
    return prepared.metadata;
  }

  async load(source: NodeImageSource, options: LoadOptions = {}): Promise<NodeImageAsset> {
    const prepared = await this.prepare(source, options);
    const internal: InternalAsset = {
      buffer: prepared.buffer,
      metadata: prepared.metadata,
      orientationMode: options.orientation ?? 'normalize',
      disposed: false,
    };
    const asset: NodeImageAsset = {
      metadata: internal.metadata,
      dispose: () => releaseAsset(internal),
    };
    assets.set(asset, internal);
    return asset;
  }

  async process(source: NodeImageSource | NodeImageAsset, options: ProcessOptions = {}): Promise<NodeProcessedImage> {
    throwIfAborted(options.signal, 'render');
    let buffer: Buffer;
    let metadata: ImageMetadata;
    let orientationMode: 'preserve' | 'normalize' = 'normalize';
    if (typeof source === 'object' && source !== null && assets.has(source)) {
      const internal = assets.get(source)!;
      if (internal.disposed || !internal.buffer)
        throw new NexusImageError('INVALID_SOURCE', 'source', 'Image asset has been disposed.');
      buffer = internal.buffer;
      metadata = internal.metadata;
      orientationMode = internal.orientationMode;
    } else {
      const prepared = await this.prepare(source as NodeImageSource, options);
      ({ buffer, metadata } = prepared);
      orientationMode = options.orientation ?? 'normalize';
    }
    const effectiveOptions = { ...options, orientation: options.orientation ?? orientationMode };
    const limits = this.limits(options.limits);
    assertDecodedDimensions(metadata.width, metadata.height, limits);
    if (buffer.byteLength > limits.maxInputBytes) {
      throw new NexusImageError(
        'RESOURCE_LIMIT',
        'source',
        `Input bytes exceeds the configured resource limit (${limits.maxInputBytes}).`,
      );
    }
    const estimate = estimatedOutputDimensions(metadata, effectiveOptions);
    assertOutputDimensions(estimate.width, estimate.height, limits);
    throwIfAborted(options.signal, 'render');
    try {
      let pipeline = sharp(buffer, { animated: false });
      const normalize = effectiveOptions.orientation === 'normalize';
      if (normalize && metadata.orientation !== 1) pipeline = pipeline.rotate();
      if (effectiveOptions.crop) {
        const oriented = normalize
          ? orientedDimensions(metadata.width, metadata.height, metadata.orientation)
          : { width: metadata.width, height: metadata.height };
        pipeline = pipeline.extract(integerCrop(effectiveOptions.crop, oriented.width, oriented.height));
      }
      if (effectiveOptions.rotate !== undefined && effectiveOptions.rotate !== 0)
        pipeline = pipeline.rotate(
          effectiveOptions.rotate,
          effectiveOptions.background ? { background: effectiveOptions.background } : undefined,
        );
      if (effectiveOptions.flip?.horizontal) pipeline = pipeline.flop();
      if (effectiveOptions.flip?.vertical) pipeline = pipeline.flip();
      if (effectiveOptions.resize) {
        const resize = effectiveOptions.resize;
        const resizeOptions = {
          ...(resize.width === undefined ? {} : { width: Math.round(resize.width) }),
          ...(resize.height === undefined ? {} : { height: Math.round(resize.height) }),
          fit: resize.fit ?? 'contain',
          ...(effectiveOptions.background ? { background: effectiveOptions.background } : {}),
        } as Parameters<Sharp['resize']>[0];
        pipeline = pipeline.resize(resizeOptions);
      }
      const output = await pipeline.toBuffer();
      throwIfAborted(options.signal, 'render');
      const outputMetadata = await sharp(output, { animated: false }).metadata();
      const width = outputMetadata.width ?? estimate.width;
      const height = outputMetadata.height ?? estimate.height;
      assertOutputDimensions(width, height, limits);
      const processedMetadata: ImageMetadata = {
        ...metadata,
        width,
        height,
        size: output.byteLength,
        orientation: effectiveOptions.orientation === 'normalize' ? 1 : metadata.orientation,
      };
      const internal: InternalProcessed = { buffer: output, metadata: processedMetadata, disposed: false };
      const processed: NodeProcessedImage = {
        width,
        height,
        metadata: processedMetadata,
        dispose: () => releaseProcessed(internal),
      };
      processedImages.set(processed, internal);
      return processed;
    } catch (error) {
      if (error instanceof NexusImageError) throw error;
      throw new NexusImageError('RENDER_FAILED', 'render', 'Sharp could not process the image.', error);
    }
  }

  async encode(image: NodeProcessedImage, options: EncodeOptions = {}): Promise<NodeEncodedImage> {
    throwIfAborted(options.signal, 'encode');
    const internal = processedImages.get(image);
    if (!internal || internal.disposed || !internal.buffer)
      throw new NexusImageError(
        'INVALID_SOURCE',
        'encode',
        'Processed image has been disposed or is not from NexusImage.',
      );
    const limits = this.limits(options.limits);
    const type = options.type ?? 'image/png';
    try {
      if (
        options.quality !== undefined &&
        (!Number.isFinite(options.quality) || options.quality < 0 || options.quality > 1)
      ) {
        throw new NexusImageError('ENCODE_FAILED', 'encode', 'quality must be between 0 and 1.');
      }
      const encoded = await applyEncoding(
        sharp(internal.buffer, { animated: false }),
        type,
        options.quality,
      ).pipeline.toBuffer();
      throwIfAborted(options.signal, 'encode');
      assertEncodedBytes(encoded.byteLength, limits);
      const encodedType = formatMimeType(formatFromMimeType(type));
      return {
        buffer: encoded,
        type: encodedType,
        width: internal.metadata.width,
        height: internal.metadata.height,
        metadata: internal.metadata,
      };
    } catch (error) {
      if (error instanceof NexusImageError) throw error;
      throw new NexusImageError('ENCODE_FAILED', 'encode', 'Sharp could not encode the image.', error);
    }
  }
}

export function createSharpImageEngine(options?: SharpImageEngineOptions): SharpImageEngine {
  return new SharpImageEngine(options);
}
