import { EXIF_TAGS, EXIF_TAG_NAMES } from './tags';

export type ExifValue = string | number;
export interface ExifDiagnostic {
  code: 'EXIF_FAILED';
  message: string;
}
export interface ExifResult {
  orientation: number;
  exif: Readonly<Record<string, ExifValue>>;
  diagnostics?: readonly ExifDiagnostic[];
}

type Endian = 'little' | 'big';
type TiffReader = {
  bytes: Uint8Array;
  view: DataView;
  endian: Endian;
  u16(offset: number): number;
  u32(offset: number): number;
};

interface GpsValues {
  latitude?: number[];
  longitude?: number[];
  timeStamp?: number[];
}

interface IfdPointers {
  exif?: number;
  gps?: number;
}

const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

function readerFor(bytes: Uint8Array, start: number): TiffReader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = bytes[start] === 0x49 && bytes[start + 1] === 0x49;
  const endian: Endian = little ? 'little' : 'big';
  return {
    bytes,
    view,
    endian,
    u16: (offset) => view.getUint16(start + offset, little),
    u32: (offset) => view.getUint32(start + offset, little),
  };
}

function rangeIsValid(bytes: Uint8Array, offset: number, size: number): boolean {
  return offset >= 0 && size >= 0 && offset <= bytes.byteLength && size <= bytes.byteLength - offset;
}

function readValue(reader: TiffReader, entry: number, type: number, count: number): ExifValue | undefined {
  const unit = typeSize[type];
  if (!unit || count < 1 || count > 0x100000) return undefined;
  const byteLength = unit * count;
  const valueOffset = byteLength <= 4 ? entry + 8 : reader.u32(entry + 8);
  if (!rangeIsValid(reader.bytes, valueOffset, byteLength)) return undefined;
  const { bytes, view, endian } = reader;
  const little = endian === 'little';
  if (type === 2) {
    const end = valueOffset + byteLength;
    let result = '';
    for (let i = valueOffset; i < end; i += 1) {
      const byte = bytes[i];
      if (byte === undefined || byte === 0) break;
      result += String.fromCharCode(byte);
    }
    return result;
  }
  if (type === 7) {
    const end = valueOffset + byteLength;
    let result = '';
    for (let i = valueOffset; i < end; i += 1) {
      const byte = bytes[i];
      if (byte === undefined || byte === 0) break;
      result += String.fromCharCode(byte);
    }
    return result;
  }
  if (type === 3) return view.getUint16(valueOffset, little);
  if (type === 4) return view.getUint32(valueOffset, little);
  if (type === 1) return bytes[valueOffset];
  if (type === 5) {
    const numerator = view.getUint32(valueOffset, little);
    const denominator = view.getUint32(valueOffset + 4, little);
    return denominator === 0 ? undefined : numerator / denominator;
  }
  return undefined;
}

function readRationalValues(reader: TiffReader, entry: number, type: number, count: number): number[] | undefined {
  if (type !== 5 || count < 1 || count > 0x100000) return undefined;
  const byteLength = count * 8;
  const valueOffset = byteLength <= 4 ? entry + 8 : reader.u32(entry + 8);
  if (!rangeIsValid(reader.bytes, valueOffset, byteLength)) return undefined;
  const little = reader.endian === 'little';
  const values: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const offset = valueOffset + i * 8;
    const numerator = reader.view.getUint32(offset, little);
    const denominator = reader.view.getUint32(offset + 4, little);
    if (denominator === 0) return undefined;
    values.push(numerator / denominator);
  }
  return values;
}

function readByteValues(reader: TiffReader, entry: number, type: number, count: number): number[] | undefined {
  if (type !== 1 || count < 1 || count > 0x100000) return undefined;
  const valueOffset = count <= 4 ? entry + 8 : reader.u32(entry + 8);
  if (!rangeIsValid(reader.bytes, valueOffset, count)) return undefined;
  return Array.from(reader.bytes.subarray(valueOffset, valueOffset + count));
}

