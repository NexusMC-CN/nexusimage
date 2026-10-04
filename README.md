# NexusImage

NexusImage 是一个浏览器优先的 TypeScript 图片加载与优化封装，统一连接 `ImageDecoder`、`createImageBitmap`、`OffscreenCanvas`、`Blob`、`File`、`FileReader`、object URL、`canvas.toBlob()` 和内置 EXIF 解析。

## 安装

```bash
npm install nexusimage
```

## 基本用法

```ts
import { NexusImage } from 'nexusimage';

const asset = await NexusImage.load(file, { orientation: 'normalize' });
const processed = await NexusImage.process(asset, {
  resize: { width: 1600, fit: 'contain' },
  orientation: 'normalize',
  crop: { x: 0, y: 0, width: asset.metadata.width, height: asset.metadata.height },
  rotate: 90,
  flip: { horizontal: false, vertical: false },
});
const output = await NexusImage.encode(processed, {
  type: 'image/webp',
  quality: 0.82,
});

console.log(output.blob);
processed.dispose();
asset.dispose();
```

`load()`、`process()` 和 `encode()` 都是异步操作。`ImageDecoder` 不可用时会按顺序回退到 `createImageBitmap` 和 HTML image。可以通过 `NexusImage.getCapabilities()`、`canDecode()` 和 `canEncode()` 查询当前浏览器能力。核心包面向现代浏览器，不包含 Node.js polyfill。

## 资源限制和格式识别

默认会限制输入 64 MiB、输入和输出 100 MP、单边 16,384 像素以及输出 64 MiB。可以按操作覆盖限制：

```ts
const asset = await NexusImage.load(file, {
  limits: { maxInputBytes: 20 * 1024 * 1024, maxInputPixels: 40_000_000 },
});
```

超出限制会抛出 `NexusImageError`，其 `code` 为 `RESOURCE_LIMIT`。`detectImageFormat(bytes)` 可以识别 JPEG、PNG、WebP、GIF、AVIF、BMP、ICO 和 TIFF；实际识别到的 `format`、`mimeType` 和 `animated` 会出现在 `ImageMetadata` 中。

处理变换的顺序是：EXIF 方向归一化、`crop`、`rotate`、`flip`，最后执行 `resize` 和 `fit`。

所有返回的 asset 都拥有原生资源，使用完成后应调用 `dispose()`；`dispose()` 可以重复调用。

## 动画元数据

需要判断 GIF、动画 WebP 或动画 AVIF 时，可以使用独立的 `inspectAnimation()`。它只读取 `ImageDecoder` 的 track 元数据，不会改变 `NexusImage.load()` 默认处理首帧的行为：

```ts
import { inspectAnimation } from 'nexusimage';

const animation = await inspectAnimation(file);
console.log(animation.animated, animation.frameCount, animation.duration);
```

动画元数据查询要求浏览器提供 `ImageDecoder`；不支持时会返回 `UNSUPPORTED`，静态图片仍可通过普通加载回退链路处理。

## EXIF

内置解析器支持方向、相机和镜头信息、拍摄时间、曝光参数、焦距、分辨率和 GPS 经纬度等常用字段。解析异常不会阻塞图片加载，会通过 `diagnostics` 保留错误信息。导出 Canvas 图片不会自动保留原始 EXIF，需要业务层自行保存或重新写入元数据。

## 开发

```bash
npm install
npm test
npm run typecheck
npm run build
npm run pack:check
npm run test:browser:playwright
```

`test:browser:playwright` 会在 Chromium、Firefox 和 WebKit 中运行基础加载、缩放和编码流程。CI 使用 Node.js 20/22 运行单元测试，并在三个浏览器中执行兼容性测试。发布 `v*.*.*` 标签时，GitHub Actions 会在 `NPM_TOKEN` secret 可用的前提下执行 provenance npm 发布。

## 许可

MIT
