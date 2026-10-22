import type {
  EncodeOptions,
  EncodedImageBase,
  ImageCapabilities,
  ImageMetadata,
  ImageSource,
  LoadOptions,
  ProcessOptions,
} from '@nexusmc-cn/nexusimage/contracts';
import type { AnimationResourceLimits } from './animation/limits.js';

/** Sources accepted by the Node adapter. Remote URLs and filesystem paths stay in the host API. */
export type NodeImageSource = Exclude<ImageSource, string | URL>;

export interface NodeImageAsset {
  readonly metadata: ImageMetadata;
  dispose(): void;
}

export interface NodeProcessedImage {
  readonly width: number;
  readonly height: number;
  readonly metadata: ImageMetadata;
  dispose(): void;
}

/** Node encodes return a Buffer; the browser contract's Blob is intentionally not used here. */
export interface NodeEncodedImage extends EncodedImageBase {
  readonly buffer: Buffer;
  readonly metadata: ImageMetadata;
}

export type AnimationOutputType = 'image/gif' | 'image/webp' | 'image/avif';

/** Explicit, one-call processing of every frame in an animated image. */
export interface AnimationTranscodeOptions extends Pick<
  ProcessOptions,
  'crop' | 'rotate' | 'flip' | 'resize' | 'background'
> {
  readonly type: AnimationOutputType;
  /** Encoder quality from 0 to 1. GIF does not accept this option. */
  readonly quality?: number;
  readonly limits?: AnimationResourceLimits;
  readonly signal?: AbortSignal;
}

export interface NodeAnimatedImage extends EncodedImageBase {
  readonly buffer: Buffer;
  readonly type: AnimationOutputType;
  /** Number of encoded frames in one playback cycle. */
  readonly frameCount: number;
  /** Measured duration of one encoded playback cycle, in milliseconds. */
  readonly durationMs: number;
}

export interface NodeAnimationEngineApi {
  transcodeAnimation(source: NodeImageSource, options: AnimationTranscodeOptions): Promise<NodeAnimatedImage>;
}

export interface SharpImageEngineOptions {
  readonly limits?: import('@nexusmc-cn/nexusimage/contracts').ResourceLimits;
}

export interface SharpImageEngineApi {
  load(source: NodeImageSource, options?: LoadOptions): Promise<NodeImageAsset>;
  inspect(source: NodeImageSource, options?: LoadOptions): Promise<ImageMetadata>;
  process(source: NodeImageSource | NodeImageAsset, options?: ProcessOptions): Promise<NodeProcessedImage>;
  encode(image: NodeProcessedImage, options?: EncodeOptions): Promise<NodeEncodedImage>;
  getCapabilities(): ImageCapabilities;
}

/** Configuration for the framework-neutral Node service facade. */
export interface NexusImageServiceOptions {
  /** Inject an engine when the host owns its lifecycle or wants a different backend. */
  readonly engine?: SharpImageEngineApi;
  /** Options used when the default Sharp engine is created. */
  readonly engineOptions?: SharpImageEngineOptions;
  /** Optional backend for explicitly requested multi-frame transcoding. */
  readonly animationEngine?: NodeAnimationEngineApi;
}

/** Public service surface shared by HTTP adapters and non-HTTP hosts. */
export interface NexusImageServiceApi extends SharpImageEngineApi {
  /** Optional to preserve compatibility with existing host implementations. */
  transcodeAnimation?(source: NodeImageSource, options: AnimationTranscodeOptions): Promise<NodeAnimatedImage>;
}