function readIfd(
  reader: TiffReader,
  ifdOffset: number,
  output: Record<string, ExifValue>,
  visited: Set<number>,
  gps: GpsValues,
): IfdPointers {
  if (visited.has(ifdOffset)) return {};
  visited.add(ifdOffset);
  if (!rangeIsValid(reader.bytes, ifdOffset, 2)) throw new Error('TIFF IFD is outside APP1');
  const count = reader.u16(ifdOffset);
  const entriesEnd = ifdOffset + 2 + count * 12;
  if (!rangeIsValid(reader.bytes, ifdOffset, 2 + count * 12 + 4)) throw new Error('TIFF IFD is truncated');
  const pointers: IfdPointers = {};
  for (let i = 0; i < count; i += 1) {
    const entry = ifdOffset + 2 + i * 12;
    const tag = reader.u16(entry);
    const type = reader.u16(entry + 2);
    const itemCount = reader.u32(entry + 4);
    if (tag === EXIF_TAGS.GPSLatitude || tag === EXIF_TAGS.GPSLongitude || tag === EXIF_TAGS.GPSTimeStamp) {
      const values = readRationalValues(reader, entry, type, itemCount);
      if (values === undefined) throw new Error(`Invalid EXIF field 0x${tag.toString(16)}`);
      if (tag === EXIF_TAGS.GPSLatitude) gps.latitude = values;
      else if (tag === EXIF_TAGS.GPSLongitude) gps.longitude = values;
      else gps.timeStamp = values;
      continue;
    }
    if (tag === EXIF_TAGS.GPSVersionID) {
      const version = readByteValues(reader, entry, type, itemCount);
      if (version === undefined) throw new Error(`Invalid EXIF field 0x${tag.toString(16)}`);
      output.GPSVersionID = version.join('.');
      continue;
    }
    const value = readValue(reader, entry, type, itemCount);
    if (value === undefined && (EXIF_TAG_NAMES[tag] !== undefined || tag === EXIF_TAGS.ExifIFDPointer)) {
      throw new Error(`Invalid EXIF field 0x${tag.toString(16)}`);
    }
    if (tag === EXIF_TAGS.ExifIFDPointer && typeof value === 'number') pointers.exif = value;
    if (tag === EXIF_TAGS.GPSInfoIFDPointer && typeof value === 'number') pointers.gps = value;
    const name = EXIF_TAG_NAMES[tag];
    if (name && name !== 'ExifIFDPointer' && name !== 'GPSInfoIFDPointer' && value !== undefined) output[name] = value;
  }
  return pointers;
}

function coordinate(values: number[] | undefined, ref: ExifValue | undefined): number | undefined {
  if (!values || values.length < 3 || values.some((value) => !Number.isFinite(value))) return undefined;
  const decimal = values[0]! + values[1]! / 60 + values[2]! / 3600;
  const direction = typeof ref === 'string' ? ref.trim().toUpperCase() : '';
  return direction === 'S' || direction === 'W' ? -decimal : decimal;
}

function finalizeGps(output: Record<string, ExifValue>, gps: GpsValues): void {
  const latitude = coordinate(gps.latitude, output.GPSLatitudeRef);
  const longitude = coordinate(gps.longitude, output.GPSLongitudeRef);
  if (latitude !== undefined) output.GPSLatitude = latitude;
  if (longitude !== undefined) output.GPSLongitude = longitude;
  if (typeof output.GPSAltitude === 'number' && output.GPSAltitudeRef === 1) {
    output.GPSAltitude = -Math.abs(output.GPSAltitude);
  }
  if (gps.timeStamp && gps.timeStamp.length >= 3) {
    const [hours, minutes, seconds] = gps.timeStamp;
    output.GPSTimeStamp = `${Math.trunc(hours!)}:${String(Math.trunc(minutes!)).padStart(2, '0')}:${String(Math.trunc(seconds!)).padStart(2, '0')}`;
  }
}

function parseTiff(bytes: Uint8Array, tiffStart: number, tiffEnd = bytes.length): Record<string, ExifValue> {
  const tiff = bytes.subarray(tiffStart, tiffEnd);
  if (!rangeIsValid(tiff, 0, 8)) throw new Error('TIFF header is truncated');
  const header = tiff[0] === 0x49 && tiff[1] === 0x49;
  const bigHeader = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!header && !bigHeader) throw new Error('Unsupported TIFF byte order');
  const reader = readerFor(tiff, 0);
  if (reader.u16(2) !== 42) throw new Error('Invalid TIFF magic');
  const firstIfd = reader.u32(4);
  if (!rangeIsValid(tiff, firstIfd, 2)) throw new Error('TIFF IFD is outside APP1');
  const output: Record<string, ExifValue> = {};
  const gps: GpsValues = {};
  const visited = new Set<number>();
  const pointers = readIfd(reader, firstIfd, output, visited, gps);
  if (pointers.exif !== undefined) {
    const exifPointers = readIfd(reader, pointers.exif, output, visited, gps);
    if (exifPointers.gps !== undefined && pointers.gps === undefined) pointers.gps = exifPointers.gps;
  }
  if (pointers.gps !== undefined) readIfd(reader, pointers.gps, output, visited, gps);
  finalizeGps(output, gps);
  return output;
}

