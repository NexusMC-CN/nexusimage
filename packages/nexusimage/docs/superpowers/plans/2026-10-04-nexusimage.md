# NexusImage 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）来跟踪进度。

**目标：** 构建一个浏览器优先的 TypeScript npm 包，统一封装图片输入、EXIF 解析、原生解码器、canvas 处理和 Blob 导出。

**架构：** 公共 `NexusImage` 服务只处理稳定的输入、元数据和结果类型；内部通过 source、EXIF、decode、render、encode 适配器连接浏览器原生能力。所有原生资源通过幂等 `dispose()` 管理，解码顺序为 `ImageDecoder`、`createImageBitmap`、HTML image。

**技术栈：** TypeScript、tsup、Vitest、现代浏览器 API（ImageDecoder、createImageBitmap、ImageBitmap、OffscreenCanvas、HTMLCanvasElement、Blob、FileReader、URL.createObjectURL）。

---

## 文件结构

- 创建：`package.json`、`tsconfig.json`、`tsup.config.ts`、`vitest.config.ts`、`.gitignore`、`README.md`
- 创建：`src/index.ts`、`src/types.ts`、`src/errors.ts`、`src/capabilities.ts`
- 创建：`src/source.ts`、`src/exif/parser.ts`、`src/exif/tags.ts`
- 创建：`src/decode/adapter.ts`、`src/decode/image-decoder.ts`、`src/decode/image-bitmap.ts`、`src/decode/html-image.ts`、`src/decode/select.ts`
- 创建：`src/render/surface.ts`、`src/render/transform.ts`、`src/encode/to-blob.ts`
- 创建：`tests/types.test.ts`、`tests/source.test.ts`、`tests/exif.test.ts`、`tests/decode.test.ts`、`tests/render.test.ts`、`tests/encode.test.ts`、`tests/service.test.ts`
- 创建：`tests/fixtures.ts`（导出最小 JPEG/EXIF 字节 fixture 工厂）

## 任务 1：初始化 npm 与测试工具链

**文件：**
- 创建：`package.json`、`tsconfig.json`、`tsup.config.ts`、`vitest.config.ts`、`.gitignore`
- 创建：`tests/smoke.test.ts`

- [ ] **步骤 1：编写失败的包入口测试**

```ts
import { describe, expect, it } from 'vitest';
import { NexusImage } from '../src/index';

describe('package entrypoint', () => {
  it('exports the public service and capability query', () => {
    expect(typeof NexusImage.load).toBe('function');
    expect(typeof NexusImage.getCapabilities).toBe('function');
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test -- --run tests/smoke.test.ts`

预期：FAIL，提示 `src/index.ts` 不存在。

- [ ] **步骤 3：编写最小工具链和占位入口**

将 `package.json` 的 `name` 设为 `nexusimage`，使用 `type: module`，脚本包含 `build`、`typecheck`、`test`、`test:watch` 和 `pack:check`。配置 `tsup` 输出 `dist/index.js`、`dist/index.cjs` 与声明文件，并在 `src/index.ts` 先导出临时 `NexusImage` 对象。

- [ ] **步骤 4：运行测试与构建验证通过**

运行：`npm install`、`npm test -- --run tests/smoke.test.ts`、`npm run typecheck`、`npm run build`

预期：测试通过、类型检查退出码为 0、`dist/` 生成 ESM/CJS 与 `.d.ts`。

## 任务 2：定义公共类型、错误模型和能力检测

**文件：**
- 修改：`src/index.ts`
- 创建：`src/types.ts`、`src/errors.ts`、`src/capabilities.ts`
- 创建：`tests/types.test.ts`

- [ ] **步骤 1：编写失败测试**

