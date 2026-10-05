# NexusImage

NexusImage 是一套图片加载、处理和优化能力，按运行时拆成两个可独立发布的 npm 包：

```text
packages/
  browser/  # 浏览器优先：Canvas、OffscreenCanvas、ImageDecoder、EXIF
  server/   # Node.js：SharpImageEngine、Fastify multipart/raw body 适配器
```

浏览器包通过 `nexusimage/contracts` 暴露运行时无关的类型、错误码、格式识别、资源限制和 EXIF 契约。服务端包只依赖这个契约入口与 Sharp，不加载浏览器适配器。浏览器包还提供 `NexusImage.probe()`，用于在无法读取跨域字节时仅探测图片尺寸。

## 开发

在仓库根目录执行：

```bash
npm run test:ci
```

也可以单独验证：

```bash
npm run test:ci --prefix packages/browser
npm run test:ci --prefix packages/server
npm run test:browser:playwright --prefix packages/browser
```

服务端包的 Fastify 插件提供 `POST /api/images/inspect` 和 `POST /api/images/process`，支持 multipart 与原始图片字节，并负责包内资源上限和输出回收。认证、限流、统一错误 envelope、对象存储、异步任务和缓存由主 Fastify 应用提供；插件通过 `errorMapper` 与宿主错误协议对接。

## 发布

- `vX.Y.Z` 发布 `nexusimage` 浏览器包。
- `node-vX.Y.Z` 发布 `@nexusimage/node`。

两个包各自维护 `package-lock.json`，服务端包在本地开发时通过 `file:../browser` 使用兄弟目录的浏览器包；正式安装使用 `nexusimage` peer dependency。
