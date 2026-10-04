import type { NormalizedSource } from '../source';

export interface DrawTarget {
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
}

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly name: string;
  draw(target: DrawTarget, dx: number, dy: number, dw: number, dh: number): void;
  dispose(): void;
}

export interface DecodeAdapter {
  readonly name: string;
  decode(source: NormalizedSource, signal?: AbortSignal): Promise<DecodedImage>;
}
