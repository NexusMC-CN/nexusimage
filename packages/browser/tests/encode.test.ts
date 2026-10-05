import { expect, it, vi } from 'vitest';
import { encodeSurface } from '../src/encode/to-blob';

it('passes MIME type and quality to HTML canvas toBlob', async () => {
  const toBlob = vi.fn((_callback: (blob: Blob | null) => void, _type?: string, _quality?: number) => {
    _callback(new Blob(['encoded'], { type: 'image/webp' }));
  });
  const result = await encodeSurface(
    {
      canvas: { width: 1, height: 1, getContext: () => null, toBlob },
      context: {} as never,
      width: 1,
      height: 1,
      dispose() {},
    },
    { type: 'image/webp', quality: 0.8 },
  );
  expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.8);
  expect(result.type).toBe('image/webp');
});

it('rejects quality outside the browser range', async () => {
  await expect(
    encodeSurface(
      {
        canvas: { width: 1, height: 1, getContext: () => null },
        context: {} as never,
        width: 1,
        height: 1,
        dispose() {},
      },
      { quality: 2 },
    ),
  ).rejects.toMatchObject({ code: 'ENCODE_FAILED' });
});

it('rejects a pending OffscreenCanvas encode promptly on abort', async () => {
  let resolveBlob!: (blob: Blob) => void;
  const controller = new AbortController();
  const pending = encodeSurface(
    {
      canvas: {
        width: 1,
        height: 1,
        getContext: () => null,
        convertToBlob: () =>
          new Promise<Blob>((resolve) => {
            resolveBlob = resolve;
          }),
      },
      context: {} as never,
      width: 1,
      height: 1,
      dispose() {},
    },
    { signal: controller.signal },
  );
  controller.abort();
  resolveBlob(new Blob(['encoded'], { type: 'image/png' }));
  await expect(pending).rejects.toMatchObject({ code: 'ABORTED', stage: 'encode' });
});
