import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { ImageMetadata, ProcessOptions } from 'nexusimage/contracts';
import { NexusImageError } from 'nexusimage/contracts';
import { nexusImageFastify, type NexusImageHttpEngine } from '../src/fastify.js';
import { createNexusImageService } from '../src/index.js';
import type { NodeProcessedImage } from '../src/types.js';

const metadata: ImageMetadata = {
  width: 2,
  height: 1,
  mimeType: 'image/png',
  size: 8,
  orientation: 1,
  exif: {},
  format: 'png',
  animated: false,
};

function multipart(parts: Array<{ name: string; value: string | Buffer; filename?: string; type?: string }>): { body: Buffer; contentType: string } {
  const boundary = 'nexus-image-test-boundary';
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = part.filename
      ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"`
      : `Content-Disposition: form-data; name="${part.name}"`;
    const header = `--${boundary}\r\n${disposition}\r\n${part.filename ? `Content-Type: ${part.type ?? 'application/octet-stream'}\r\n` : ''}\r\n`;
    chunks.push(Buffer.from(header), typeof part.value === 'string' ? Buffer.from(part.value) : part.value, Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function createEngine() {
  let seenProcessOptions: ProcessOptions | undefined;
  let disposed = false;
  const engine: NexusImageHttpEngine = {
    async inspect(source) {
      expect(Buffer.isBuffer(source)).toBe(true);
      return metadata;
    },
    async process(source, options) {
      expect(Buffer.isBuffer(source)).toBe(true);
      seenProcessOptions = options;
      const processed: NodeProcessedImage = {
        width: 2,
        height: 1,
        metadata,
        dispose: () => { disposed = true; },
      };
      return processed;
    },
    async encode(image) {
      expect(image.width).toBe(2);
      return { buffer: Buffer.from([1, 2, 3]), type: 'image/webp', width: 2, height: 1, metadata };
    },
  };
  return { engine, getOptions: () => seenProcessOptions, wasDisposed: () => disposed };
}

describe('Fastify adapter', () => {
  it('accepts raw image bytes without a host parser', async () => {
    const fake = createEngine();
    const app = Fastify();
    await app.register(nexusImageFastify, { engine: fake.engine });

    const response = await app.inject({
      method: 'POST',
      url: '/api/images/inspect',
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from([1, 2, 3]),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ format: 'png' });
    await app.close();
  });

  it('accepts multipart uploads for inspect and returns metadata', async () => {
    const fake = createEngine();
    const app = Fastify();
    await app.register(nexusImageFastify, { engine: fake.engine });
    const payload = multipart([{ name: 'file', filename: 'image.png', type: 'image/png', value: Buffer.from([1, 2, 3]) }]);

    const response = await app.inject({ method: 'POST', url: '/api/images/inspect', headers: { 'content-type': payload.contentType }, payload: payload.body });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ width: 2, height: 1, format: 'png' });
    await app.close();
  });

  it('processes multipart options and returns encoded bytes with headers', async () => {
    const fake = createEngine();
    const app = Fastify();
    await app.register(nexusImageFastify, { engine: fake.engine });
    const payload = multipart([
      { name: 'options', value: JSON.stringify({ resize: { width: 10 }, rotate: 90 }) },
      { name: 'type', value: 'image/webp' },
      { name: 'quality', value: '0.7' },
      { name: 'file', filename: 'image.png', type: 'image/png', value: Buffer.from([1, 2, 3]) },
    ]);

    const response = await app.inject({ method: 'POST', url: '/api/images/process', headers: { 'content-type': payload.contentType }, payload: payload.body });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/webp');
    expect(response.headers['content-length']).toBe('3');
    expect(response.rawPayload).toEqual(Buffer.from([1, 2, 3]));
    expect(fake.getOptions()).toMatchObject({ resize: { width: 10 }, rotate: 90 });
    expect(fake.wasDisposed()).toBe(true);
    await app.close();
  });

  it('accepts a framework-neutral service while preserving the legacy engine option', async () => {
    const fake = createEngine();
    const service = createNexusImageService({
      engine: {
        ...fake.engine,
        load: async () => ({ metadata, dispose: () => undefined }),
        getCapabilities: () => ({
          htmlImage: false,
          offscreenCanvas: false,
          createImageBitmap: false,
          imageDecoder: false,
          canvasToBlob: false,
        }),
      },
    });
    const app = Fastify();
    await app.register(nexusImageFastify, { service });

    const response = await app.inject({
      method: 'POST',
      url: '/api/images/inspect',
      headers: { 'content-type': 'image/png' },
      payload: Buffer.from([1, 2, 3]),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ format: 'png' });
    await app.close();
  });

  it('caps multipart input and delegates the error response to the host mapper', async () => {
    const fake = createEngine();
    const app = Fastify();
    await app.register(nexusImageFastify, {
      engine: fake.engine,
      maxFileBytes: 2,
      errorMapper: (error) => {
        expect(error).toBeInstanceOf(NexusImageError);
        return { statusCode: 413, body: { code: (error as NexusImageError).code } };
      },
    });
    const payload = multipart([{ name: 'file', filename: 'large.png', value: Buffer.from([1, 2, 3]) }]);

    const response = await app.inject({ method: 'POST', url: '/api/images/inspect', headers: { 'content-type': payload.contentType }, payload: payload.body });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ code: 'RESOURCE_LIMIT' });
    await app.close();
  });
});