function findOrientationEntry(reader: TiffReader, ifdOffset: number, visited: Set<number>): number | undefined {
  if (visited.has(ifdOffset)) return undefined;
  visited.add(ifdOffset);
  if (!rangeIsValid(reader.bytes, ifdOffset, 2)) return undefined;
  const count = reader.u16(ifdOffset);
  if (!rangeIsValid(reader.bytes, ifdOffset, 2 + count * 12 + 4)) return undefined;
  let exifIfd: number | undefined;
  for (let i = 0; i < count; i += 1) {
    const entry = ifdOffset + 2 + i * 12;
    const tag = reader.u16(entry);
    const type = reader.u16(entry + 2);
    const itemCount = reader.u32(entry + 4);
    if (tag === EXIF_TAGS.Orientation && type === 3 && itemCount >= 1) return entry;
    const pointer = readValue(reader, entry, type, itemCount);
    if (tag === EXIF_TAGS.ExifIFDPointer && typeof pointer === 'number') exifIfd = pointer;
  }
  return exifIfd === undefined ? undefined : findOrientationEntry(reader, exifIfd, visited);
}

function asBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

/** Parse EXIF metadata from JPEG APP1 bytes. Unsupported input returns defaults. */
export function parseExif(input: Uint8Array | ArrayBuffer): ExifResult {
  const bytes = asBytes(input);
  const empty = { orientation: 1, exif: {} as Readonly<Record<string, ExifValue>> };
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return empty;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    let markerOffset = offset;
    while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset += 1;
    if (markerOffset >= bytes.length) break;
    const marker = bytes[markerOffset];
    if (marker === undefined || marker === 0x00) break;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset = markerOffset + 1; continue; }
    const high = bytes[markerOffset + 1];
    const low = bytes[markerOffset + 2];
    if (high === undefined || low === undefined) break;
    const length = (high << 8) | low;
    const exifPrefix = marker === 0xe1 && bytes.length >= markerOffset + 9 && bytes.subarray(markerOffset + 3, markerOffset + 9).every((v, i) => v === [0x45, 0x78, 0x69, 0x66, 0, 0][i]);
    if (length < 2 || !rangeIsValid(bytes, markerOffset + 1, length)) {
      return exifPrefix ? { ...empty, diagnostics: [{ code: 'EXIF_FAILED', message: 'EXIF APP1 segment is truncated' }] } : empty;
    }
    if (marker === 0xe1 && length >= 8 && bytes.subarray(markerOffset + 3, markerOffset + 9).every((v, i) => v === [0x45, 0x78, 0x69, 0x66, 0, 0][i])) {
      try {
        const exif = parseTiff(bytes, markerOffset + 9, markerOffset + 1 + length);
        const rawOrientation = exif.Orientation;
        const orientation = typeof rawOrientation === 'number' && rawOrientation >= 1 && rawOrientation <= 8
          ? rawOrientation : 1;
        return { orientation, exif };
      } catch (error) {
        return { ...empty, diagnostics: [{ code: 'EXIF_FAILED', message: error instanceof Error ? error.message : 'Invalid EXIF data' }] };
      }
    }
    offset = markerOffset + 1 + length;
  }
  return empty;
}

/** Copy JPEG bytes and normalize a valid EXIF orientation tag to 1 in place. */
export function stripExifOrientation(input: Uint8Array): Uint8Array {
  const output = new Uint8Array(input);
  if (output.length < 2 || output[0] !== 0xff || output[1] !== 0xd8) return output;
  let offset = 2;
  while (offset + 4 <= output.length) {
    if (output[offset] !== 0xff) break;
    let markerOffset = offset;
    while (markerOffset < output.length && output[markerOffset] === 0xff) markerOffset += 1;
    if (markerOffset >= output.length) break;
    const marker = output[markerOffset];
    if (marker === undefined || marker === 0x00) break;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset = markerOffset + 1; continue; }
    const high = output[markerOffset + 1];
    const low = output[markerOffset + 2];
    if (high === undefined || low === undefined) break;
    const length = (high << 8) | low;
    if (length < 2 || !rangeIsValid(output, markerOffset + 1, length)) break;
    const isExif = marker === 0xe1 && length >= 8 && output.subarray(markerOffset + 3, markerOffset + 9).every((v, i) => v === [0x45, 0x78, 0x69, 0x66, 0, 0][i]);
    if (isExif) {
      try {
        const tiffStart = markerOffset + 9;
        const tiffEnd = markerOffset + 1 + length;
        const tiff = output.subarray(tiffStart, tiffEnd);
        const reader = readerFor(tiff, 0);
        if (rangeIsValid(tiff, 0, 8) && reader.u16(2) === 42) {
          const entry = findOrientationEntry(reader, reader.u32(4), new Set());
          if (entry !== undefined) {
            const little = reader.endian === 'little';
            new DataView(output.buffer, output.byteOffset, output.byteLength).setUint16(tiffStart + entry + 8, 1, little);
          }
        }
      } catch { /* Preserve bytes when the segment is malformed. */ }
      return output;
    }
    offset = markerOffset + 1 + length;
  }
  return output;
}
