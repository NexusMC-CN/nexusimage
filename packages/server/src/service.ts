import { SharpImageEngine } from './engine.js';
import type { EncodeOptions, ImageCapabilities, LoadOptions, ProcessOptions } from 'nexusimage/contracts';
import type {
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

  constructor(options: NexusImageServiceOptions = {}) {
    this.engine = options.engine ?? new SharpImageEngine(options.engineOptions);
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

  getCapabilities(): ImageCapabilities {
    return this.engine.getCapabilities();
  }
}

export function createNexusImageService(options: NexusImageServiceOptions = {}): NexusImageService {
  return new NexusImageService(options);
}
