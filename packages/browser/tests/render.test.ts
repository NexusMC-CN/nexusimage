import { expect, it } from 'vitest';
import {
  calculateFitRect,
  createTransformPlan,
  getOrientedDimensions,
  getOrientationMatrix,
  getTransformMatrix,
  getTransformedDimensions,
  normalizeCropRect,
} from '../src/render/transform';

it('calculates contain, cover and fill rectangles', () => {
  expect(calculateFitRect({ width: 400, height: 200 }, { width: 300, height: 300 }, 'contain')).toEqual({
    x: 0,
    y: 75,
    width: 300,
    height: 150,
  });
  expect(calculateFitRect({ width: 400, height: 200 }, { width: 300, height: 300 }, 'cover')).toEqual({
    x: -150,
    y: 0,
    width: 600,
    height: 300,
  });
  expect(calculateFitRect({ width: 400, height: 200 }, { width: 300, height: 300 }, 'fill')).toEqual({
    x: 0,
    y: 0,
    width: 300,
    height: 300,
  });
});

it('swaps dimensions for orientations 5 through 8', () => {
  expect(getOrientedDimensions(640, 480, 1)).toEqual({ width: 640, height: 480 });
  expect(getOrientedDimensions(640, 480, 4)).toEqual({ width: 640, height: 480 });
  expect(getOrientedDimensions(640, 480, 6)).toEqual({ width: 480, height: 640 });
  expect(getOrientedDimensions(640, 480, 8)).toEqual({ width: 480, height: 640 });
});

it('returns a pure affine matrix for EXIF orientation', () => {
  expect(getOrientationMatrix(100, 50, 6)).toEqual([0, 1, -1, 0, 50, 0]);
  expect(getOrientationMatrix(100, 50, 1)).toEqual([1, 0, 0, 1, 0, 0]);
});

it('validates and normalizes crop rectangles', () => {
  expect(normalizeCropRect({ width: 100, height: 80 })).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  expect(normalizeCropRect({ width: 100, height: 80 }, { x: 10, y: 20, width: 40, height: 30 })).toEqual({
    x: 10,
    y: 20,
    width: 40,
    height: 30,
  });
  expect(() => normalizeCropRect({ width: 100, height: 80 }, { x: 80, y: 0, width: 30, height: 10 })).toThrow(
    RangeError,
  );
  expect(() => normalizeCropRect({ width: 100, height: 80 }, { x: 0, y: 0, width: 0, height: 10 })).toThrow(RangeError);
});

it('calculates crop and quarter-turn output dimensions', () => {
  const source = { width: 100, height: 80 };
  expect(getTransformedDimensions(source, { crop: { x: 10, y: 20, width: 40, height: 30 } })).toEqual({
    width: 40,
    height: 30,
  });
  expect(getTransformedDimensions(source, { crop: { x: 10, y: 20, width: 40, height: 30 }, rotate: 90 })).toEqual({
    width: 30,
    height: 40,
  });
  const diagonal = getTransformedDimensions(source, { rotate: 45 });
  expect(diagonal.width).toBeCloseTo(127.27922061357854, 12);
  expect(diagonal.height).toBeCloseTo(127.27922061357854, 12);
});

it('maps crop, rotation, and flips into one canvas matrix', () => {
  expect(
    getTransformMatrix(
      { width: 100, height: 80 },
      {
        crop: { x: 10, y: 20, width: 40, height: 30 },
        rotate: 90,
      },
    ),
  ).toEqual([0, 1, -1, 0, 50, -10]);
  expect(getTransformMatrix({ width: 10, height: 8 }, { flip: { horizontal: true } })).toEqual([-1, 0, 0, 1, 10, 0]);
  expect(createTransformPlan({ width: 10, height: 8 }, { rotate: 180, flip: { vertical: true } })).toEqual({
    source: { x: 0, y: 0, width: 10, height: 8 },
    output: { width: 10, height: 8 },
    matrix: [-1, 0, 0, 1, 10, 0],
  });
});
