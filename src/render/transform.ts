export type FitMode = 'contain' | 'cover' | 'fill';
export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type AffineMatrix = [a: number, b: number, c: number, d: number, e: number, f: number];

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlipOptions {
  horizontal?: boolean;
  vertical?: boolean;
}

export interface TransformOptions {
  crop?: CropRect;
  /** Clockwise degrees in the canvas coordinate system. */
  rotate?: number;
  flip?: FlipOptions;
}

export interface TransformPlan {
  source: Rect;
  output: Size;
  matrix: AffineMatrix;
}

function assertSize(size: Size): void {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    throw new RangeError('Image dimensions must be positive finite numbers.');
  }
}

function snap(value: number): number {
  if (Math.abs(value) < 1e-12) return 0;
  if (Math.abs(value - 1) < 1e-12) return 1;
  if (Math.abs(value + 1) < 1e-12) return -1;
  return value;
}

/** Validate and normalize a crop rectangle against source dimensions. */
export function normalizeCropRect(source: Size, crop?: CropRect): CropRect {
  assertSize(source);
  if (crop === undefined) return { x: 0, y: 0, width: source.width, height: source.height };
  const values = [crop.x, crop.y, crop.width, crop.height];
  if (values.some((value) => !Number.isFinite(value))) throw new RangeError('Crop values must be finite numbers.');
  if (crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0) {
    throw new RangeError('Crop coordinates must be non-negative and dimensions must be positive.');
  }
  if (crop.x + crop.width > source.width || crop.y + crop.height > source.height) {
    throw new RangeError('Crop rectangle must be contained within the source image.');
  }
  return { ...crop };
}

function calculateTransform(source: Size, options: TransformOptions = {}): TransformPlan {
  assertSize(source);
  const crop = normalizeCropRect(source, options.crop);
  const degrees = options.rotate ?? 0;
  if (!Number.isFinite(degrees)) throw new RangeError('Rotation must be a finite number.');
  const radians = degrees * Math.PI / 180;
  const cos = snap(Math.cos(radians));
  const sin = snap(Math.sin(radians));
  const corners: readonly [number, number][] = [[0, 0], [crop.width, 0], [0, crop.height], [crop.width, crop.height]];
  const rotated = corners.map(([x, y]) => [cos * x - sin * y, sin * x + cos * y] as const);
  const minX = Math.min(...rotated.map(([x]) => x));
  const maxX = Math.max(...rotated.map(([x]) => x));
  const minY = Math.min(...rotated.map(([, y]) => y));
  const maxY = Math.max(...rotated.map(([, y]) => y));
  const output = { width: snap(maxX - minX), height: snap(maxY - minY) };
  const baseA = cos;
  const baseC = -sin;
  const baseE = -cos * crop.x + sin * crop.y - minX;
  const baseB = sin;
  const baseD = cos;
  const baseF = -sin * crop.x - cos * crop.y - minY;
  const horizontal = options.flip?.horizontal === true;
  const vertical = options.flip?.vertical === true;
  const matrix: AffineMatrix = [
    horizontal ? -baseA : baseA,
    vertical ? -baseB : baseB,
    horizontal ? -baseC : baseC,
    vertical ? -baseD : baseD,
    horizontal ? output.width - baseE : baseE,
    vertical ? output.height - baseF : baseF,
  ].map(snap) as AffineMatrix;
  return { source: crop, output, matrix };
}

/** Return the output dimensions after crop, rotate, and flip. */
export function getTransformedDimensions(source: Size, options: TransformOptions = {}): Size {
  return calculateTransform(source, options).output;
}

/** Return a canvas affine matrix mapping source pixels into transformed output space. */
export function getTransformMatrix(source: Size, options: TransformOptions = {}): AffineMatrix {
  return calculateTransform(source, options).matrix;
}

/** Return the complete source crop, output size, and drawing matrix. */
export function createTransformPlan(source: Size, options: TransformOptions = {}): TransformPlan {
  return calculateTransform(source, options);
}

export function calculateFitRect(source: Size, target: Size, fit: FitMode = 'contain'): Rect {
  if (fit === 'fill') return { x: 0, y: 0, width: target.width, height: target.height };
  const ratio = fit === 'cover'
    ? Math.max(target.width / source.width, target.height / source.height)
    : Math.min(target.width / source.width, target.height / source.height);
  const width = source.width * ratio;
  const height = source.height * ratio;
  return { x: (target.width - width) / 2, y: (target.height - height) / 2, width, height };
}

export function getOrientedDimensions(width: number, height: number, orientation: number): Size {
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

export function getOrientationMatrix(width: number, height: number, orientation: number): AffineMatrix {
  switch (orientation) {
    case 2: return [-1, 0, 0, 1, width, 0];
    case 3: return [-1, 0, 0, -1, width, height];
    case 4: return [1, 0, 0, -1, 0, height];
    case 5: return [0, 1, 1, 0, 0, 0];
    case 6: return [0, 1, -1, 0, height, 0];
    case 7: return [0, -1, -1, 0, height, width];
    case 8: return [0, -1, 1, 0, 0, width];
    default: return [1, 0, 0, 1, 0, 0];
  }
}

// Internal aliases useful to render adapters.
export const fitRect = calculateFitRect;
export const orientationDimensions = getOrientedDimensions;
export const orientationMatrix = getOrientationMatrix;
