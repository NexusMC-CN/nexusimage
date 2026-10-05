import { expect, it, vi } from 'vitest';
import { createObjectUrl, normalizeSource } from '../src/source';

it('normalizes a Blob while preserving type and size', async () => {
  const normalized = await normalizeSource(new Blob(['image'], { type: 'image/jpeg' }));
  expect(normalized.mimeType).toBe('image/jpeg');
  expect(normalized.size).toBe(5);
  expect(normalized.format).toMatchObject({ format: 'jpeg', mimeType: 'image/jpeg', animated: false });
  normalized.dispose();
});

it('rejects an empty Blob as INVALID_SOURCE', async () => {
  await expect(normalizeSource(new Blob())).rejects.toMatchObject({ code: 'INVALID_SOURCE', stage: 'source' });
});

it('revokes an object URL at most once', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const objectUrl = createObjectUrl(new Blob(['image']));
  objectUrl.dispose();
  objectUrl.dispose();
  expect(revoke).toHaveBeenCalledTimes(1);
  revoke.mockRestore();
});

it('turns response body cancellation into ABORTED while reading a URL source', async () => {
  let resolveBody!: (blob: Blob) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      blob: () =>
        new Promise<Blob>((resolve) => {
          resolveBody = resolve;
        }),
    })),
  );
  const controller = new AbortController();
  const pending = normalizeSource('https://example.test/image.png', controller.signal);
  await Promise.resolve();
  controller.abort();
  resolveBody(new Blob(['image'], { type: 'image/png' }));
  await expect(pending).rejects.toMatchObject({ code: 'ABORTED', stage: 'source' });
});
