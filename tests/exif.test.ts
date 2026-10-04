import { expect, it } from 'vitest';
import { parseExif, stripExifOrientation } from '../src/exif/parser';
import { fixtureWithBigEndianOrientation8, fixtureWithOrientation6AndDate } from './fixtures';

function fixtureWithGpsAndLens(): Uint8Array {
  const tiff = new Uint8Array(360);
  const view = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49], 0);
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) tiff[offset + i] = value.charCodeAt(i);
    tiff[offset + value.length] = 0;
  };
  const entry = (offset: number, tag: number, type: number, count: number, value: number) => {
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    if (type === 3 && count === 1) view.setUint16(offset + 8, value, true);
    else view.setUint32(offset + 8, value, true);
  };
  view.setUint16(8, 4, true);
  entry(10, 0x0112, 3, 1, 6);
  entry(22, 0x0132, 2, 20, 220);
  entry(34, 0x8769, 4, 1, 64);
  entry(46, 0x8825, 4, 1, 140);
  view.setUint32(58, 0, true);

  view.setUint16(64, 4, true);
  entry(66, 0xa433, 2, 6, 240);
  entry(78, 0xa434, 2, 9, 246);
  entry(90, 0x829d, 5, 1, 256);
  entry(102, 0x920a, 5, 1, 264);
  view.setUint32(114, 0, true);

  view.setUint16(140, 5, true);
  entry(142, 0x0001, 2, 5, 280);
  entry(154, 0x0002, 5, 3, 290);
  entry(166, 0x0003, 2, 5, 282);
  entry(178, 0x0004, 5, 3, 314);
  entry(190, 0x0006, 5, 1, 338);
  view.setUint32(202, 0, true);

  ascii(220, '2026:10:04 12:34:56');
  ascii(240, 'Acme');
  ascii(246, 'Lens X');
  ascii(280, 'N');
  ascii(282, 'W');
  const rational = (offset: number, numerator: number, denominator: number) => {
    view.setUint32(offset, numerator, true);
    view.setUint32(offset + 4, denominator, true);
  };
  rational(290, 25, 1); rational(298, 30, 1); rational(306, 0, 1);
  rational(314, 121, 1); rational(322, 28, 1); rational(330, 0, 1);
  rational(338, 100, 1);
  rational(256, 2, 1);
  rational(264, 50, 1);

  const payload = new Uint8Array(6 + tiff.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
  payload.set(tiff, 6);
  const jpeg = new Uint8Array(2 + 2 + 2 + payload.length + 2);
  jpeg.set([0xff, 0xd8, 0xff, 0xe1, (payload.length + 2) >>> 8, (payload.length + 2) & 0xff, ...payload, 0xff, 0xd9]);
  return jpeg;
}

it('reads little-endian EXIF orientation and common fields', () => {
  expect(parseExif(fixtureWithOrientation6AndDate())).toMatchObject({
    orientation: 6,
    exif: {
      Make: 'Canon',
      Model: 'EOS R',
      DateTimeOriginal: '2026:10:04 12:34:56',
      PixelXDimension: 1920,
      PixelYDimension: 1080,
    },
  });
});

it('reads big-endian TIFF orientation', () => {
  expect(parseExif(fixtureWithBigEndianOrientation8())).toMatchObject({ orientation: 8 });
});

it('reads camera, lens and GPS fields from nested IFDs', () => {
  expect(parseExif(fixtureWithGpsAndLens())).toMatchObject({
    orientation: 6,
    exif: {
      DateTime: '2026:10:04 12:34:56',
      LensMake: 'Acme',
      LensModel: 'Lens X',
      FNumber: 2,
      FocalLength: 50,
      GPSLatitudeRef: 'N',
      GPSLatitude: 25.5,
      GPSLongitudeRef: 'W',
      GPSLongitude: -(121 + 28 / 60),
      GPSAltitude: 100,
    },
  });
});

it('skips JPEG fill bytes before an APP1 marker', () => {
  const original = fixtureWithOrientation6AndDate();
  const padded = new Uint8Array(original.length + 1);
  padded.set(original.subarray(0, 2), 0);
  padded[2] = 0xff;
  padded.set(original.subarray(2), 3);
  expect(parseExif(padded).orientation).toBe(6);
});

it('returns orientation 1 for non-JPEG or missing EXIF', () => {
  expect(parseExif(new Uint8Array([0, 1, 2]))).toMatchObject({ orientation: 1, exif: {} });
  expect(parseExif(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toMatchObject({ orientation: 1, exif: {} });
});

it('keeps default metadata and reports malformed EXIF diagnostics', () => {
  const bytes = fixtureWithOrientation6AndDate();
  bytes.set([0xff, 0xff, 0xff, 0xff], 16); // TIFF IFD offset points outside APP1.
  const result = parseExif(bytes);
  expect(result.orientation).toBe(1);
  expect(result.diagnostics?.some((item) => item.code === 'EXIF_FAILED')).toBe(true);
});

it('neutralizes orientation on a copy without losing other EXIF fields', () => {
  const original = fixtureWithOrientation6AndDate();
  const changed = stripExifOrientation(original);
  expect(changed).not.toBe(original);
  expect(parseExif(original).orientation).toBe(6);
  expect(parseExif(changed)).toMatchObject({ orientation: 1, exif: { Make: 'Canon', DateTimeOriginal: '2026:10:04 12:34:56' } });
  expect(Array.from(changed).filter((byte, i) => byte !== original[i])).toEqual([1]);
});

it('does not follow pointers beyond the APP1 segment', () => {
  const original = fixtureWithOrientation6AndDate();
  const padded = new Uint8Array(original.length + 300);
  padded.set(original);
  new DataView(padded.buffer).setUint32(16, 200, true);
  expect(parseExif(padded)).toMatchObject({ orientation: 1, exif: {}, diagnostics: [{ code: 'EXIF_FAILED' }] });
});
