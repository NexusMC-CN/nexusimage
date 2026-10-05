import { formatFromMimeType, formatMimeType, type ImageFormat, supportedImageFormats } from './format';
import type { DecodeMode, ImageCapabilities } from './types';

type BrowserGlobal = typeof globalThis & {
  ImageDecoder?: {
    new (...args: unknown[]): unknown;
    isTypeSupported?: (type: string) => boolean | Promise<boolean>;
  };
  createImageBitmap?: unknown;
  Image?: unknown;
  OffscreenCanvas?: {
    new (width: number, height: number): ProbeCanvas;
    prototype?: { convertToBlob?: (options?: { type?: string; quality?: number }) => Promise<Blob> };
  };
  HTMLCanvasElement?: { new (...args: unknown[]): ProbeCanvas; prototype?: { toBlob?: ProbeCanvas['toBlob'] } };
  document?: { createElement?: (name: 'canvas') => ProbeCanvas };
};

interface ProbeCanvas {
  toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
  convertToBlob?: (options?: { type?: string; quality?: number }) => Promise<Blob>;
}

const CONSERVATIVE_DECODE_FORMATS: readonly ImageFormat[] = Object.freeze(['jpeg', 'png']);
const CONSERVATIVE_ENCODE_FORMATS: readonly ImageFormat[] = Object.freeze(['png']);
const ENCODE_PROBE_FORMATS: readonly ImageFormat[] = Object.freeze(['png', 'jpeg', 'webp']);

export interface CapabilityProbeOptions {
  /** Maximum time to wait for a canvas toBlob callback. */
  timeoutMs?: number;
  /** Skip the per-runtime probe cache. Primarily useful for isolated tests. */
  cache?: boolean;
}

let cachedProbe: Promise<ImageCapabilities> | undefined;

function createCapabilityQueries(
  decodeFormats: readonly ImageFormat[],
  encodeFormats: readonly ImageFormat[],
): Pick<ImageCapabilities, 'decodeFormats' | 'encodeFormats' | 'canDecode' | 'canEncode'> {
  return {
    decodeFormats,
    encodeFormats,
    canDecode: (type: string) => decodeFormats.includes(formatFromMimeType(type)),
    canEncode: (type: string) => encodeFormats.includes(formatFromMimeType(type)),
  };
}

export function getCapabilities(): ImageCapabilities {
  const globals = globalThis as BrowserGlobal;
  const htmlImage = typeof globals.Image === 'function';
  const canvasToBlob = typeof globals.HTMLCanvasElement?.prototype?.toBlob === 'function';
  const imageDecoder = typeof globals.ImageDecoder === 'function';
  const createImageBitmap = typeof globals.createImageBitmap === 'function';
  const offscreenCanvas = typeof globals.OffscreenCanvas === 'function';
  const hasCanvasEncoder = canvasToBlob || typeof globals.OffscreenCanvas?.prototype?.convertToBlob === 'function';
  const decodeFormats = imageDecoder || createImageBitmap || htmlImage ? CONSERVATIVE_DECODE_FORMATS : [];
  const encodeFormats = hasCanvasEncoder ? CONSERVATIVE_ENCODE_FORMATS : [];
  return {
    imageDecoder,
    createImageBitmap,
    htmlImage,
    offscreenCanvas,
    canvasToBlob: hasCanvasEncoder,
    ...createCapabilityQueries(decodeFormats, encodeFormats),
  };
}

function resolveProbeCanvas(globals: BrowserGlobal): ProbeCanvas | undefined {
  if (
    typeof globals.OffscreenCanvas === 'function' &&
    typeof globals.OffscreenCanvas.prototype?.convertToBlob === 'function'
  ) {
    try {
      return new globals.OffscreenCanvas(1, 1);
    } catch {
      /* fall through to HTML canvas */
    }
  }
  if (typeof globals.document?.createElement === 'function') {
    try {
      return globals.document.createElement('canvas');
    } catch {
      /* fall through */
    }
  }
  // A prototype-only test double is also useful in non-DOM runtimes. Real
  // browsers normally take the document path above.
  const prototypeToBlob = globals.HTMLCanvasElement?.prototype?.toBlob as unknown;
  if (typeof prototypeToBlob === 'function') return Object.create(globals.HTMLCanvasElement.prototype) as ProbeCanvas;
  return undefined;
}

