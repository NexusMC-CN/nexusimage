# @nexusimage/node

NexusImage 的 Node.js 运行时适配包。它使用 `sharp` 完成图片解码、EXIF
元数据读取、图像变换和编码，同时让浏览器包保持轻量并且不依赖 Node.js。

## 安装

```sh
npm install @nexusimage/node nexusimage
```

本包要求 Node.js 20 或更高版本。`nexusimage` 是共享契约的 peer dependency，
`sharp` 是默认的原生图片处理引擎。

## 与框架无关的服务

Node 端的主要 API 是进程内服务，不要求使用 Fastify 或其他 HTTP 服务器：

```ts
import { createNexusImageService } from '@nexusimage/node';

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
import { createSharpImageEngine } from '@nexusimage/node';

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
远程 URL 与文件系统路径由宿主应用负责处理，以便宿主统一执行认证、SSRF
防护和存储限制。

`inspect()` 会返回图片格式、尺寸、动画状态和已解析的 EXIF 元数据。普通的
`process()` 流程只处理动画图片的首帧；存储、队列、缓存和请求策略仍属于平台职责。

## Fastify 适配器

可选的 Fastify 适配器通过独立入口导出：

```ts
import Fastify from 'fastify';
import nexusImageFastify from '@nexusimage/node/fastify';

const app = Fastify();
await app.register(nexusImageFastify, {
  // `service` 可选；省略时适配器会创建默认服务。
  // service: createNexusImageService(),
  limits: { maxInputBytes: 32 * 1024 * 1024 },
});
```

使用此入口时需要安装 Fastify。multipart 解析器和插件运行时依赖已包含在
`@nexusimage/node` 中：

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
