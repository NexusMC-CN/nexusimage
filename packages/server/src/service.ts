import { SharpImageEngine } from './engine.js';
import {
  NexusImageError,
  throwIfAborted,
  type EncodeOptions,
  type ImageCapabilities,
  type LoadOptions,
  type ProcessOptions,
} from '@nexusmc-cn/nexusimage/contracts';
import type {
  AnimationTranscodeOptions,
  NodeAnimatedImage,
  NodeAnimationEngineApi,
  NodeEncodedImage,
  NodeImageAsset,
  NodeImageSource,
  NodeProcessedImage,
  NexusImageServiceApi,
  NexusImageServiceOptions,
} from './types.js';

/**
 * Framework-neutral image service for Node hosts.
 *
 * The service owns no HTTP transport, error envelope, persistence, queue, or
 * cache. Those concerns stay with the application hosting this package.
 */
export class NexusImageService implements NexusImageServiceApi {
  private readonly engine: NexusImageServiceApi;
  private readonly animationEngine?: NodeAnimationEngineApi;

  constructor(options: NexusImageServiceOptions = {}) {
    this.engine = options.engine ?? new SharpImageEngine(options.engineOptions);
    this.animationEngine = options.animationEngine;
  }

  load(source: NodeImageSource, options?: LoadOptions): Promise<NodeImageAsset> {
    return this.engine.load(source, options);
  }

  inspect(source: NodeImageSource, options?: LoadOptions) {
    return this.engine.inspect(source, options);
  }

  process(source: NodeImageSource | NodeImageAsset, options?: ProcessOptions): Promise<NodeProcessedImage> {
    return this.engine.process(source, options);
  }

  encode(image: NodeProcessedImage, options?: EncodeOptions): Promise<NodeEncodedImage> {
    return this.engine.encode(image, options);
  }

  async transcodeAnimation(source: NodeImageSource, options: AnimationTranscodeOptions): Promise<NodeAnimatedImage> {
    if (!options || typeof options !== 'object')
      throw new NexusImageError('ENCODE_FAILED', 'encode', 'Animation options are required.');
    throwIfAborted(options.signal, 'source');
    if (!this.animationEngine) {
      throw new NexusImageError('UNSUPPORTED', 'capability', 'No animation engine is configured.');
    }
    return this.animationEngine.transcodeAnimation(source, options);
  }

  getCapabilities(): ImageCapabilities {
    return this.engine.getCapabilities();
  }
}

export function createNexusImageService(options: NexusImageServiceOptions = {}): NexusImageService {
  return new NexusImageService(options);
}
