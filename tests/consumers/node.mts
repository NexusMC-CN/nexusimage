import {
  createFfmpegAnimationEngine,
  type FfmpegAnimationEngineOptions,
  type AnimationTranscodeOptions,
  type NodeAnimatedImage,
  type NodeAnimationEngineApi,
} from '@nexusmc-cn/nexusimage-node/ffmpeg';
import {
  createNexusImageService,
  createSharpImageEngine,
  type NexusImageService,
  type SharpImageEngine,
  type NodeEncodedImage,
} from '@nexusmc-cn/nexusimage-node';
import nexusImageFastify, { type NexusImageFastifyOptions } from '@nexusmc-cn/nexusimage-node/fastify';
import type { EncodedImageBase, ImageMetadata, ProcessOptions } from '@nexusmc-cn/nexusimage/contracts';
import Fastify, { type FastifyPluginAsync } from 'fastify';

const engine: SharpImageEngine = createSharpImageEngine();
const service: NexusImageService = createNexusImageService({ engine });
const options: ProcessOptions = { resize: { height: 120 } };
const metadata: Promise<ImageMetadata> = service.inspect(Buffer.from([0]));
const plugin: FastifyPluginAsync<NexusImageFastifyOptions> = nexusImageFastify;
const encode = (image: NodeEncodedImage): EncodedImageBase => image;
const pluginOptions: NexusImageFastifyOptions = { service, engine };
Fastify().register(plugin, pluginOptions);
async function resize(source: Buffer): Promise<EncodedImageBase> {
  const processed = await service.process(source, options);
  try {
    const encoded: NodeEncodedImage = await service.encode(processed, { type: 'image/png' });
    return encoded;
  } finally {
    processed.dispose();
  }
}
// @ts-expect-error Remote URLs must be handled by the host, not the Node engine.
service.inspect('https://example.invalid/image.png');
void [options, metadata, plugin, encode, pluginOptions, resize];

const ffmpegOptions: FfmpegAnimationEngineOptions = {
  ffmpegPath: '/host/ffmpeg',
  ffprobePath: '/host/ffprobe',
  limits: { maxFrames: 20, maxDurationMs: 2000, maxTotalPixels: 100000, maxProcessingMs: 5000 },
};
const animationEngine: NodeAnimationEngineApi = createFfmpegAnimationEngine(ffmpegOptions);
const animationService = createNexusImageService({ animationEngine });
const animationOptions: AnimationTranscodeOptions = {
  type: 'image/webp',
  quality: 0.8,
  resize: { width: 20 },
  limits: { maxFrames: 10 },
  signal: new AbortController().signal,
};
const animated: Promise<NodeAnimatedImage> = animationService.transcodeAnimation(Buffer.from([0]), animationOptions);
// @ts-expect-error Animation output excludes static-only formats.
const invalidAnimation: AnimationTranscodeOptions = { type: 'image/png' };
void [animated, invalidAnimation];
