import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import * as browser from '@nexusmc-cn/nexusimage';
import * as contracts from '@nexusmc-cn/nexusimage/contracts';
import * as node from '@nexusmc-cn/nexusimage-node';
import * as animation from '@nexusmc-cn/nexusimage-node/ffmpeg';
import * as fastifyAdapter from '@nexusmc-cn/nexusimage-node/fastify';
import Fastify from 'fastify';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const input = await sharp({ create: { width: 2, height: 1, channels: 4, background: '#ff0000' } })
  .png()
  .toBuffer();
for (const modules of [
  { browser, contracts, node, fastifyAdapter, animation },
  {
    browser: require('@nexusmc-cn/nexusimage'),
    contracts: require('@nexusmc-cn/nexusimage/contracts'),
    node: require('@nexusmc-cn/nexusimage-node'),
    animation: require('@nexusmc-cn/nexusimage-node/ffmpeg'),
    fastifyAdapter: require('@nexusmc-cn/nexusimage-node/fastify'),
  },
]) {
  assert.equal(typeof modules.browser.NexusImage.load, 'function');
  assert.equal(modules.contracts.detectImageFormat(input).format, 'png');
  const service = modules.node.createNexusImageService();
  const metadata = await service.inspect(input);
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 1);
  const animationEngine = modules.animation.createFfmpegAnimationEngine({
    ffmpegPath: 'nexusimage-missing-ffmpeg',
    ffprobePath: 'nexusimage-missing-ffprobe',
  });
  assert.equal(typeof animationEngine.transcodeAnimation, 'function');
  const animated = {
    buffer: Buffer.from([1]),
    type: 'image/webp',
    width: 1,
    height: 1,
    size: 1,
    frameCount: 2,
    durationMs: 100,
  };
  const animationOptions = { type: 'image/webp', limits: { maxFrames: 5 } };
  let calls = 0;
  const animationService = modules.node.createNexusImageService({
    animationEngine: {
      async transcodeAnimation(source, options) {
        assert.equal(source, input);
        assert.equal(options, animationOptions);
        calls++;
        return animated;
      },
    },
  });
  assert.equal(await animationService.transcodeAnimation(input, animationOptions), animated);
  assert.equal(calls, 1);
  await assert.rejects(service.transcodeAnimation(input, animationOptions), { code: 'UNSUPPORTED' });
  const app = Fastify();
  try {
    await app.register(modules.fastifyAdapter.default, { service });
    await app.ready();
    assert.ok(app.hasRoute({ method: 'POST', url: '/api/images/inspect' }));
  } finally {
    await app.close();
  }
}
// A fresh process with no executable search path must still import and use the
// plain package root. FFmpeg is an explicit backend chosen by the host.
const rootOnly = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
  import assert from 'node:assert/strict';
  import { createRequire } from 'node:module';
  import { createNexusImageService } from '@nexusmc-cn/nexusimage-node';
  const require = createRequire(import.meta.url);
  const input = Buffer.from(process.env.NEXUSIMAGE_CONSUMER_INPUT, 'base64');
  for (const create of [createNexusImageService, require('@nexusmc-cn/nexusimage-node').createNexusImageService]) {
    const metadata = await create().inspect(input);
    assert.equal(metadata.width, 2);
  }
`,
  ],
  {
    cwd: process.cwd(),
    env: { ...process.env, PATH: '', Path: '', NEXUSIMAGE_CONSUMER_INPUT: input.toString('base64') },
    encoding: 'utf8',
  },
);
assert.equal(rootOnly.status, 0, rootOnly.stderr || rootOnly.error?.message);
console.log('Consumer runtime: ESM/CJS roots, adapters, animation factory/injection, and root without FFmpeg passed.');