async function probeCanvasMimeType(canvas: ProbeCanvas, type: string, timeoutMs: number): Promise<boolean> {
  const expected = formatMimeType(formatFromMimeType(type));
  if (typeof canvas.convertToBlob === 'function') {
    try {
      const blob = await canvas.convertToBlob({ type });
      return blob.type.trim().toLowerCase() === expected;
    } catch {
      return false;
    }
  }
  const toBlob = canvas.toBlob;
  if (typeof toBlob !== 'function') return false;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    try {
      toBlob.call(canvas, (blob) => finish(Boolean(blob && blob.type.trim().toLowerCase() === expected)), type);
    } catch {
      finish(false);
    }
  });
}

async function probeDecodeFormats(globals: BrowserGlobal): Promise<readonly ImageFormat[]> {
  const isTypeSupported = globals.ImageDecoder?.isTypeSupported;
  if (typeof isTypeSupported !== 'function') {
    return globals.ImageDecoder ||
      typeof globals.createImageBitmap === 'function' ||
      typeof globals.Image === 'function'
      ? CONSERVATIVE_DECODE_FORMATS
      : [];
  }
  const supported: ImageFormat[] = [];
  for (const format of supportedImageFormats) {
    try {
      if (await isTypeSupported.call(globals.ImageDecoder, formatMimeType(format))) supported.push(format);
    } catch {
      // A rejected/throwing decoder probe is treated as unsupported.
    }
  }
  return supported;
}

/**
 * Probes actual runtime codec support and caches the result for this runtime.
 * The synchronous getCapabilities() call intentionally reports only a lower
 * bound because browser codec support is not synchronously introspectable.
 */
export async function probeCapabilities(options: CapabilityProbeOptions = {}): Promise<ImageCapabilities> {
  if (options.cache !== false && cachedProbe) return cachedProbe;
  const timeoutMs = options.timeoutMs ?? 1000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive finite number.');
  const globals = globalThis as BrowserGlobal;
  const baseline = getCapabilities();
  const task = (async () => {
    const decodeFormats = await probeDecodeFormats(globals);
    const canvas = resolveProbeCanvas(globals);
    const encodeFormats: ImageFormat[] = [];
    if (canvas) {
      for (const format of ENCODE_PROBE_FORMATS) {
        if (await probeCanvasMimeType(canvas, formatMimeType(format), timeoutMs)) encodeFormats.push(format);
      }
    }
    return {
      ...baseline,
      ...createCapabilityQueries(decodeFormats, encodeFormats),
    };
  })();
  if (options.cache !== false) cachedProbe = task;
  return task;
}

/** Returns whether the current browser exposes a decoder path for a MIME type. */
export function canDecode(type: string, capabilities = getCapabilities()): boolean {
  return capabilities.canDecode?.(type) ?? capabilities.decodeFormats?.includes(formatFromMimeType(type)) ?? false;
}

/** Returns whether the current browser exposes a canvas encoder for a MIME type. */
export function canEncode(type: string, capabilities = getCapabilities()): boolean {
  return capabilities.canEncode?.(type) ?? capabilities.encodeFormats?.includes(formatFromMimeType(type)) ?? false;
}

export function availableModes(capabilities: ImageCapabilities, mode: DecodeMode): DecodeMode[] {
  if (mode !== 'auto') {
    const supported =
      mode === 'image-decoder'
        ? capabilities.imageDecoder
        : mode === 'create-image-bitmap'
          ? capabilities.createImageBitmap
          : capabilities.htmlImage;
    return supported ? [mode] : [];
  }
  const modes: DecodeMode[] = [];
  if (capabilities.imageDecoder) modes.push('image-decoder');
  if (capabilities.createImageBitmap) modes.push('create-image-bitmap');
  if (capabilities.htmlImage) modes.push('html-image');
  return modes;
}
