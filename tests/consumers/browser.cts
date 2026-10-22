import browser = require('@nexusmc-cn/nexusimage');
import contracts = require('@nexusmc-cn/nexusimage/contracts');

const options: contracts.ProcessOptions = { resize: { height: 120 } };
const metadata: Promise<contracts.ImageMetadata> = browser.NexusImage.inspect(new Blob());
const error: contracts.NexusImageError = new browser.NexusImageError('INVALID_SOURCE', 'source', 'Invalid input');
async function resize(source: Blob): Promise<contracts.EncodedImageBase> {
  const processed = await browser.NexusImage.process(source, options);
  try {
    return await browser.NexusImage.encode(processed, { type: 'image/png' });
  } finally {
    processed.dispose();
  }
}
// @ts-expect-error Image dimensions are numbers, not CSS lengths.
const invalid: contracts.ProcessOptions = { resize: { height: '120px' } };
void [options, metadata, error, resize, invalid];
