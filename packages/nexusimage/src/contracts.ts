/**
 * Runtime-neutral contracts for adapters such as the Node implementation.
 * This entrypoint intentionally excludes Canvas, DOM, and browser decoders.
 */
export * from './types.js';
export * from './errors.js';
export * from './format.js';
export * from './limits.js';
export { parseExif, stripExifOrientation } from './exif/parser.js';
export type { ExifDiagnostic, ExifResult } from './exif/parser.js';
export * from './exif/tags.js';
