import { NexusImageError } from '../errors';
import type { ImageCapabilities } from '../types';

export interface CanvasSurface {
  readonly canvas: {
    width: number;
    height: number;
    getContext(type: '2d'): CanvasContext | null;
    toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void;
    convertToBlob?: (options?: { type?: string; quality?: number }) => Promise<Blob>;
  };
  readonly context: CanvasContext;
  readonly width: number;
  readonly height: number;
  dispose(): void;
}

export type CanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function createSurface(
  dimensions: { width: number; height: number },
  capabilities: Pick<ImageCapabilities, 'offscreenCanvas'>,
): CanvasSurface {
  if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new NexusImageError('RENDER_FAILED', 'render', 'Canvas dimensions must be positive finite numbers.');
  }
  const globals = globalThis as typeof globalThis & {
    OffscreenCanvas?: new (width: number, height: number) => CanvasSurface['canvas'];
    document?: { createElement(name: 'canvas'): CanvasSurface['canvas'] };
  };
  let canvas: CanvasSurface['canvas'] | undefined;
  if (capabilities.offscreenCanvas && globals.OffscreenCanvas) {
    try { canvas = new globals.OffscreenCanvas(dimensions.width, dimensions.height); } catch { canvas = undefined; }
  }
  let context: CanvasContext | null = null;
  if (canvas) {
    try { context = canvas.getContext('2d'); } catch { context = null; }
  }
  if (!context && globals.document) {
    try {
      canvas = globals.document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      context = canvas.getContext('2d');
    } catch { context = null; }
  }
  if (!canvas) throw new NexusImageError('UNSUPPORTED', 'render', 'No canvas implementation is available.');
  if (!context) throw new NexusImageError('RENDER_FAILED', 'render', 'A 2D canvas context is unavailable.');
  let disposed = false;
  return {
    canvas, context, width: dimensions.width, height: dimensions.height,
    dispose() { if (!disposed) { disposed = true; canvas!.width = 0; canvas!.height = 0; } },
  };
}
