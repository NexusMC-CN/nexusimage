# NexusImage 设计规格

## 目标

初始化一个名为 `nexusimage` 的 TypeScript npm 包，对浏览器原生图片能力做统一封装，为图片读取、解码、EXIF 解析、尺寸处理、压缩和导出提供稳定的异步 API。

首版运行时定位为现代浏览器。Node.js 只运行不依赖浏览器对象的纯逻辑测试，不在核心包内提供 Node polyfill。

## 设计边界

- 支持输入：`Blob`、`File`、`ArrayBuffer`、`Uint8Array`、字符串 URL 和 `URL` 对象。
- 支持读取：统一规范化为 `Blob`，读取 `FileReader`、`Blob.arrayBuffer()` 和 `fetch` URL 的差异。
- 支持解码：按能力选择 `ImageDecoder`、`createImageBitmap`、`HTMLImageElement`。
- 支持画布：优先 `OffscreenCanvas`，否则使用 `HTMLCanvasElement`。
- 支持处理：尺寸调整、`fit` 模式、透明背景、EXIF orientation 归一化。
- 支持导出：`canvas.toBlob(type, quality)`，返回包含 `Blob` 与元数据的结果。
- 支持 EXIF：内置轻量 JPEG APP1/TIFF 解析器，不引入第三方 EXIF 依赖。
- 所有异步操作接受可选 `AbortSignal`，取消时释放已创建的 object URL、bitmap 和 canvas 资源。
- 不承诺 GIF/WebP 动画逐帧处理；首版处理静态图像的第一帧。

## 公共 API

入口从 `src/index.ts` 导出以下类型和服务：

```ts
export interface LoadOptions {
  decode?: 'auto' | 'image-decoder' | 'create-image-bitmap' | 'html-image';
  orientation?: 'preserve' | 'normalize';
  signal?: AbortSignal;
}

export interface ProcessOptions {
  resize?: {
    width?: number;
    height?: number;
    fit?: 'contain' | 'cover' | 'fill';
  };
  background?: string;
  orientation?: 'preserve' | 'normalize';
  signal?: AbortSignal;
}

export interface EncodeOptions {
  type?: string;
  quality?: number;
  signal?: AbortSignal;
}

export type ImageSource = Blob | File | ArrayBuffer | Uint8Array | string | URL;

export interface ImageCapabilities {
  imageDecoder: boolean;
  createImageBitmap: boolean;
  htmlImage: boolean;
  offscreenCanvas: boolean;
  canvasToBlob: boolean;
}

export interface ImageMetadata {
  width: number;
  height: number;
  mimeType: string;
  size: number;
  orientation: number;
  exif: Readonly<Record<string, string | number>>;
}

export interface ImageAsset {
  readonly metadata: ImageMetadata;
  dispose(): void;
}

export interface ProcessedImage {
  readonly width: number;
  readonly height: number;
  readonly metadata: ImageMetadata;
  dispose(): void;
}

export interface EncodedImage {
  readonly blob: Blob;
  readonly type: string;
  readonly width: number;
  readonly height: number;
}

export declare const NexusImage: {
  load(source: ImageSource, options?: LoadOptions): Promise<ImageAsset>;
  inspect(source: ImageSource, options?: { signal?: AbortSignal }): Promise<ImageMetadata>;
  process(source: ImageSource | ImageAsset, options?: ProcessOptions): Promise<ProcessedImage>;
  encode(image: ProcessedImage, options?: EncodeOptions): Promise<EncodedImage>;
  getCapabilities(): ImageCapabilities;
};
```

`ImageAsset` 和 `ProcessedImage` 不暴露具体的 `ImageBitmap`、`HTMLImageElement` 或 canvas 类型。调用者通过 `process` 和 `encode` 取得结果，适配器可以在不改变公共类型的情况下替换实现。

## 内部模块

