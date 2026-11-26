# `awesome-os/chromium-baseline` — Agent Operating Contract (`AGENTS.md`)

1. **Zero Legacy Ghost / v1 CAS References:** All CAS hydration, manifests, and lockfiles MUST target `awesome-os/holo-v11` (`cas-v11`) and read `$B8G_CAS_DIR`.
2. **Single Shared V8 (`16.0.88+`, `dup_v8 = 0 B`):** All 8 consumers (`sectium`, `electron`, `brave`, `node`, `deno`, `bun-neon`, `lo`, `just-js`) MUST remain pinned to `components/libv8_monolith/`.
3. **Shared `v11` C/C++ Library Layer:** Keep `openssl 4.1.0`, `harfbuzz 15.2.0`, `zstd 1.6.0`, `zlib-ng 2.3.3`, `libuv 1.53.0`, `vulkan 1.4.369`, `ada 4.1.1`, and `mimalloc 3.7.1` aligned across Chromium components and `components/angrybird/`.
4. **Strict Erasable TypeScript:** All `.mts` files execute directly on Node 22+ with `erasableSyntaxOnly: true` (no `enum`, `namespace`, or parameter properties).
5. **Verification Gates:** Before finishing any change, run `npm test`, C11/C++23 tests in `components/angrybird/`, and `b8g-web-doc.ps1 README.md`.
