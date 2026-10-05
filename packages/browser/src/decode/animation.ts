import { awaitWithAbort } from '../abort';
import { NexusImageError, throwIfAborted } from '../errors';
import { normalizeSource, type NormalizedSource } from '../source';
import type { ImageSource, ResourceLimits } from '../types';
import type { ImageFormat } from '../format';

/** Frame-level metadata exposed by the browser ImageDecoder track. */
export interface AnimationMetadata {
  /** Container format inferred from the source bytes. */
  readonly format: ImageFormat;
  /** True when the selected track has more than one frame or reports animation. */
  readonly animated: boolean;
  /** Number of frames in the selected track. Static images report 1. */
  readonly frameCount: number;
  /** Duration supplied by the decoder track, when the browser exposes it. */
  readonly duration?: number;
  /** Number of repeats, when the decoder exposes it. */
  readonly repetitionCount?: number;
}

export interface AnimationInspectOptions {
  readonly signal?: AbortSignal;
  readonly limits?: ResourceLimits;
}

interface AnimationTrack {
  frameCount?: number;
  animated?: boolean;
  duration?: number;
  frameDuration?: number;
  repetitionCount?: number;
}

interface AnimationDecoder {
  tracks?: {
    selectedTrack?: AnimationTrack;
    ready?: Promise<unknown>;
  };
  close(): void;
}

type AnimationDecoderConstructor = new (options: { data: ArrayBuffer; type: string }) => AnimationDecoder;

export interface AnimationDecoderFactoryOptions {
  readonly decoder?: AnimationDecoderConstructor;
}

function decoderConstructor(override?: AnimationDecoderConstructor): AnimationDecoderConstructor | undefined {
  return override ?? (globalThis as typeof globalThis & { ImageDecoder?: AnimationDecoderConstructor }).ImageDecoder;
}

function metadataFromTrack(source: NormalizedSource, track: AnimationTrack | undefined): AnimationMetadata {
  const rawFrameCount = track?.frameCount;
  const frameCount =
    rawFrameCount !== undefined && Number.isFinite(rawFrameCount) && rawFrameCount > 0
      ? Math.max(1, Math.trunc(rawFrameCount))
      : 1;
  const animated = track?.animated ?? frameCount > 1;
  const trackDuration =
    track?.duration ?? (track?.frameDuration !== undefined ? track.frameDuration * frameCount : undefined);
  const duration =
    trackDuration !== undefined && Number.isFinite(trackDuration) && trackDuration >= 0 ? trackDuration : undefined;
  return {
    format: source.format?.format ?? 'unknown',
    animated,
    frameCount,
    ...(duration === undefined ? {} : { duration }),
    ...(track?.repetitionCount === undefined || !Number.isFinite(track.repetitionCount) || track.repetitionCount < 0
      ? {}
      : { repetitionCount: track.repetitionCount }),
  };
}

/**
 * Query animation metadata without changing the normal first-frame decode path.
 * ImageDecoder is required because createImageBitmap and HTMLImageElement do not
 * expose frame counts consistently across browsers.
 */
export async function inspectAnimation(
  source: ImageSource,
  options: AnimationInspectOptions = {},
  factoryOptions: AnimationDecoderFactoryOptions = {},
): Promise<AnimationMetadata> {
  throwIfAborted(options.signal, 'decode');
  const normalized = await normalizeSource(source, options.signal, options.limits);
  let decoder: AnimationDecoder | undefined;
  try {
    const Decoder = decoderConstructor(factoryOptions.decoder);
    if (!Decoder)
      throw new NexusImageError('UNSUPPORTED', 'decode', 'ImageDecoder is unavailable for animation metadata.');
    const bytes = normalized.bytes;
    throwIfAborted(options.signal, 'decode');
    decoder = new Decoder({ data: bytes, type: normalized.mimeType });
    if (decoder.tracks?.ready)
      await awaitWithAbort(decoder.tracks.ready, options.signal, undefined, () => decoder?.close(), 'decode');
    throwIfAborted(options.signal, 'decode');
    return metadataFromTrack(normalized, decoder.tracks?.selectedTrack);
  } catch (error) {
    if (error instanceof NexusImageError) throw error;
    throw new NexusImageError('DECODE_FAILED', 'decode', 'Unable to inspect animation metadata.', error);
  } finally {
    decoder?.close();
    normalized.dispose();
  }
}
