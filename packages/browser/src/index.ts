import { throwIfAborted, NexusImageError } from './errors';
import { getCapabilities } from './capabilities';
import { normalizeSource, type NormalizedSource } from './source';
import { parseExif, stripExifOrientation } from './exif/parser';
import { decoderCandidates } from './decode/select';
import type { DecodedImage, DrawTarget } from './decode/adapter';
import { createSurface, type CanvasSurface } from './render/surface';
import { calculateFitRect, createTransformPlan, getOrientationMatrix, getOrientedDimensions } from './render/transform';
import { encodeSurface } from './encode/to-blob';
import { probeImage } from './probe';
import { assertDecodedDimensions, assertEncodedBytes, assertOutputDimensions, resolveResourceLimits } from './limits';
import type {
  EncodeOptions,
  EncodedImage,
  ImageAsset,
  ImageMetadata,
  ImageSource,
  LoadOptions,
  NexusImageApi,
  ProcessedImage,
  ProcessOptions,
} from './types';

export * from './types';
export * from './errors';
export { getCapabilities, probeCapabilities, canDecode, canEncode } from './capabilities';
export type { CapabilityProbeOptions } from './capabilities';
export { detectImageFormat, formatFromMimeType, formatMimeType, supportedImageFormats } from './format';
export type { ImageFormat, ImageFormatInfo } from './format';
export { DEFAULT_RESOURCE_LIMITS, resolveResourceLimits } from './limits';
export { inspectAnimation } from './decode/animation';
export type { AnimationMetadata, AnimationInspectOptions, AnimationDecoderFactoryOptions } from './decode/animation';
export { parseExif, stripExifOrientation } from './exif/parser';
export { probeImage } from './probe';

interface InternalAsset {
  readonly source: NormalizedSource;
  readonly decoded: DecodedImage;
  readonly metadata: ImageMetadata;
  readonly orientationMode: 'preserve' | 'normalize';
  disposed: boolean;
}
interface InternalProcessed {
  readonly surface: CanvasSurface;
  readonly metadata: ImageMetadata;
  readonly ownedAsset?: InternalAsset;
  disposed: boolean;
}

const assets = new WeakMap<object, InternalAsset>();
const processedImages = new WeakMap<object, InternalProcessed>();

function createMetadata(
  source: NormalizedSource,
  decoded: DecodedImage,
  exif: ReturnType<typeof parseExif>,
): ImageMetadata {
  return {
    width: decoded.width,
    height: decoded.height,
    mimeType: source.mimeType,
    size: source.size,
    orientation: exif.orientation,
    exif: exif.exif,
    format: source.format?.format ?? 'unknown',
    animated: source.format?.animated ?? false,
  };
}
function releaseAsset(internal: InternalAsset): void {
  if (internal.disposed) return;
  internal.disposed = true;
  internal.decoded.dispose();
  internal.source.dispose();
}
function releaseProcessed(internal: InternalProcessed): void {
  if (internal.disposed) return;
  internal.disposed = true;
  internal.surface.dispose();
  if (internal.ownedAsset) releaseAsset(internal.ownedAsset);
}

