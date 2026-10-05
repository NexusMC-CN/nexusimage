# Changelog

## 0.1.0

- Added the framework-neutral `NexusImageService` facade and factory for
  non-Fastify Node hosts.
- Kept processed images alive when encoding fails so callers can retry.
- Shared the minimum encoded image contract with the browser package.
- Added the Sharp-based Node image engine.
- Added shared NexusImage metadata, format, EXIF, error, and resource-limit contracts.
- Added the optional Fastify multipart inspection and processing routes.