```text
src/
  index.ts                 # 公共导出与 NexusImage 服务
  types.ts                 # 输入、选项、元数据、错误和能力类型
  errors.ts                # NexusImageError 与错误码
  capabilities.ts          # 浏览器能力检测
  source.ts                # ImageSource 规范化、FileReader、object URL 生命周期
  exif/
    parser.ts              # JPEG APP1/TIFF EXIF 解析
    tags.ts                # 支持的 EXIF tag 常量
  decode/
    adapter.ts             # 解码适配器接口与统一结果
    image-decoder.ts       # ImageDecoder 适配器
    image-bitmap.ts        # createImageBitmap 适配器
    html-image.ts          # HTMLImageElement 回退适配器
    select.ts              # 按能力选择适配器
  render/
    surface.ts             # OffscreenCanvas / HTMLCanvasElement 适配器
    transform.ts           # resize、fit、orientation 绘制
  encode/
    to-blob.ts             # canvas.toBlob(type, quality) 封装
```

适配器接口只在内部使用：解码器返回宽高、绘制函数和 `dispose`；画布表面负责尺寸、绘制和释放；编码器把表面转换为 `Blob`。每个拥有原生资源的对象必须实现幂等 `dispose()`。

## 数据流

1. `source` 将输入规范化为 `Blob`，记录 MIME、大小和可撤销的 object URL。
2. `exif/parser` 读取 JPEG 前缀中的 APP1 段，解析 orientation 与已声明的常用字段；非 JPEG 或缺失 EXIF 时返回默认 orientation `1`。
3. `decode/select` 按显式选项或自动顺序选择解码器。`ImageDecoder` 失败时只在 `auto` 模式回退下一个适配器，显式模式直接返回错误。
4. `render/transform` 创建 `OffscreenCanvas` 或 HTML canvas，按 `contain`、`cover` 或 `fill` 计算目标矩形，并在 `normalize` 模式应用 orientation 变换。
5. `encode/to-blob` 调用 `canvas.toBlob(type, quality)`，校验结果非空，返回 `EncodedImage`。
6. 任一步骤抛错、取消或完成后，释放 object URL、decoder、bitmap、image element 和 canvas 资源。

## 错误模型

`NexusImageError` 携带 `code`、`stage` 和可选 `cause`：

| code | stage | 含义 |
| --- | --- | --- |
| `INVALID_SOURCE` | source | 输入类型不支持或 Blob 为空 |
| `ABORTED` | source / decode / render / encode | 操作被 `AbortSignal` 取消 |
| `UNSUPPORTED` | capability / decode / render | 当前浏览器缺少所需能力 |
| `DECODE_FAILED` | decode | 所有可用解码器都无法解码 |
| `EXIF_FAILED` | exif | EXIF 数据损坏；默认元数据仍可继续时不抛出 |
| `RENDER_FAILED` | render | canvas 创建或绘制失败 |
| `ENCODE_FAILED` | encode | `toBlob` 未返回有效 Blob |

错误对象不泄漏底层适配器实例，但通过 `cause` 保留原始异常以便调试。

## 测试与验证

- 纯 Node 测试：EXIF 字节序、JPEG APP1 解析、方向矩阵、resize/fit 计算、能力选择、错误码和 `dispose` 幂等性。
- 浏览器测试：`ImageDecoder`、`createImageBitmap`、HTML image 回退、OffscreenCanvas 回退、`toBlob` MIME/quality、AbortSignal 与 object URL 释放。
- 构建验证：TypeScript 类型检查、ESM/CJS 双格式构建、npm 包内容检查。
- API 约束：测试不得依赖具体适配器类名，只验证公共类型、结果和资源释放行为。

首版完成标准是：核心包可安装、可被现代浏览器导入，静态图像可从上述输入类型加载，支持 orientation 归一化与尺寸处理，并能导出指定 MIME 的 Blob；不包含动画逐帧编辑、滤镜、网络缓存和 Node polyfill。
