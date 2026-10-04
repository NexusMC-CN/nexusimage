import multipart from '@fastify/multipart';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  NexusImageError,
  resolveResourceLimits,
  type EncodeOptions,
  type ImageMetadata,
  type LoadOptions,
  type ProcessOptions,
  type ResourceLimits,
} from 'nexusimage/contracts';
import { SharpImageEngine } from './engine.js';
import type { NodeImageAsset, NodeImageSource, NodeProcessedImage, NodeEncodedImage } from './types.js';

/** Engine surface consumed by the Fastify adapter. */
export interface NexusImageHttpEngine {
  inspect(source: NodeImageSource, options?: LoadOptions): Promise<ImageMetadata>;
  process(source: NodeImageSource | NodeImageAsset, options?: ProcessOptions): Promise<NodeProcessedImage>;
  encode(image: NodeProcessedImage, options?: EncodeOptions): Promise<NodeEncodedImage>;
}

export type NexusImageRoute = 'inspect' | 'process';

export interface NexusImageErrorContext {
  route: NexusImageRoute;
  request: FastifyRequest;
  reply: FastifyReply;
}

/**
 * The adapter does not prescribe the host application's error envelope.
 * Return a response from this mapper to handle an error, or return undefined
 * to let Fastify's own error handler (or a host-level handler) process it.
 */
export interface NexusImageErrorResponse {
  statusCode?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export type NexusImageErrorMapper = (
  error: unknown,
  context: NexusImageErrorContext,
) => NexusImageErrorResponse | undefined | Promise<NexusImageErrorResponse | undefined>;

export interface NexusImageFastifyOptions {
  /** Inject a shared engine instance when the host owns its lifecycle. */
  engine?: NexusImageHttpEngine;
  /** Limits applied before the engine is invoked. Individual request options cannot increase them. */
  limits?: ResourceLimits;
  /** Maximum number of uploaded bytes accepted by the multipart parser. */
  maxFileBytes?: number;
  /** Register @fastify/multipart automatically. Set false when the host registered it. */
  registerMultipart?: boolean;
  /** Register binary parsers for image/* and application/octet-stream. Set false when the host owns them. */
  registerRawBodyParser?: boolean;
  inspectPath?: string;
  processPath?: string;
  errorMapper?: NexusImageErrorMapper;
}

interface MultipartField {
  value?: unknown;
}

interface Upload {
  buffer: Buffer;
  filename?: string;
  mimetype?: string;
  fields: Record<string, MultipartField | string>;
}

interface MultipartRequest {
  isMultipart?: () => boolean;
  file?: (options?: { limits?: { fileSize?: number; files?: number } }) => Promise<{
    file: NodeJS.ReadableStream & { truncated?: boolean };
    filename: string;
    mimetype: string;
    fields: Record<string, MultipartField | string>;
    toBuffer(): Promise<Buffer>;
  } | undefined>;
}

const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const RAW_IMAGE_CONTENT_TYPES = [
  'application/octet-stream',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/tiff',
] as const;

function asPositiveLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new NexusImageError('INVALID_SOURCE', 'source', 'maxFileBytes must be a positive finite number.');
  }
  const integer = Math.floor(value);
  if (integer < 1) {
    throw new NexusImageError('INVALID_SOURCE', 'source', 'maxFileBytes must be at least one byte.');
  }
  return integer;
}

