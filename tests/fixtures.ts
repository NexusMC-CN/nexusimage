/** Build a tiny JPEG containing one EXIF APP1/TIFF segment for parser tests. */
export function fixtureWithOrientation6AndDate(): Uint8Array {
  const tiff = new Uint8Array(256);
  const view = new DataView(tiff.buffer);
  let cursor = 0;
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) tiff[offset + i] = value.charCodeAt(i);
    tiff[offset + value.length] = 0;
  };

  // Little-endian TIFF header: II, magic 42, first IFD at byte 8.
  tiff.set([0x49, 0x49], cursor); cursor += 2;
  view.setUint16(cursor, 42, true); cursor += 2;
  view.setUint32(cursor, 8, true);

  const ifdOffset = 8;
  const entries = [
    { tag: 0x010f, type: 2, count: 6, value: 100 }, // Make
    { tag: 0x0110, type: 2, count: 7, value: 106 }, // Model
    { tag: 0x0112, type: 3, count: 1, value: 6 }, // Orientation
    { tag: 0x9003, type: 2, count: 20, value: 113 }, // DateTimeOriginal
    { tag: 0xa002, type: 4, count: 1, value: 1920 }, // PixelXDimension
    { tag: 0xa003, type: 4, count: 1, value: 1080 }, // PixelYDimension
  ];
  view.setUint16(ifdOffset, entries.length, true);
  cursor = ifdOffset + 2;
  for (const entry of entries) {
    view.setUint16(cursor, entry.tag, true);
    view.setUint16(cursor + 2, entry.type, true);
    view.setUint32(cursor + 4, entry.count, true);
    if (entry.type === 3) {
      view.setUint16(cursor + 8, entry.value, true);
      view.setUint16(cursor + 10, 0, true);
    } else if (entry.type === 2 && entry.count <= 4) {
      view.setUint32(cursor + 8, entry.value, true);
    } else if (entry.type === 2) {
      view.setUint32(cursor + 8, entry.value, true);
    } else {
      view.setUint32(cursor + 8, entry.value, true);
    }
    cursor += 12;
  }
  view.setUint32(cursor, 0, true); // no next IFD
  writeAscii(100, 'Canon');
  writeAscii(106, 'EOS R');
  writeAscii(113, '2026:10:04 12:34:56');

  const usedTiffLength = 133;
  const exif = new Uint8Array(6 + usedTiffLength);
  exif.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
  exif.set(tiff.subarray(0, usedTiffLength), 6);
  const appLength = exif.length + 2;
  const jpeg = new Uint8Array(2 + 2 + 2 + exif.length + 2);
  let offset = 0;
  jpeg.set([0xff, 0xd8], offset); offset += 2;
  jpeg.set([0xff, 0xe1], offset); offset += 2;
  jpeg[offset++] = (appLength >>> 8) & 0xff;
  jpeg[offset++] = appLength & 0xff;
  jpeg.set(exif, offset); offset += exif.length;
  jpeg.set([0xff, 0xd9], offset);
  return jpeg;
}

export function fixtureWithBigEndianOrientation8(): Uint8Array {
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  tiff.set([0x4d, 0x4d], 0);
  view.setUint16(2, 42, false);
  view.setUint32(4, 8, false);
  view.setUint16(8, 1, false);
  view.setUint16(10, 0x0112, false);
  view.setUint16(12, 3, false);
  view.setUint32(14, 1, false);
  view.setUint16(18, 8, false);
  view.setUint16(20, 0, false);
  const exif = new Uint8Array(6 + tiff.length);
  exif.set([0x45, 0x78, 0x69, 0x66, 0, 0]);
  exif.set(tiff, 6);
  const jpeg = new Uint8Array(2 + 2 + 2 + exif.length + 2);
  jpeg.set([0xff, 0xd8, 0xff, 0xe1, (exif.length + 2) >>> 8, (exif.length + 2) & 0xff, ...exif, 0xff, 0xd9]);
  return jpeg;
}
