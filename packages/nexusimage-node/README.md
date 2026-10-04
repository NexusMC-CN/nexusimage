# @nexusimage/node

Node.js runtime adapter for NexusImage. It uses `sharp` for decoding, EXIF
metadata, transforms, and encoding while keeping the browser package free of
Node-specific dependencies.

## Install

```sh
npm install @nexusimage/node nexusimage
```

The package requires Node.js 20 or newer. `nexusimage` is the shared contract
peer dependency and `sharp` is the native image engine.

## Engine

```ts
import { createSharpImageEngine } from '@nexusimage/node';

const engine = createSharpImageEngine({
  limits: { maxInputBytes: 32 * 1024 * 1024 },
});

const processed = await engine.process(inputBuffer, {
  resize: { width: 1200, fit: 'contain' },
  orientation: 'normalize',
});

const result = await engine.encode(processed, {
  type: 'image/webp',
  quality: 0.82,
});

processed.dispose();
// result.buffer is a Node.js Buffer.
```

Supported input sources are `Buffer`, `Uint8Array`, `ArrayBuffer`, and
`Blob`/`File`. Remote URLs and filesystem paths are intentionally left to the
host application so it can apply authentication, SSRF policy, and storage
limits.

`inspect()` returns format, dimensions, animation status, and parsed EXIF
metadata. The normal `process()` path handles the first frame of animated
images; storage, queues, caching, and request policy remain platform concerns.

## Fastify adapter

The optional adapter is exposed from a separate entry point:

```ts
import Fastify from 'fastify';
import nexusImageFastify from '@nexusimage/node/fastify';

const app = Fastify();
await app.register(nexusImageFastify, {
  limits: { maxInputBytes: 32 * 1024 * 1024 },
});
```

Install Fastify when using this entry point. The adapter's multipart parser and
plugin runtime dependencies are included with `@nexusimage/node`:

```sh
npm install fastify
```

It registers `POST /api/images/inspect` and `POST /api/images/process`, accepts
multipart uploads or raw byte bodies, and returns the encoded image. The host
application remains responsible for authentication, rate limiting, error
envelopes, persistence, asynchronous jobs, and caching. Use `errorMapper` to
integrate the host's error response format.

For multipart processing, send the file part as `file`. Processing options can
be supplied as a JSON object in `options`, `process`, or `processOptions`; the
encoded MIME type and quality can also be sent as scalar `type` and `quality`
fields. Raw `image/*` and `application/octet-stream` bodies are parsed as
Buffers by default. Set `registerMultipart: false` when the application already
owns the multipart parser.

## Development

```sh
npm test
npm run typecheck
npm run build
npm run pack:check
```
