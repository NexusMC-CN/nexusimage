import { awaitWithAbort } from './abort';
import { NexusImageError, throwIfAborted } from './errors';
import { htmlImageAdapter } from './decode/html-image';
import { resolveResourceLimits } from './limits';
import { normalizeSource, type NormalizedSource } from './source';
import type { ImageProbeResult, ImageSource, ProbeOptions } from './types';

type ImageConstructor = new () => HTMLImageElement;

function imageConstructor(): ImageConstructor | undefined {
  return (globalThis as typeof globalThis & { Image?: ImageConstructor }).Image;
}

function isUrlSource(source: ImageSource): source is string | URL {
  return typeof source === 'string' || source instanceof URL;
}

function isCorsFetchFailure(error: unknown): boolean {
  if (!(error instanceof NexusImageError) || error.code !== 'INVALID_SOURCE' || error.stage !== 'source') return false;
  if (error.cause instanceof TypeError) return true;
  return error.cause instanceof Error && /failed to fetch|cors|network/i.test(error.cause.message);
}

function resultFromNormalized(source: NormalizedSource, width: number, height: number): ImageProbeResult {
  return {
    width,
    height,
    format: source.format?.format ?? 'unknown',
    mimeType: source.mimeType || 'application/octet-stream',
    animated: source.format?.animated ?? false,
  };
}

async function probeNormalized(source: NormalizedSource, signal?: AbortSignal): Promise<ImageProbeResult> {
  const decoded = await htmlImageAdapter().decode(source, signal);
  try {
    return resultFromNormalized(source, decoded.width, decoded.height);
  } finally {
    decoded.dispose();
  }
}

async function probeUrlWithHtmlImage(url: string, options: ProbeOptions): Promise<ImageProbeResult> {
  const ImageCtor = imageConstructor();
  if (!ImageCtor)
    throw new NexusImageError('UNSUPPORTED', 'decode', 'HTMLImageElement is unavailable for URL probing.');
  throwIfAborted(options.signal, 'decode');
  const timeoutMs = resolveResourceLimits(options.limits).fetchTimeoutMs;
  const image = new ImageCtor();
  image.decoding = 'async';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let eventsDetached = false;
  const cleanup = () => {
    if (timer !== undefined) clearTimeout(timer);
    if (!eventsDetached) {
      image.onload = null;
      image.onerror = null;
      eventsDetached = true;
    }
    image.src = '';
  };
  const loading = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new NexusImageError('INVALID_SOURCE', 'source', 'HTML image URL failed to load.'));
    timer = setTimeout(
      () => reject(new NexusImageError('RESOURCE_LIMIT', 'source', 'Image probe exceeded the configured timeout.')),
      timeoutMs,
    );
    image.src = url;
  });
  try {
    await awaitWithAbort(loading, options.signal, undefined, cleanup, 'decode');
    throwIfAborted(options.signal, 'decode');
    if (!image.naturalWidth || !image.naturalHeight)
      throw new NexusImageError('DECODE_FAILED', 'decode', 'HTML image returned invalid dimensions.');
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      format: 'unknown',
      mimeType: 'application/octet-stream',
      animated: false,
    };
  } catch (error) {
    if (error instanceof NexusImageError) throw error;
    throw new NexusImageError('DECODE_FAILED', 'decode', 'Unable to probe URL image.', error);
  } finally {
    cleanup();
  }
}

/** Reads image dimensions without creating a processable image asset. */
export async function probeImage(source: ImageSource, options: ProbeOptions = {}): Promise<ImageProbeResult> {
  throwIfAborted(options.signal, 'source');
  try {
    const normalized = await normalizeSource(source, options.signal, options.limits);
    try {
      return await probeNormalized(normalized, options.signal);
    } finally {
      normalized.dispose();
    }
  } catch (error) {
    if (isUrlSource(source) && isCorsFetchFailure(error)) {
      return probeUrlWithHtmlImage(String(source), options);
    }
    throw error;
  }
}
