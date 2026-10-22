# Changelog

## 0.2.2

- Initialize canvas contexts and fall back to HTML canvas when probing encoding support.
- Keep Git checkouts in LF format so Windows formatting and release checks match CI.

## 0.2.1

- Enforce URL input byte limits while downloading, cancelling oversized response streams.
- Preserve the source aspect ratio when resizing with only a target height.
- Fix published declarations for ESM and CommonJS consumers using NodeNext or Node16 resolution.
- Clarify package descriptions, search keywords, documentation and issue links.

## 0.2.0

- Added resource limits for input bytes, decoded pixels, output dimensions, encoded bytes, and URL fetch timeouts.
- Added image format detection and decode/encode capability queries.
- Added crop, arbitrary-angle rotation, and horizontal/vertical flip processing.
- Expanded EXIF parsing with camera, lens, exposure, and GPS metadata.
- Added animation track metadata inspection with an explicit first-frame processing policy.
- Added Chromium, Firefox, and WebKit Playwright coverage plus CI and provenance publish workflows.
- Added a lightweight `NexusImage.probe()` API for dimensions of CORS-blocked image URLs.
- Made capability queries conservative and added asynchronous codec probing.
- Kept processed images alive when encoding fails so callers can retry.
- Reused normalized source bytes across metadata parsing and decoder paths.
