# AngryBird — Sovereign 18/18 C++23 Web Engine (`components/angrybird/`)

> Spun out from our `awesome-os/ladybird` **18/18 Chrome Feature-Parity** hard-fork (`0` Blink/Gecko/WebKit code) and unified onto the **`holo-v11`** shared C/C++ CAS library layer alongside Chromium 160 (`B8G_ABI_MAGIC_V3 = 0x33564742`).

## Core Capabilities & Chrome Parity (`18 / 18`)

- **`18 / 18` Chrome Parity Matrix (`0` missing, `0` early-stub):** Verified by [`docs/chrome-parity-scan.json`](docs/chrome-parity-scan.json) and [`CHROME-PARITY-GAP-ANALYSIS.md`](CHROME-PARITY-GAP-ANALYSIS.md) across `42` scanned libraries and `775` WebIDL interfaces.
- **LibJS `HoloHotLoopJIT` ([`Libraries/LibJS/JIT/HoloHotLoopJIT.h`](Libraries/LibJS/JIT/HoloHotLoopJIT.h), [`HoloHotLoopJIT.cpp`](Libraries/LibJS/JIT/HoloHotLoopJIT.cpp)):** Hot-loop tier-up at `N = 100` invocations with 4-way unrolled superscalar `f64` accumulation kernels.
- **LibWasm `SIMD128` ([`Libraries/LibWasm/SIMD/Simd128.h`](Libraries/LibWasm/SIMD/Simd128.h), [`Simd128.cpp`](Libraries/LibWasm/SIMD/Simd128.cpp)):** 16-byte aligned 128-bit vector lanes (`i32x4_splat`, `i32x4_add`, `f32x4_mul_add`).
- **Native `uBlock` MV3 Blocker ([`Extensions/WebExtensionsMV3.h`](Extensions/WebExtensionsMV3.h)):** Zero-allocation `B8gContentBlocker` supporting EasyList/uBlock `||domain^` network anchor rules.
- **RFC 9460 DNS `HTTPS` (`TYPE 65`) Parser ([`b8g_ladybird_bridges.c`](b8g_ladybird_bridges.c)):** Wire RDATA parser extracting `h3`/`h2` ALPNs, SVCB port, and ECH config length.
- **WebGPU/Dawn, OPFS `v11` CAS, WebCodecs & DMABUF Fallback:**
  - `B8gWebGpuRing` (64-byte aligned `B8G_ABI_MAGIC_V3` ring -> `components/dawn` + `holo-display-webgpu`)
  - `B8gOpfsCasHandle` (path-traversal-hardened `v11/files/<aa>/<digest>` CAS mapping)
  - `B8gWebCodecsSession` (modalias router for `vulkan-video`, `vaapi`, `nvdec`, `videotoolbox`, `apple-avd`)
  - Null-guarded `EGL_EXT_image_dma_buf_import_modifiers` & `EGL_NO_IMAGE` CPU fallback (see [`UPSTREAM-ISSUES-RADAR.md`](UPSTREAM-ISSUES-RADAR.md)).

## Shared `v11` CAS Library Alignment

Via [`Meta/CMake/holo_v11_toolchain.cmake`](Meta/CMake/holo_v11_toolchain.cmake), AngryBird resolves shared `v11` C/C++ libraries from `$B8G_CAS_DIR/v11/links` (eliminating duplicate builds and system ICU mismatches):

| Library | Shared `v11` Version | Shared With |
| :--- | :--- | :--- |
| `openssl` | `4.1.0` | Chromium components, Node, Deno, Bun-Neon, AngryBird |
| `harfbuzz` | `15.2.0` | Blink, Skia, AngryBird |
| `zstd` | `1.6.0` | Holo `v11` CAS, Sectium, Electron, Brave, AngryBird |
| `zlib-ng` | `2.3.3` | Blink, Skia, Node, Bun-Neon, AngryBird |
| `libuv` | `1.53.0` | Node, Deno, lo, just-js, `components/libuv` |
| `vulkan` | `1.4.369` | Dawn, Skia, AngryBird |
| `ada` | `4.1.1` | Node, lo, Chromium URL, AngryBird |
| `mimalloc` | `3.7.1` | Bun-Neon, Holo `v11`, AngryBird |

## Build & Test

```sh
# C11 bridge tests
cc -std=c11 -O2 -Wall -Wextra -Werror components/angrybird/b8g_ladybird_bridges.c components/angrybird/bridge_test.c -o bridge_test
./bridge_test

# C++23 AngryBird engine tests (compile C11 bridge first, then link C++23)
cc -std=c11 -O2 -Wall -Wextra -Werror -c components/angrybird/b8g_ladybird_bridges.c -o b8g_ladybird_bridges.o
g++ -std=c++23 -O2 -Wall -Wextra -Werror -Icomponents/angrybird \
  components/angrybird/cpp_engine_test.cpp \
  components/angrybird/Libraries/LibJS/JIT/HoloHotLoopJIT.cpp \
  components/angrybird/Libraries/LibWasm/SIMD/Simd128.cpp \
  b8g_ladybird_bridges.o -o cpp_engine_test
./cpp_engine_test
```