async function loadInternal(
  source: ImageSource,
  options: LoadOptions = {},
): Promise<{ publicAsset: ImageAsset; internal: InternalAsset }> {
  throwIfAborted(options.signal);
  const limits = resolveResourceLimits(options.limits);
  const normalized = await normalizeSource(source, options.signal, limits);
  let decoded: DecodedImage | undefined;
  try {
    const byteView = new Uint8Array(normalized.bytes);
    const exif = parseExif(byteView);
    const isJpeg = byteView[0] === 0xff && byteView[1] === 0xd8;
    const strippedBytes =
      exif.orientation !== 1 && (normalized.mimeType === 'image/jpeg' || isJpeg)
        ? stripExifOrientation(byteView)
        : undefined;
    const decodeSource: NormalizedSource = strippedBytes
      ? {
          ...normalized,
          blob: new Blob([strippedBytes as unknown as BlobPart], { type: normalized.mimeType }),
          bytes: strippedBytes.buffer as ArrayBuffer,
          size: normalized.size,
        }
      : normalized;
    const capabilities = getCapabilities();
    const candidates = decoderCandidates(capabilities, options.decode ?? 'auto');
    if (candidates.length === 0)
      throw new NexusImageError('UNSUPPORTED', 'decode', 'No supported image decoder is available.');
    const failures: unknown[] = [];
    for (const candidate of candidates) {
      try {
        decoded = await candidate.decode(decodeSource, options.signal);
        break;
      } catch (error) {
        if (error instanceof NexusImageError && error.code === 'ABORTED') throw error;
        failures.push(error);
        if ((options.decode ?? 'auto') !== 'auto') throw error;
      }
    }
    if (!decoded) throw new NexusImageError('DECODE_FAILED', 'decode', 'All image decoders failed.', failures);
    assertDecodedDimensions(decoded.width, decoded.height, limits);
    const metadata = createMetadata(normalized, decoded, exif);
    const internal: InternalAsset = {
      source: normalized,
      decoded,
      metadata,
      orientationMode: options.orientation ?? 'normalize',
      disposed: false,
    };
    const publicAsset: ImageAsset = {
      metadata,
      dispose() {
        releaseAsset(internal);
      },
    };
    assets.set(publicAsset, internal);
    return { publicAsset, internal };
  } catch (error) {
    decoded?.dispose();
    normalized.dispose();
    if (error instanceof NexusImageError) throw error;
    throw new NexusImageError('DECODE_FAILED', 'decode', 'Unable to load image.', error);
  }
}

function resolveTargetSize(
  source: { width: number; height: number },
  resize: ProcessOptions['resize'],
): { width: number; height: number } {
  if (!resize) return { width: Math.max(1, Math.round(source.width)), height: Math.max(1, Math.round(source.height)) };
  const width = resize.width;
  const height = resize.height;
  if (width === undefined && height === undefined) return { ...source };
  if (width !== undefined && (!Number.isFinite(width) || width <= 0))
    throw new NexusImageError('RENDER_FAILED', 'render', 'resize.width must be positive.');
  if (height !== undefined && (!Number.isFinite(height) || height <= 0))
    throw new NexusImageError('RENDER_FAILED', 'render', 'resize.height must be positive.');
  const rounded =
    width !== undefined && height !== undefined
      ? { width: Math.round(width), height: Math.round(height) }
      : width !== undefined
        ? { width: Math.round(width), height: Math.round((width * source.height) / source.width) }
        : { width: Math.round(height!), height: Math.round((height! * source.width) / source.height) };
  if (rounded.width < 1 || rounded.height < 1)
    throw new NexusImageError('RENDER_FAILED', 'render', 'resize dimensions must round to at least 1 pixel.');
  return rounded;
}

function drawProcessed(
  internal: InternalAsset,
  surface: CanvasSurface,
  options: ProcessOptions,
  plan: ReturnType<typeof createTransformPlan>,
): void {
  const normalize = (options.orientation ?? internal.orientationMode) === 'normalize';
  const orientation = normalize ? internal.metadata.orientation : 1;
  const rect = calculateFitRect(
    plan.output,
    { width: surface.width, height: surface.height },
    options.resize?.fit ?? 'contain',
  );
  const context = surface.context;
  if (options.background) {
    context.save();
    context.fillStyle = options.background;
    context.fillRect(0, 0, surface.width, surface.height);
    context.restore();
  }
  context.save();
  context.translate(rect.x, rect.y);
  context.scale(rect.width / plan.output.width, rect.height / plan.output.height);
  const [a, b, c, d, e, f] = plan.matrix;
  context.transform(a, b, c, d, e, f);
  if (normalize && orientation !== 1) {
    const [oa, ob, oc, od, oe, of] = getOrientationMatrix(internal.decoded.width, internal.decoded.height, orientation);
    context.transform(oa, ob, oc, od, oe, of);
  }
  internal.decoded.draw(context as unknown as DrawTarget, 0, 0, internal.decoded.width, internal.decoded.height);
  context.restore();
}

