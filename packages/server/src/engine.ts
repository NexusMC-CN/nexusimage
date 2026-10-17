import sharp, { type Sharp } from 'sharp';
import {
  assertDecodedDimensions,
  assertEncodedBytes,
  assertOutputDimensions,
  formatFromMimeType,
  formatMimeType,
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
} from '@nexusmc-cn/nexusimage/contracts';
import type {
  NodeEncodedImage,
  NodeImageAsset,
  NodeImageSource,
  NodeProcessedImage,
  SharpImageEngineApi,
  SharpImageEngineOptions,
} from './types.js';
import { sourceSizeHint, toInputBuffer } from './source/input.js';
import { readImageMetadata } from './metadata/image.js';
import { estimatedOutputDimensions, integerCrop, orientedDimensions } from './render/transform.js';
import { applyEncoding } from './encode/format.js';

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
    const imageMetadata = await readImageMetadata(input.buffer, input.mimeType);
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
