# Changelog

## Unreleased

- Add the optional `/ffmpeg` animation engine and explicit service `transcodeAnimation()` API for animated GIF, WebP and AVIF.
- Enforce input and output animation budgets, cancellation and output frame, timing and dimension checks; preserve existing first-frame processing.
- Reject AVIF output when decoded frames contain transparency and report unavailable runtime binary or codec capabilities.

## 0.1.2

- Fix published ESM and CommonJS declarations for NodeNext and Node16 consumers.
- Mark the Fastify peer optional for applications using only the framework-neutral service.
- Align the minimum Node.js version with Sharp's Node.js 20.9.0 requirement.
- Declare the MIT license and add package descriptions, search keywords, documentation and issue links.

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
