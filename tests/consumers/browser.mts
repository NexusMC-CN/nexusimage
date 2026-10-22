import { NexusImage, type EncodedImage, type ImageMetadata } from '@nexusmc-cn/nexusimage';
import { detectImageFormat, type EncodedImageBase, type ProcessOptions } from '@nexusmc-cn/nexusimage/contracts';

const options: ProcessOptions = { resize: { height: 120 }, crop: { x: 0, y: 0, width: 2, height: 1 } };
const metadata: Promise<ImageMetadata> = NexusImage.inspect(new Blob());
const encode = (image: EncodedImage): EncodedImageBase => image;
const format: string = detectImageFormat(new Uint8Array()).format;
async function resize(source: Blob): Promise<EncodedImageBase> {
  const processed = await NexusImage.process(source, options);
  try {
    return await NexusImage.encode(processed, { type: 'image/png' });
  } finally {
    processed.dispose();
  }
}
// @ts-expect-error Image dimensions are numbers, not CSS lengths.
const invalid: ProcessOptions = { resize: { height: '120px' } };
void [options, metadata, encode, format, resize, invalid];
