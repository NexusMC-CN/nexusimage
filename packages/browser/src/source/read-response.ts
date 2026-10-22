import { awaitWithAbort } from '../abort.js';
import { throwIfAborted } from '../errors.js';
import { assertInputBytes, type ResolvedResourceLimits } from '../limits.js';

export async function readResponseBlob(
  response: Response,
  limits: ResolvedResourceLimits,
  signal?: AbortSignal,
): Promise<Blob> {
  // Let Fetch normalize MIME headers without buffering the input body again.
  const emptyResponse = new Response(null, { headers: response.headers });
  if (!response.body) return emptyResponse.blob();
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let size = 0;
  try {
    const { type } = await emptyResponse.blob();
    throwIfAborted(signal);
    while (true) {
      const { done, value } = await awaitWithAbort(reader.read(), signal);
      throwIfAborted(signal);
      if (done) break;
      size += value.byteLength;
      assertInputBytes(size, limits);
      chunks.push(value as unknown as BlobPart);
    }
    return new Blob(chunks, { type });
  } catch (error) {
    // Cancellation may reject or never settle; preserve the original failure promptly.
    try {
      void reader.cancel(error).catch(() => undefined);
    } catch {}
    throw error;
  } finally {
    reader.releaseLock();
  }
}
