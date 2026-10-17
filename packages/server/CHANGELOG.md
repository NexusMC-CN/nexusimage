# Changelog

## 0.1.1

- Normalize EXIF orientation reported by Sharp for non-JPEG inputs.
- Copy Uint8Array and ArrayBuffer inputs so buffer reuse cannot change loaded assets or bypass input limits.
- Inspect only the first animation frame to match processing and avoid applying pixel limits to stacked frames.

## 0.1.0

- Added the framework-neutral `NexusImageService` facade and factory for
  non-Fastify Node hosts.
- Kept processed images alive when encoding fails so callers can retry.
- Shared the minimum encoded image contract with the browser package.
- Added the Sharp-based Node image engine.
- Added shared NexusImage metadata, format, EXIF, error, and resource-limit contracts.
- Added the optional Fastify multipart inspection and processing routes.
