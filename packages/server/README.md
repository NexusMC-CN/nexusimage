# @nexusmc-cn/nexusimage-node

NexusImage 的 Node.js 运行时适配包。它使用 `sharp` 完成图片解码、EXIF
元数据读取、图像变换和编码，同时让浏览器包保持轻量并且不依赖 Node.js。

## 安装

```sh
npm install @nexusmc-cn/nexusimage-node @nexusmc-cn/nexusimage
```

本包要求 Node.js 20.9.0 或更高版本。`@nexusmc-cn/nexusimage` 是共享契约的 peer dependency，
`sharp` 是默认的原生图片处理引擎。

## 与框架无关的服务

Node 端的主要 API 是进程内服务，不要求使用 Fastify 或其他 HTTP 服务器：

```ts
import { createNexusImageService } from '@nexusmc-cn/nexusimage-node';

const service = createNexusImageService({
  engineOptions: { limits: { maxInputBytes: 32 * 1024 * 1024 } },
});

const metadata = await service.inspect(inputBuffer);
const processed = await service.process(inputBuffer, {
  resize: { width: 1200, fit: 'contain' },
  orientation: 'normalize',
});
const encoded = await service.encode(processed, {
  type: 'image/webp',
  quality: 0.82,
});
processed.dispose();
// encoded.buffer 是 Node.js Buffer。
```

当宿主需要管理共享引擎，或需要接入其他图片后端时，可以注入 `engine`。
服务门面不负责 HTTP 传输、错误 envelope、认证、存储、异步任务队列或缓存；
这些策略由宿主平台负责。

## 图片引擎

```ts
import { createSharpImageEngine } from '@nexusmc-cn/nexusimage-node';

const engine = createSharpImageEngine({
  limits: { maxInputBytes: 32 * 1024 * 1024 },
});

const processed = await engine.process(inputBuffer, {
  resize: { width: 1200, fit: 'contain' },
  orientation: 'normalize',
});

const result = await engine.encode(processed, {
  type: 'image/webp',
  quality: 0.82,
});

processed.dispose();
// result.buffer 是 Node.js Buffer。
```

支持的输入类型包括 `Buffer`、`Uint8Array`、`ArrayBuffer` 和 `Blob`/`File`。
引擎会复制传入的 `Buffer`、`Uint8Array` 和 `ArrayBuffer`，保留独立的输入快照；
调用开始后，调用方可以复用原缓冲区，已加载资产的内容和尺寸不会随之改变。
远程 URL 与文件系统路径由宿主应用负责处理，以便宿主统一执行认证、SSRF
防护和存储限制。

`inspect()` 会返回图片格式、尺寸、动画状态和已解析的 EXIF 元数据。普通的
`process()` 流程只处理动画图片的首帧；元数据读取也只选择首帧，并通过帧数识别
动画，输入尺寸和像素限制按该帧计算。存储、队列、缓存和请求策略仍属于平台职责。
编码失败不会销毁传入的 processed image；调用方可以换用其他输出格式重试，
并在最终完成后调用 `dispose()`。

### EXIF 方向与导出

`inspect()` 保留源图片方向。`process()` 默认按 Sharp 识别的 EXIF 方向归一化，
包括带方向信息的 JPEG、WebP、PNG 和 TIFF；可以设置 `orientation: 'preserve'`
保留原像素方向，此选项不表示保留文件中的 EXIF。

导出的图片默认移除 EXIF（包括 GPS）等原始元数据。返回对象中 `metadata.exif`
保留的是源图片已解析的信息，不表示这些字段已写入结果文件；目前共享 EXIF
字段解析器读取 JPEG，其他格式的方向使用 Sharp 返回的元数据。

## 可选的动画转码

需要显式处理所有帧时，从独立入口加载 FFmpeg 后端并注入服务：

```ts
import { createNexusImageService } from '@nexusmc-cn/nexusimage-node';
import { createFfmpegAnimationEngine } from '@nexusmc-cn/nexusimage-node/ffmpeg';

const animationEngine = createFfmpegAnimationEngine({
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  limits: { maxFrames: 60, maxProcessingMs: 30_000 },
});
const service = createNexusImageService({ animationEngine });
const abortController = new AbortController();
const result = await service.transcodeAnimation(inputBuffer, {
  type: 'image/webp',
  resize: { width: 320, height: 240, fit: 'contain' },
  background: '#FFFFFF',
  quality: 0.8,
  limits: { maxDurationMs: 10_000 },
  signal: abortController.signal,
});
// result.buffer 是 Buffer；type 是输出 MIME 类型。
// width、height、frameCount、durationMs 来自实际输出的探测结果。
```

不需要取消时可以省略 `signal`。
`ffmpegPath`、`ffprobePath` 和 `limits` 均可省略，命令名默认分别为 `ffmpeg` 和
`ffprobe`。宿主需要自行安装这些二进制程序；可用的解码器、编码器和格式支持取决于
运行时二进制的构建配置，安装 npm 包不代表具备所有转码能力。

