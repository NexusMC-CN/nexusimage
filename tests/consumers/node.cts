import animation = require('@nexusmc-cn/nexusimage-node/ffmpeg');
import node = require('@nexusmc-cn/nexusimage-node');
import fastifyAdapter = require('@nexusmc-cn/nexusimage-node/fastify');
import contracts = require('@nexusmc-cn/nexusimage/contracts');
import fastify = require('fastify');

const engine: node.SharpImageEngine = node.createSharpImageEngine();
const service: node.NexusImageService = node.createNexusImageService({ engine });
const options: contracts.ProcessOptions = { resize: { height: 120 } };
const metadata: Promise<contracts.ImageMetadata> = service.inspect(Buffer.from([0]));
const plugin: fastify.FastifyPluginAsync<fastifyAdapter.NexusImageFastifyOptions> = fastifyAdapter.default;
const encode = (image: node.NodeEncodedImage): contracts.EncodedImageBase => image;
const pluginOptions: fastifyAdapter.NexusImageFastifyOptions = { service, engine };
fastify.fastify().register(plugin, pluginOptions);
async function resize(source: Buffer): Promise<contracts.EncodedImageBase> {
  const processed = await service.process(source, options);
  try {
    const encoded: node.NodeEncodedImage = await service.encode(processed, { type: 'image/png' });
    return encoded;
  } finally {
    processed.dispose();
  }
}
// @ts-expect-error Remote URLs must be handled by the host, not the Node engine.
service.inspect('https://example.invalid/image.png');
void [options, metadata, plugin, encode, pluginOptions, resize];

const ffmpegOptions: animation.FfmpegAnimationEngineOptions = {
  ffmpegPath: '/host/ffmpeg',
  ffprobePath: '/host/ffprobe',
  limits: { maxFrames: 20, maxDurationMs: 2000, maxTotalPixels: 100000, maxProcessingMs: 5000 },
};
const animationEngine: animation.NodeAnimationEngineApi = animation.createFfmpegAnimationEngine(ffmpegOptions);
const animationService = node.createNexusImageService({ animationEngine });
const animationOptions: animation.AnimationTranscodeOptions = {
  type: 'image/avif',
  quality: 0.8,
  resize: { width: 20 },
  limits: { maxFrames: 10 },
  signal: new AbortController().signal,
};
const animated: Promise<animation.NodeAnimatedImage> = animationService.transcodeAnimation(
  Buffer.from([0]),
  animationOptions,
);
// @ts-expect-error Animation output excludes static-only formats.
const invalidAnimation: animation.AnimationTranscodeOptions = { type: 'image/png' };
void [animated, invalidAnimation];