```ts
import { expect, it } from 'vitest';
import { NexusImageError } from '../src/errors';
import { getCapabilities } from '../src/capabilities';

it('creates a discriminable error with stage and cause', () => {
  const cause = new Error('decode failed');
  const error = new NexusImageError('DECODE_FAILED', 'decode', 'cannot decode', cause);
  expect(error.name).toBe('NexusImageError');
  expect(error.code).toBe('DECODE_FAILED');
  expect(error.stage).toBe('decode');
  expect(error.cause).toBe(cause);
});

it('reports capabilities without touching browser globals that are missing', () => {
  expect(getCapabilities()).toMatchObject({
    imageDecoder: expect.any(Boolean),
    createImageBitmap: expect.any(Boolean),
    htmlImage: expect.any(Boolean),
    offscreenCanvas: expect.any(Boolean),
    canvasToBlob: expect.any(Boolean),
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test -- --run tests/types.test.ts`

预期：FAIL，提示错误类和能力函数未导出。

- [ ] **步骤 3：实现类型与能力检测**

在 `types.ts` 定义规格中的 `ImageSource`、选项、元数据、能力、资产和编码结果。`errors.ts` 实现 `NexusImageError`，保留 `cause`。`capabilities.ts` 使用 `globalThis` 的安全探测，不在模块加载时访问 `window` 或 `document`。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test -- --run tests/types.test.ts`、`npm run typecheck`

预期：测试通过，类型检查退出码为 0。

## 任务 3：实现输入规范化与 object URL 生命周期

**文件：**
- 创建：`src/source.ts`
- 修改：`src/types.ts`、`src/errors.ts`
- 创建：`tests/source.test.ts`

- [ ] **步骤 1：编写失败测试**

```ts
import { expect, it, vi } from 'vitest';
import { normalizeSource } from '../src/source';

it('keeps Blob metadata and releases a created object URL once', async () => {
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: revoke });
  const result = await normalizeSource(new Blob(['image'], { type: 'image/jpeg' }));
  expect(result.blob.type).toBe('image/jpeg');
  result.dispose();
  result.dispose();
  expect(revoke).toHaveBeenCalledTimes(1);
});