function minLimit(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

/** Keep request options from increasing the limits selected by the host. */
function capLimits(requestLimits: ResourceLimits | undefined, hostLimits: ResourceLimits): ResourceLimits {
  const result: ResourceLimits = { ...requestLimits };
  for (const key of [
    'maxInputBytes',
    'maxInputPixels',
    'maxInputWidth',
    'maxInputHeight',
    'maxOutputBytes',
    'maxOutputPixels',
    'maxOutputWidth',
    'maxOutputHeight',
    'fetchTimeoutMs',
  ] as const) {
    const value = minLimit(requestLimits?.[key], hostLimits[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function fieldValue(field: MultipartField | string | undefined): unknown {
  return typeof field === 'string' ? field : field?.value;
}

function parseJsonObject<T>(fields: Record<string, MultipartField | string>, names: readonly string[]): T | undefined {
  for (const name of names) {
    const raw = fieldValue(fields[name]);
    if (raw === undefined || raw === '') continue;
    if (typeof raw !== 'string') {
      if (typeof raw === 'object' && raw !== null) return raw as T;
      throw new NexusImageError('INVALID_SOURCE', 'source', `Multipart field "${name}" must be a JSON object.`);
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('expected an object');
      }
      return parsed as T;
    } catch (error) {
      throw new NexusImageError('INVALID_SOURCE', 'source', `Multipart field "${name}" must contain valid JSON.`, error);
    }
  }
  return undefined;
}

function parseScalar(fields: Record<string, MultipartField | string>, name: string): string | undefined {
  const raw = fieldValue(fields[name]);
  return raw === undefined ? undefined : String(raw);
}

function addDirectEncodeFields(fields: Record<string, MultipartField | string>, options: EncodeOptions): EncodeOptions {
  const type = parseScalar(fields, 'type');
  const quality = parseScalar(fields, 'quality');
  const result = { ...options };
  if (type !== undefined && result.type === undefined) result.type = type;
  if (quality !== undefined && result.quality === undefined) {
    const value = Number(quality);
    if (!Number.isFinite(value)) {
      throw new NexusImageError('INVALID_SOURCE', 'source', 'quality must be a finite number.');
    }
    result.quality = value;
  }
  return result;
}

async function readUpload(request: FastifyRequest, maxFileBytes: number): Promise<Upload> {
  const multipartRequest = request as MultipartRequest;
  if (multipartRequest.isMultipart?.()) {
    if (!multipartRequest.file) {
      throw new NexusImageError('UNSUPPORTED', 'capability', 'The Fastify multipart plugin is not registered.');
    }
    const part = await multipartRequest.file({ limits: { fileSize: maxFileBytes, files: 1 } });
    if (!part) throw new NexusImageError('INVALID_SOURCE', 'source', 'An image file is required.');
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';
      const errorCode = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
      if (part.file.truncated || errorName === 'RequestFileTooLargeError' || errorCode === 'FST_REQ_FILE_TOO_LARGE') {
        throw new NexusImageError('RESOURCE_LIMIT', 'source', 'The uploaded image exceeds the configured file size limit.', error);
      }
      throw new NexusImageError('INVALID_SOURCE', 'source', 'Unable to read the multipart image upload.', error);
    }
    if (part.file.truncated || buffer.byteLength > maxFileBytes) {
      throw new NexusImageError('RESOURCE_LIMIT', 'source', 'The uploaded image exceeds the configured file size limit.');
    }
    return { buffer, filename: part.filename, mimetype: part.mimetype, fields: part.fields };
  }

  const body = (request as FastifyRequest & { body?: unknown }).body;
  if (Buffer.isBuffer(body)) {
    if (body.byteLength > maxFileBytes) {
      throw new NexusImageError('RESOURCE_LIMIT', 'source', 'The uploaded image exceeds the configured file size limit.');
    }
    return { buffer: body, fields: {} };
  }
  if (body instanceof Uint8Array) {
    if (body.byteLength > maxFileBytes) {
      throw new NexusImageError('RESOURCE_LIMIT', 'source', 'The uploaded image exceeds the configured file size limit.');
    }
    return { buffer: Buffer.from(body), fields: {} };
  }
  throw new NexusImageError('INVALID_SOURCE', 'source', 'Expected a multipart image upload or an image byte body.');
}

async function applyMappedError(
  reply: FastifyReply,
  request: FastifyRequest,
  route: NexusImageRoute,
  error: unknown,
  mapper: NexusImageErrorMapper | undefined,
): Promise<boolean> {
  if (!mapper) return false;
  const mapped = await mapper(error, { route, request, reply });
  if (!mapped) return false;
  if (mapped.headers) {
    for (const [name, value] of Object.entries(mapped.headers)) reply.header(name, value);
  }
  if (mapped.statusCode !== undefined) reply.code(mapped.statusCode);
  if (mapped.body === undefined) reply.send();
  else reply.send(mapped.body);
  return true;
}

function defaultEngine(options: NexusImageFastifyOptions): NexusImageHttpEngine {
  return options.engine ?? new SharpImageEngine({ limits: options.limits });
}

const plugin: FastifyPluginAsync<NexusImageFastifyOptions> = async (app, options) => {
  const hostLimits = resolveResourceLimits(options.limits);
  const maxFileBytes = asPositiveLimit(options.maxFileBytes, hostLimits.maxInputBytes || DEFAULT_MAX_FILE_BYTES);
  const engine = defaultEngine(options);

  if (options.registerMultipart !== false) {
    await app.register(multipart, {
      limits: { files: 1, fileSize: maxFileBytes },
      throwFileSizeLimit: false,
    });
  }

  if (options.registerRawBodyParser !== false) {
    for (const contentType of RAW_IMAGE_CONTENT_TYPES) {
      if (app.hasContentTypeParser(contentType)) continue;
      app.addContentTypeParser(
        contentType,
        { parseAs: 'buffer', bodyLimit: maxFileBytes },
        (_request, body, done) => done(null, body),
      );
    }
  }

  const inspectPath = options.inspectPath ?? '/api/images/inspect';
  const processPath = options.processPath ?? '/api/images/process';

  app.post(inspectPath, async (request, reply) => {
    try {
      const upload = await readUpload(request, maxFileBytes);
      const metadata = await engine.inspect(upload.buffer, {
        limits: capLimits(undefined, hostLimits),
      });
      return reply.type('application/json').send(metadata);
    } catch (error) {
      if (await applyMappedError(reply, request, 'inspect', error, options.errorMapper)) return;
      throw error;
    }
  });

  app.post(processPath, async (request, reply) => {
    let processed: NodeProcessedImage | undefined;
    try {
      const upload = await readUpload(request, maxFileBytes);
      const processOptions = parseJsonObject<ProcessOptions>(upload.fields, ['process', 'processOptions', 'options']) ?? {};
      const encodeOptions = addDirectEncodeFields(
        upload.fields,
        parseJsonObject<EncodeOptions>(upload.fields, ['encode', 'encodeOptions']) ?? {},
      );
      processOptions.limits = capLimits(processOptions.limits, hostLimits);
      encodeOptions.limits = capLimits(encodeOptions.limits, hostLimits);
      processed = await engine.process(upload.buffer, processOptions);
      const encoded = await engine.encode(processed, encodeOptions);
      if (!Buffer.isBuffer(encoded.buffer)) {
        throw new NexusImageError('ENCODE_FAILED', 'encode', 'The Node image engine returned a non-Buffer result.');
      }
      reply.header('content-type', encoded.type);
      reply.header('content-length', String(encoded.buffer.byteLength));
      return reply.send(encoded.buffer);
    } catch (error) {
      if (await applyMappedError(reply, request, 'process', error, options.errorMapper)) return;
      throw error;
    } finally {
      processed?.dispose();
    }
  });
};

/** Fastify plugin exposing the platform-neutral image inspection and processing routes. */
export const nexusImageFastify = fp(plugin, { name: 'nexusimage-fastify' });
export default nexusImageFastify;

