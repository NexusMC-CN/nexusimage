import type {
  EncodeOptions,
  ImageCapabilities,
  ImageMetadata,
  ImageSource,
  LoadOptions,
  ProcessOptions,
} from 'nexusimage/contracts';

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
export interface NodeEncodedImage {
  readonly buffer: Buffer;
  readonly type: string;
  readonly width: number;
  readonly height: number;
  readonly metadata: ImageMetadata;
}

export interface SharpImageEngineOptions {
  readonly limits?: import('nexusimage/contracts').ResourceLimits;
}

export interface SharpImageEngineApi {
  load(source: NodeImageSource, options?: LoadOptions): Promise<NodeImageAsset>;
  inspect(source: NodeImageSource, options?: LoadOptions): Promise<ImageMetadata>;
  process(source: NodeImageSource | NodeImageAsset, options?: ProcessOptions): Promise<NodeProcessedImage>;
  encode(image: NodeProcessedImage, options?: EncodeOptions): Promise<NodeEncodedImage>;
  getCapabilities(): ImageCapabilities;
}