it('rejects unsupported or empty input with INVALID_SOURCE', async () => {
  await expect(normalizeSource(new Blob())).rejects.toMatchObject({ code: 'INVALID_SOURCE' });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test -- --run tests/source.test.ts`

预期：FAIL，提示 `normalizeSource` 未定义。

- [ ] **步骤 3：实现规范化**

支持 `Blob`/`File`、`ArrayBuffer`、`Uint8Array` 和 URL 字符串/对象。对 URL 使用 `fetch` 和 `AbortSignal`，对 Blob 优先使用 `arrayBuffer()`，在缺少该方法时通过 `FileReader` 回退。只有实际创建 object URL 时才登记撤销动作，`dispose` 必须幂等；先检查取消信号，再执行读取。

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test -- --run tests/source.test.ts`、`npm run typecheck`

预期：所有 source 测试通过，类型检查退出码为 0。

## 任务 4：实现 EXIF 解析与方向变换数学

**文件：**
- 创建：`src/exif/tags.ts`、`src/exif/parser.ts`
- 创建：`tests/exif.test.ts`

- [ ] **步骤 1：编写失败测试**

```ts
import { expect, it } from 'vitest';
import { parseExif } from '../src/exif/parser';
import { fixtureWithOrientation6AndDate } from './fixtures';

it('reads little-endian EXIF orientation 6 and common fields', () => {
  const bytes = fixtureWithOrientation6AndDate();
  expect(parseExif(bytes)).toMatchObject({
    orientation: 6,
    exif: { DateTimeOriginal: expect.any(String) },
  });
});

it('returns orientation 1 for non-JPEG or missing EXIF', () => {
  expect(parseExif(new Uint8Array([0, 1, 2]))).toMatchObject({ orientation: 1, exif: {} });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test -- --run tests/exif.test.ts`

预期：FAIL，提示 `parseExif` 未定义。

- [ ] **步骤 3：实现解析器**

扫描 JPEG SOI 后的 APP1 段，验证 `Exif\\0\\0`，识别 `II`/`MM` 字节序和 TIFF IFD。实现 SHORT、LONG、RATIONAL、ASCII 的有限读取，解析 Orientation、DateTimeOriginal、Make、Model、PixelXDimension、PixelYDimension；遇到损坏字段时返回默认 orientation 并附带 `EXIF_FAILED` 诊断信息，不阻塞主流程。

- [ ] **步骤 4：实现方向尺寸计算并写断言**

在 `src/render/transform.ts` 导出内部纯函数，确认 orientation 5-8 会交换目标宽高，1-4 保持宽高；对 `contain`、`cover`、`fill` 分别断言目标矩形。

- [ ] **步骤 5：运行测试验证通过**

运行：`npm test -- --run tests/exif.test.ts tests/render.test.ts`

预期：EXIF、方向和尺寸计算测试全部通过。

## 任务 5：实现解码适配器与选择顺序

**文件：**
- 创建：`src/decode/adapter.ts`、`src/decode/image-decoder.ts`、`src/decode/image-bitmap.ts`、`src/decode/html-image.ts`、`src/decode/select.ts`
- 创建：`tests/decode.test.ts`

- [ ] **步骤 1：编写失败测试**

```ts
import { expect, it, vi } from 'vitest';
import { selectDecoder } from '../src/decode/select';

it('uses ImageDecoder before createImageBitmap in auto mode', () => {
  const decoder = selectDecoder({ imageDecoder: true, createImageBitmap: true, htmlImage: true }, 'auto');
  expect(decoder.name).toBe('image-decoder');
});

it('throws UNSUPPORTED for an explicitly unavailable decoder', () => {
  expect(() => selectDecoder({ imageDecoder: false, createImageBitmap: false, htmlImage: false }, 'image-decoder'))
    .toThrowError(expect.objectContaining({ code: 'UNSUPPORTED' }));
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test -- --run tests/decode.test.ts`

预期：FAIL，提示选择器和适配器未定义。

- [ ] **步骤 3：实现三个适配器**

统一返回内部 `DecodedImage`：宽高、`draw(context, rect)` 和幂等 `dispose`。`ImageDecoder` 使用 `Blob.arrayBuffer()` 创建 decoder、解码第 0 帧并关闭 decoder；`createImageBitmap` 使用 object URL 或 Blob；HTML image 回退设置 `decoding = 'async'`、监听 load/error，并在 dispose 中移除元素引用。

- [ ] **步骤 4：实现回退与取消**

`auto` 模式按 `ImageDecoder` → `createImageBitmap` → HTML image 选择；适配器执行失败时继续尝试下一个并聚合错误。显式模式不回退。所有等待点都检查 `AbortSignal`，取消抛出 `ABORTED`。

- [ ] **步骤 5：运行测试验证通过**

运行：`npm test -- --run tests/decode.test.ts`、`npm run typecheck`

预期：选择顺序、显式能力错误、回退和 dispose 测试通过。

## 任务 6：实现 canvas 表面、处理和 Blob 编码

**文件：**
- 创建：`src/render/surface.ts`、`src/render/transform.ts`、`src/encode/to-blob.ts`
- 创建：`tests/render.test.ts`、`tests/encode.test.ts`

- [ ] **步骤 1：编写失败测试**

```ts
import { expect, it, vi } from 'vitest';
import { createSurface } from '../src/render/surface';
import { encodeSurface } from '../src/encode/to-blob';

it('prefers OffscreenCanvas and preserves requested dimensions', () => {
  const surface = createSurface({ width: 320, height: 180 }, { offscreenCanvas: true, canvasToBlob: true });
  expect(surface.width).toBe(320);
  expect(surface.height).toBe(180);
});

it('passes MIME type and quality to toBlob', async () => {
  const toBlob = vi.fn((_type: string, _quality: number, cb: (blob: Blob) => void) => cb(new Blob(['x'], { type: 'image/webp' })));
  const result = await encodeSurface({ toBlob } as never, { type: 'image/webp', quality: 0.8 });
  expect(toBlob).toHaveBeenCalledWith('image/webp', 0.8, expect.any(Function));
  expect(result.type).toBe('image/webp');
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test -- --run tests/render.test.ts tests/encode.test.ts`

预期：FAIL，提示 surface 和 encoder 未定义。

- [ ] **步骤 3：实现 surface 与 transform**

`createSurface` 优先构造 `OffscreenCanvas`，否则创建 HTML canvas；校验 2D context。`drawTransformedImage` 处理透明背景、fit 矩形、orientation 旋转/翻转和目标尺寸，避免使用未稳定的 viewport 计算。

- [ ] **步骤 4：实现 toBlob 封装**

`encodeSurface` 校验 MIME 与 quality 范围（quality 只接受 `0..1`），将 callback 式 `toBlob` 包装成 Promise；`null` 结果抛出 `ENCODE_FAILED`，取消时释放 surface。

- [ ] **步骤 5：运行测试验证通过**

运行：`npm test -- --run tests/render.test.ts tests/encode.test.ts`、`npm run typecheck`

预期：canvas 回退、矩形计算、orientation 变换和导出参数测试通过。

## 任务 7：接通 NexusImage 服务、文档和集成验证

**文件：**
- 修改：`src/index.ts`
- 创建：`tests/service.test.ts`、`README.md`
- 修改：`package.json` 的 `files`、`exports` 和 `sideEffects`

- [ ] **步骤 1：编写失败的公共服务测试**

```ts
import { expect, it } from 'vitest';
import { NexusImage } from '../src/index';
import { jpegFixture } from './fixtures';

it('loads, processes, and encodes a Blob through the public service', async () => {
  const asset = await NexusImage.load(new Blob([jpegFixture()], { type: 'image/jpeg' }));
  expect(asset.metadata.mimeType).toBe('image/jpeg');
  const processed = await NexusImage.process(asset, { resize: { width: 64 }, orientation: 'normalize' });
  const encoded = await NexusImage.encode(processed, { type: 'image/webp', quality: 0.82 });
  expect(encoded.blob.type).toBe('image/webp');
  asset.dispose();
  processed.dispose();
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test -- --run tests/service.test.ts`

预期：FAIL，提示服务仍为占位实现。

- [ ] **步骤 3：实现服务编排**

`NexusImage.load` 规范化 source、解析 EXIF、选择解码器并创建内部资产；`inspect` 复用 load 后立即 dispose；`process` 接收 source 或资产，创建 surface、绘制并返回隐藏内部句柄的 `ProcessedImage`；`encode` 取出句柄，导出 Blob 并返回结果。用 WeakMap 保存公共对象到内部句柄的映射，防止把原生对象暴露给调用者。

- [ ] **步骤 4：补充 README 与包出口**

README 写明浏览器优先定位、安装命令、最小 load/process/encode 示例、能力探测和 dispose 约定。`package.json` 只发布 `dist` 和许可证/README，声明 `types`、`import`、`require` 三个出口。

- [ ] **步骤 5：运行完整验证**

运行：`npm test -- --run`、`npm run typecheck`、`npm run build`、`npm run pack:check`

预期：Node 测试全部通过，类型检查和构建退出码为 0，`npm pack --dry-run` 只包含 `dist`、README、LICENSE 和 package.json。

## 计划自检

- 规格中的输入、能力顺序、EXIF、canvas、编码、错误和生命周期均有对应任务。
- 已扫描计划，没有 `TODO`、`待定` 或“添加适当处理”式占位描述。
- 公共类型在任务 2 定义，source、EXIF、decode、render、encode 和 service 的依赖顺序一致。
- 计划不包含动画、滤镜、网络缓存或 Node polyfill，和规格范围一致。
