# Changelog

All notable changes to `awesome-os/chromium-baseline` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Canonical verbatim SPDX `LICENSE` for deterministic GitHub Licensee detection.
- `.gitattributes` enforcing consistent LF/CRLF and binary handling across Windows and POSIX.
- `.github/CODEOWNERS` governance and workflow ownership rules.
- `CHANGELOG.md` initialized in Keep a Changelog v1.1.0 format for release traceability.

## [11.0.0] - 2026-11-26

### Changed
- Unified Chromium `160` & V8 `16.0.88+` shared-library baseline (`dup_v8 = 0 B`) aligning Sectium, Brave, Electron, Blink, Skia, Dawn, `libuv`, Node, Deno, Bun-Neon, `lo`, and `just-js`.
- Added `inmem-linker`, `v11-chromium-baseline-latest` native release workflow, `holo-ci@v1`, and Holo-E2E Lavapipe Zero-X11 verification.