async function processImage(source: ImageSource | ImageAsset, options: ProcessOptions = {}): Promise<ProcessedImage> {
  throwIfAborted(options.signal, 'render');
  const limits = resolveResourceLimits(options.limits);
  let internal: InternalAsset;
  let ownedAsset: InternalAsset | undefined;
  if (typeof source === 'object' && source !== null && assets.has(source)) {
    internal = assets.get(source)!;
    if (internal.disposed) throw new NexusImageError('INVALID_SOURCE', 'source', 'Image asset has been disposed.');
  } else {
    const loaded = await loadInternal(source as ImageSource, {
      ...(options.orientation === undefined ? {} : { orientation: options.orientation }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    internal = loaded.internal;
    ownedAsset = internal;
  }
  let dimensions: { width: number; height: number };
  let surface: CanvasSurface | undefined;
  let plan: ReturnType<typeof createTransformPlan>;
  try {
    assertDecodedDimensions(internal.decoded.width, internal.decoded.height, limits);
    const normalize = (options.orientation ?? internal.orientationMode) === 'normalize';
    const orientedSize = normalize
      ? getOrientedDimensions(internal.decoded.width, internal.decoded.height, internal.metadata.orientation)
      : { width: internal.decoded.width, height: internal.decoded.height };
    plan = createTransformPlan(orientedSize, options);
    dimensions = resolveTargetSize(plan.output, options.resize);
    assertOutputDimensions(dimensions.width, dimensions.height, limits);
    surface = createSurface(dimensions, getCapabilities());
    drawProcessed(internal, surface, options, plan);
  } catch (error) {
    surface?.dispose();
    if (ownedAsset) releaseAsset(ownedAsset);
    if (error instanceof NexusImageError) throw error;
    throw new NexusImageError('RENDER_FAILED', 'render', 'Unable to process image.', error);
  }
  const normalize = (options.orientation ?? internal.orientationMode) === 'normalize';
  const metadata: ImageMetadata = {
    ...internal.metadata,
    width: dimensions.width,
    height: dimensions.height,
    orientation: normalize ? 1 : internal.metadata.orientation,
  };
  const internalProcessed: InternalProcessed = {
    surface,
    metadata,
    ...(ownedAsset === undefined ? {} : { ownedAsset }),
    disposed: false,
  };
  const result: ProcessedImage = {
    width: dimensions.width,
    height: dimensions.height,
    metadata,
    dispose() {
      releaseProcessed(internalProcessed);
    },
  };
  processedImages.set(result, internalProcessed);
  return result;
}

async function encodeImage(image: ProcessedImage, options: EncodeOptions = {}): Promise<EncodedImage> {
  throwIfAborted(options.signal, 'encode');
  const internal = processedImages.get(image);
  if (!internal || internal.disposed)
    throw new NexusImageError(
      'INVALID_SOURCE',
      'encode',
      'Processed image has been disposed or is not from NexusImage.',
    );
  const limits = resolveResourceLimits(options.limits);
  try {
    const encoded = await encodeSurface(internal.surface, options);
    assertEncodedBytes(encoded.blob.size, limits);
    return { ...encoded, width: internal.metadata.width, height: internal.metadata.height };
  } catch (error) {
    throw error;
  }
}

export const NexusImage: NexusImageApi = Object.freeze({
  async load(source: ImageSource, options?: LoadOptions) {
    return (await loadInternal(source, options)).publicAsset;
  },
  async inspect(source: ImageSource, options?: LoadOptions) {
    const loaded = await loadInternal(source, options);
    try {
      return loaded.publicAsset.metadata;
    } finally {
      loaded.publicAsset.dispose();
    }
  },
  process: processImage,
  encode: encodeImage,
  probe: probeImage,
  getCapabilities,
});
