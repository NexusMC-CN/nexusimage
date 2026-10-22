import { getEventListeners } from 'node:events';
import { expect, it, vi } from 'vitest';
import { NexusImage } from '../src/index.js';

// A whole-body read or an awaited, stuck cancellation must fail this deadline.
async function promptly<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Source operation did not settle promptly.')), 250);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

it.each([
  { label: 'missing Content-Length', headers: {}, cancellation: 'complete' },
  { label: 'underreported Content-Length', headers: { 'Content-Length': '4' }, cancellation: 'complete' },
  { label: 'rejected cancellation', headers: {}, cancellation: 'reject' },
  { label: 'pending cancellation', headers: {}, cancellation: 'pending' },
])('stops an open response at the first overflowing chunk with $label', async ({ headers, cancellation }) => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls += 1;
        if (pulls <= 2) controller.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel() {
        cancelled = true;
        if (cancellation === 'reject') return Promise.reject(new Error('Cancellation failed.'));
        if (cancellation === 'pending') return new Promise<void>(() => {});
      },
    },
    { highWaterMark: 0 },
  );
  vi.stubGlobal('fetch', async () => new Response(body, { headers }));
  const caller = new AbortController();
  try {
    await expect(
      promptly(
        NexusImage.load('https://example.test/image.png', { signal: caller.signal, limits: { maxInputBytes: 5 } }),
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT', stage: 'source' });
    expect(pulls).toBe(2);
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
    expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
  } finally {
    caller.abort();
  }
});

it.each(['abort', 'timeout'] as const)(
  'cancels a pending response read and releases resources on %s',
  async (cause) => {
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull() {
          started();
        },
        cancel() {
          cancelled = true;
          return new Promise<void>(() => {});
        },
      },
      { highWaterMark: 0 },
    );
    let fetchSignal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', async (_input: unknown, options?: RequestInit) => {
      fetchSignal = options?.signal;
      return new Response(body);
    });
    const caller = new AbortController();
    const pending = NexusImage.load('https://example.test/pending.png', {
      signal: caller.signal,
      limits: { fetchTimeoutMs: cause === 'timeout' ? 20 : 10_000 },
    });
    try {
      await reading;
      if (cause === 'abort') caller.abort();
      await expect(promptly(pending)).rejects.toMatchObject({
        code: cause === 'abort' ? 'ABORTED' : 'RESOURCE_LIMIT',
        stage: 'source',
      });
      expect(cancelled).toBe(true);
      expect(body.locked).toBe(false);
      expect(getEventListeners(caller.signal, 'abort')).toHaveLength(0);
      expect(getEventListeners(fetchSignal!, 'abort')).toHaveLength(0);
    } finally {
      caller.abort();
    }
  },
);

it('releases the response reader after a read failure and preserves its cause', async () => {
  const failure = new Error('Stream read failed.');
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(failure);
    },
  });
  vi.stubGlobal('fetch', async () => new Response(body));
  await expect(NexusImage.load('https://example.test/broken.png')).rejects.toMatchObject({
    code: 'INVALID_SOURCE',
    stage: 'source',
    cause: failure,
  });
  expect(body.locked).toBe(false);
});

it.each([
  { label: 'exact byte bound', headers: { 'Content-Type': 'image/png' }, bytes: [1, 2, 3, 4], mimeType: 'image/png' },
  {
    label: 'signature over MIME',
    headers: { 'Content-Type': 'image/png' },
    bytes: [255, 216, 255, 217],
    mimeType: 'image/jpeg',
  },
  {
    label: 'encoded Content-Length',
    headers: { 'Content-Type': 'image/png', 'Content-Encoding': 'gzip', 'Content-Length': '100' },
    bytes: [1, 2, 3, 4],
    mimeType: 'image/png',
  },
])('preserves streamed bytes and MIME at the $label', async ({ headers, bytes, mimeType }) => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes.slice(0, 2)));
      controller.enqueue(new Uint8Array(bytes.slice(2)));
      controller.close();
    },
  });
  let decodedBlob: Blob | undefined;
  let fetchSignal: AbortSignal | null | undefined;
  vi.stubGlobal('fetch', async (_input: unknown, options?: RequestInit) => {
    fetchSignal = options?.signal;
    return new Response(body, { headers });
  });
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    decodedBlob = blob;
    return { width: 2, height: 1, close() {} };
  });
  const asset = await NexusImage.load('https://example.test/image', { limits: { maxInputBytes: 4 } });
  try {
    expect(asset.metadata).toMatchObject({ mimeType, size: 4 });
    expect(decodedBlob?.type).toBe('image/png');
    expect(Array.from(new Uint8Array(await decodedBlob!.arrayBuffer()))).toEqual(bytes);
    expect(body.locked).toBe(false);
    expect(getEventListeners(fetchSignal!, 'abort')).toHaveLength(0);
  } finally {
    asset.dispose();
  }
});

it('rejects a null response body as an empty source', async () => {
  vi.stubGlobal('fetch', async () => new Response(null));
  await expect(NexusImage.load('https://example.test/empty.png')).rejects.toMatchObject({
    code: 'INVALID_SOURCE',
    stage: 'source',
  });
});

it.each([
  { label: 'invalid type', contentType: 'invalid', blobType: '', mimeType: 'application/octet-stream' },
  {
    label: 'parameters',
    contentType: 'IMAGE/PNG; Charset="UTF-8"; foo=Bar',
    blobType: 'image/png;charset=utf-8;foo=bar',
    mimeType: 'image/png',
  },
  { label: 'multiple types', contentType: 'image/jpeg, image/png', blobType: 'image/png', mimeType: 'image/png' },
])('preserves Fetch MIME parsing for $label', async ({ contentType, blobType, mimeType }) => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', async () => new Response(body, { headers: { 'Content-Type': contentType } }));
  let decodedBlob: Blob | undefined;
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    decodedBlob = blob;
    return { width: 2, height: 1, close() {} };
  });
  const asset = await NexusImage.load('https://example.test/image', { limits: { maxInputBytes: 4 } });
  try {
    expect(asset.metadata).toMatchObject({ mimeType, size: 4 });
    expect(decodedBlob?.type).toBe(blobType);
    expect(Array.from(new Uint8Array(await decodedBlob!.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  } finally {
    asset.dispose();
  }
});
