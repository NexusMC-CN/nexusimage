import type { ImageFormat } from './format';

export type ImageSource = Blob | File | ArrayBuffer | Uint8Array | string | URL;

export type DecodeMode = 'auto' | 'image-decoder' | 'create-image-bitmap' | 'html-image';
export type OrientationMode = 'preserve' | 'normalize';
export type FitMode = 'contain' | 'cover' | 'fill';

/** A source-space rectangle used to crop an image before other transforms. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rotation in clockwise degrees. Arbitrary finite angles are supported. */
export type Rotation = number;

export interface FlipOptions {
  horizontal?: boolean;
  vertical?: boolean;
}

export interface TransformOptions {
  crop?: CropRect;
  rotate?: Rotation;
  flip?: FlipOptions;
}

export interface ResourceLimits {
  maxInputBytes?: number;
  maxInputPixels?: number;
  maxInputWidth?: number;
  maxInputHeight?: number;
  maxOutputBytes?: number;
  maxOutputPixels?: number;
  maxOutputWidth?: number;
  maxOutputHeight?: number;
  fetchTimeoutMs?: number;
}

export interface LoadOptions {
  decode?: DecodeMode;
  orientation?: OrientationMode;
  limits?: ResourceLimits;
  signal?: AbortSignal;
}
export interface ProcessOptions extends TransformOptions {
  resize?: { width?: number; height?: number; fit?: FitMode };
  background?: string;
  orientation?: OrientationMode;
  limits?: ResourceLimits;
  signal?: AbortSignal;
}
export interface EncodeOptions {
  type?: string;
  quality?: number;
  limits?: ResourceLimits;
  signal?: AbortSignal;
}
export interface ProbeOptions {
  signal?: AbortSignal;
  limits?: ResourceLimits;
}

export interface ImageCapabilities {
  imageDecoder: boolean;
  createImageBitmap: boolean;
  htmlImage: boolean;
  offscreenCanvas: boolean;
  canvasToBlob: boolean;
  decodeFormats?: readonly ImageFormat[];
  encodeFormats?: readonly ImageFormat[];
  canDecode?: (type: string) => boolean;
  canEncode?: (type: string) => boolean;
}

export type ExifValue = string | number;
export interface ImageMetadata {
  width: number;
  height: number;
  mimeType: string;
  size: number;
  orientation: number;
  exif: Readonly<Record<string, ExifValue>>;
  format: ImageFormat;
  animated: boolean;
}
export interface ImageAsset {
  readonly metadata: ImageMetadata;
  dispose(): void;
}
export interface ProcessedImage {
  readonly width: number;
  readonly height: number;
  readonly metadata: ImageMetadata;
  dispose(): void;
}
/** Minimum encoded image shape shared by browser and Node adapters. */
export interface EncodedImageBase {
  readonly type: string;
  readonly width: number;
  readonly height: number;
}
export interface EncodedImage extends EncodedImageBase {
  readonly blob: Blob;
}
export interface ImageProbeResult {
  readonly width: number;
  readonly height: number;
  readonly format: ImageFormat;
  readonly mimeType: string;
  readonly animated: boolean;
}
export interface NexusImageApi {
  load(source: ImageSource, options?: LoadOptions): Promise<ImageAsset>;
  inspect(source: ImageSource, options?: LoadOptions): Promise<ImageMetadata>;
  process(source: ImageSource | ImageAsset, options?: ProcessOptions): Promise<ProcessedImage>;
  encode(image: ProcessedImage, options?: EncodeOptions): Promise<EncodedImage>;
  probe(source: ImageSource, options?: ProbeOptions): Promise<ImageProbeResult>;
  getCapabilities(): ImageCapabilities;
}