`transcodeAnimation(input, options)` 接受与普通图片引擎相同的内存输入类型，要求输入为
至少两帧的 GIF、WebP 或 AVIF。`type` 必填，支持 `image/gif`、`image/webp` 和
`image/avif`。可选变换依次为 `crop`、`rotate`、`flip`、`resize`；`crop` 使用源图内的
整数像素矩形，`rotate` 必须为 90 度的整数倍。`resize` 使用正整数尺寸并支持
`contain`、`cover`、`fill`；`background` 仅接受严格的 `#RRGGBB` 颜色，用于
`contain` 的补边。`quality` 范围为 0 到 1，仅适用于 WebP 和 AVIF；GIF 不支持此选项。
实际包含透明像素的动画转为 AVIF 明确不受支持，设置 `background` 也不会解除此限制。
输出统一设为无限循环；输入原有的有限循环次数不会保留。`durationMs` 只表示一次播放周期。
AVIF 输入需要能唯一识别一条动画序列轨；含多条动画轨（例如某些辅助 alpha 轨）的文件
会以 `UNSUPPORTED` / `capability` 拒绝，无法识别序列轨的多轨文件会以
`DECODE_FAILED` / `decode` 拒绝。

此 API 不改变现有 `process()` / `encode()` 的首帧处理行为。服务未配置
`animationEngine` 时，调用会返回 `UNSUPPORTED` / `capability` 错误。

### 动画资源限制与错误

动画默认沿用输入与输出各 64 MiB、单帧输入与输出各 100,000,000 像素、宽高各
16,384 像素的限制，并增加以下预算：

| 限制              | 默认值                                                  |
| ----------------- | ------------------------------------------------------- |
| `maxFrames`       | 120 帧                                                  |
| `maxDurationMs`   | 30,000 毫秒（一个播放周期）                             |
| `maxTotalPixels`  | 200,000,000（宽 × 高 × 帧数）                           |
| `maxProcessingMs` | 60,000 毫秒（输入与透明度探测、转码和输出探测共用期限） |

在引擎工厂中设置宿主 `limits`；单次调用的 `limits` 只能进一步降低宿主上限。
输入、缩放中间帧与实际输出都会检查帧数、时长、尺寸和总像素；超限会拒绝整个操作，不返回截断的
动画，也不会退回首帧处理或其他格式。结果中的 `frameCount` 和 `durationMs` 表示
一个播放周期，输出帧数和时长也会与输入核对。

错误使用共享的 `NexusImageError`，宿主可读取 `code` 和 `stage`：

| 情况                                         | `code`           | `stage`                                     |
| -------------------------------------------- | ---------------- | ------------------------------------------- |
| 无效输入、非动画或无效限制                   | `INVALID_SOURCE` | `source`                                    |
| 输入字节超限                                 | `RESOURCE_LIMIT` | `source`                                    |
| 输入暂存、探测或解码失败                     | `DECODE_FAILED`  | `decode`                                    |
| 无效裁剪、旋转、翻转、缩放或颜色             | `RENDER_FAILED`  | `render`                                    |
| 无效输出类型、质量、输出读取、清理或校验失败 | `ENCODE_FAILED`  | `encode`                                    |
| 帧数、时长、像素或处理时间超限               | `RESOURCE_LIMIT` | 检查发生时的 `decode` / `encode`            |
| 输出字节超限                                 | `RESOURCE_LIMIT` | `encode`                                    |
| 缺少二进制、所需编解码能力或 AVIF alpha 支持 | `UNSUPPORTED`    | `capability`                                |
| 取消操作                                     | `ABORTED`        | 取消发生时的 `source` / `decode` / `encode` |

## Fastify 适配器

可选的 Fastify 适配器通过独立入口导出：

```ts
import Fastify from 'fastify';
import nexusImageFastify from '@nexusmc-cn/nexusimage-node/fastify';

const app = Fastify();
await app.register(nexusImageFastify, {
  // `service` 可选；省略时适配器会创建默认服务。
  // service: createNexusImageService(),
  limits: { maxInputBytes: 32 * 1024 * 1024 },
});
```

使用此入口时需要安装 Fastify。multipart 解析器和插件运行时依赖已包含在
`@nexusmc-cn/nexusimage-node` 中：

```sh
npm install fastify
```

适配器注册 `POST /api/images/inspect` 和 `POST /api/images/process`，接受
multipart 上传或原始图片字节，并返回编码后的图片。认证、限流、统一错误
envelope、持久化、异步任务和缓存由宿主应用负责；可以使用 `errorMapper`
接入宿主的错误响应协议。

multipart 处理时，文件字段名使用 `file`。处理选项可以作为 JSON 对象放在
`options`、`process` 或 `processOptions` 字段中；编码 MIME 类型和质量也可以
使用 `type` 与 `quality` 字段单独传入。原始 `image/*` 和
`application/octet-stream` 请求体默认按 Buffer 解析。如果应用已经注册了
multipart 解析器，可以设置 `registerMultipart: false`。

## 开发

```sh
npm test
npm run typecheck
npm run build
npm run pack:check
```
