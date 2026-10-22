import { expect, it, vi } from 'vitest';
import { NexusImage } from '../src/index';

function browserImage(width: number, height: number): Blob {
  vi.stubGlobal('createImageBitmap', async () => ({ width, height, close() {} }));
  const context = { save() {}, restore() {}, translate() {}, scale() {}, transform() {}, drawImage() {} };
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  return new Blob(['image'], { type: 'image/png' });
}

it.each([
  {
    label: 'landscape height',
    width: 1200,
    height: 800,
    resize: { height: 400 },
    expected: { width: 600, height: 400 },
  },
  {
    label: 'portrait height',
    width: 800,
    height: 1200,
    resize: { height: 300 },
    expected: { width: 200, height: 300 },
  },
  { label: 'square height', width: 800, height: 800, resize: { height: 300 }, expected: { width: 300, height: 300 } },
  { label: 'width control', width: 1200, height: 800, resize: { width: 600 }, expected: { width: 600, height: 400 } },
  {
    label: 'fractional height',
    width: 1200,
    height: 800,
    resize: { height: 333.4 },
    expected: { width: 500, height: 333 },
  },
])('preserves the aspect ratio for $label through process', async ({ width, height, resize, expected }) => {
  const processed = await NexusImage.process(browserImage(width, height), { resize });
  try {
    expect(processed).toMatchObject(expected);
    expect(processed.metadata).toMatchObject(expected);
  } finally {
    processed.dispose();
  }
});

it.each([{ maxOutputWidth: 599 }, { maxOutputHeight: 399 }, { maxOutputPixels: 239_999 }])(
  'enforces height-only output limits %j',
  async (limits) => {
    await expect(
      NexusImage.process(browserImage(1200, 800), { resize: { height: 400 }, limits }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT', stage: 'render' });
  },
);

it('allows a height-only resize at the output pixel bound', async () => {
  const processed = await NexusImage.process(browserImage(1200, 800), {
    resize: { height: 400 },
    limits: { maxOutputPixels: 240_000, maxOutputWidth: 600, maxOutputHeight: 400 },
  });
  try {
    expect(processed).toMatchObject({ width: 600, height: 400 });
  } finally {
    processed.dispose();
  }
});

it('rejects height-only dimensions that round below one pixel', async () => {
  await expect(NexusImage.process(browserImage(1, 1000), { resize: { height: 1 } })).rejects.toMatchObject({
    code: 'RENDER_FAILED',
    stage: 'render',
  });
});
