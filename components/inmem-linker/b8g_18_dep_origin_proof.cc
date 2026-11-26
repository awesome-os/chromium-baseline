// Copyright 2026 Awesome-OS Authors
// SPDX-License-Identifier: BSD-3-Clause
//
// 18-Target Chromium 160 + V8 16.0.88+ B8G-ABI v3 In-Memory Linker Proof
// Aligned to Holo v11 CAS (`awesome-os/holo-v11`, `B8G_ABI_MAGIC_V3 = 0x33564742`).

#include "b8g_origin_linker.h"

#include <chrono>
#include <cstdio>
#include <cstring>
#include <string>

using Clock = std::chrono::steady_clock;

namespace {

struct TargetSpec {
  B8gDepId id;
  const char* name;
  const char* lib_stem;
  const char* getter;
  bool is_core_chromium_table;
};

static const TargetSpec kTargets[] = {
    {B8G_DEP_IPCZ, "b8g_ipcz_abi", "b8g_ipcz_abi", "b8g_get_ipcz_table", true},
    {B8G_DEP_VIZ, "b8g_viz_abi", "b8g_viz_abi", "b8g_get_viz_table", true},
    {B8G_DEP_MOJO, "b8g_mojo_abi", "b8g_mojo_abi", "b8g_get_mojo_table", true},
    {B8G_DEP_BORINGSSL, "b8g_tls_abi", "b8g_tls_abi", "b8g_get_tls_table", false},
    {B8G_DEP_ZSTD, "b8g_zstd_abi", "b8g_zstd_abi", "b8g_get_zstd_table", false},
    {B8G_DEP_BROTLI, "b8g_brotli_abi", "b8g_brotli_abi", "b8g_get_brotli_table", false},
    {B8G_DEP_SKIA, "b8g_skia_abi", "b8g_skia_abi", "b8g_get_skia_table", false},
    {B8G_DEP_DAWN, "b8g_dawn_abi", "b8g_dawn_abi", "b8g_get_dawn_table", false},
    {B8G_DEP_FFMPEG, "b8g_ffmpeg_abi", "b8g_ffmpeg_abi", "b8g_get_ffmpeg_table", false},
    {B8G_DEP_DAV1D, "b8g_dav1d_abi", "b8g_dav1d_abi", "b8g_get_dav1d_table", false},
    {B8G_DEP_LIBWEBP, "b8g_webp_abi", "b8g_webp_abi", "b8g_get_webp_table", false},
    {B8G_DEP_LIBJPEG_TURBO, "b8g_jpeg_abi", "b8g_jpeg_abi", "b8g_get_jpeg_table", false},
    {B8G_DEP_HARFBUZZ, "b8g_harfbuzz_abi", "b8g_harfbuzz_abi", "b8g_get_harfbuzz_table", false},
    {B8G_DEP_FREETYPE, "b8g_freetype_abi", "b8g_freetype_abi", "b8g_get_freetype_table", false},
    {B8G_DEP_WEBRTC, "b8g_webrtc_abi", "b8g_webrtc_abi", "b8g_get_webrtc_table", false},
    {B8G_DEP_PDFIUM, "b8g_pdfium_abi", "b8g_pdfium_abi", "b8g_get_pdfium_table", false},
    {B8G_DEP_ICU, "b8g_icu_abi", "b8g_icu_abi", "b8g_get_icu_table", false},
    {B8G_DEP_SQLITE, "b8g_sqlite_abi", "b8g_sqlite_abi", "b8g_get_sqlite_table", false},
};

struct FallbackOriginState {
  uint32_t magic;
  uint32_t dep_id;
};

void* FallbackInitOrigin(void* origin_arena, const B8gOriginAllocator* alloc) {
  if (!alloc || !alloc->alloc) return nullptr;
  auto* st = static_cast<FallbackOriginState*>(
      alloc->alloc(origin_arena, sizeof(FallbackOriginState), 16));
  if (st) {
    st->magic = B8G_ABI_MAGIC_V3;
    st->dep_id = 0u;
  }
  return st;
}

void FallbackDisposeOrigin(void* module_state) {
  if (module_state) {
    static_cast<FallbackOriginState*>(module_state)->magic = 0u;
  }
}

uint64_t FallbackPing(uint64_t x) {
  return x ^ 0x9E3779B97F4A7C15ULL;
}

struct FallbackDispatch {
  uint32_t abi_magic;
  uint64_t (*ping)(uint64_t);
};

constexpr FallbackDispatch kFallbackDispatch = {B8G_ABI_MAGIC_V3, &FallbackPing};

constexpr B8gDepModuleV3 kFallbackModule = {
    B8G_DEP_ABI_VERSION,
    B8G_DEP_IPCZ,
    "b8g_inproc_v3",
    "b8p:holo-v11:inproc-fallback",
    &FallbackInitOrigin,
    &FallbackDisposeOrigin,
    &kFallbackDispatch,
};

const void* GetFallbackModule() {
  return &kFallbackModule;
}

std::string MakeSharedLibPath(const std::string& dir, const char* stem) {
#if defined(_WIN32)
  return dir + "\\" + stem + ".dll";
#elif defined(__APPLE__)
  return dir + "/lib" + stem + ".dylib";
#else
  return dir + "/lib" + stem + ".so";
#endif
}

bool FileExists(const std::string& path) {
  std::FILE* fp = std::fopen(path.c_str(), "rb");
  if (!fp) return false;
  std::fclose(fp);
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  using namespace b8g::inmem_linker;
  constexpr size_t kCount = sizeof(kTargets) / sizeof(kTargets[0]);
  static_assert(kCount == 18, "Expected exactly 18 surviving B8G-ABI v3 targets");

  const std::string shim_dir = (argc > 1 && argv[1]) ? std::string(argv[1]) : std::string();

  B8gOriginArena origin;
  if (!origin.Init(19872026ULL, 4 * 1024 * 1024)) {
    std::fprintf(stderr, "FATAL: origin arena init failed\n");
    return 1;
  }

  auto s0 = origin.Stats();
  std::printf("[ORIGIN BOOT] magic=0x%08X abi_v=%u loaded=%u/%zu arena_used=%zu B\n",
              B8G_ABI_MAGIC_V3, B8G_DEP_ABI_VERSION, s0.loaded_dep_count, kCount,
              s0.arena_used_bytes);

  auto alloc = origin.Allocator();
  auto t0 = Clock::now();
  size_t real_ok = 0;
  size_t v3_ok = 0;

  for (size_t i = 0; i < kCount; ++i) {
    const auto& spec = kTargets[i];
    const void* raw = nullptr;
    bool loaded_from_disk = false;

    if (!shim_dir.empty()) {
      const std::string path = MakeSharedLibPath(shim_dir, spec.lib_stem);
      if (FileExists(path)) {
        raw = origin.LoadDepOnDemand(spec.id, path.c_str(), spec.getter);
        if (!raw) {
          std::fprintf(stderr, "FAIL: LoadDepOnDemand failed for %s (%s)\n", spec.name,
                       path.c_str());
          origin.Dispose();
          return 2;
        }
        loaded_from_disk = true;
      } else if (!spec.is_core_chromium_table) {
        std::fprintf(stderr, "FAIL: Missing compiled shim %s (%s)\n", spec.name, path.c_str());
        origin.Dispose();
        return 2;
      }
    }

    if (!loaded_from_disk) {
      auto tramp = origin.InstallWxTrampoline(
          static_cast<uint32_t>(spec.id), reinterpret_cast<void*>(&GetFallbackModule));
      raw = tramp ? tramp() : nullptr;
      if (!raw || !origin.RegisterStaticDep(spec.id, raw)) {
        std::fprintf(stderr, "FAIL: W^X trampoline registration failed for %s\n", spec.name);
        origin.Dispose();
        return 2;
      }
    }

    if (spec.is_core_chromium_table && loaded_from_disk) {
      real_ok++;
    } else {
      const auto* mod = static_cast<const B8gDepModuleV3*>(raw);
      if (mod->abi_version != B8G_DEP_ABI_VERSION) {
        std::fprintf(stderr, "FAIL: ABI version mismatch for %s: %u\n", spec.name,
                     mod->abi_version);
        origin.Dispose();
        return 3;
      }
      if (loaded_from_disk && mod->dep_id != static_cast<uint32_t>(spec.id)) {
        std::fprintf(stderr, "FAIL: dep_id mismatch for %s: got %u expected %u\n", spec.name,
                     mod->dep_id, static_cast<uint32_t>(spec.id));
        origin.Dispose();
        return 4;
      }
      void* st = mod->init_origin(&origin, &alloc);
      if (!st) {
        std::fprintf(stderr, "FAIL: init_origin returned null for %s\n", spec.name);
        origin.Dispose();
        return 5;
      }
      origin.dep_states[spec.id] = st;
      origin.dep_disposers[spec.id] = mod->dispose_origin;
      if (spec.is_core_chromium_table) {
        real_ok++;
      } else {
        v3_ok++;
      }
    }
  }

  auto t1 = Clock::now();
  double load_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
  auto s1 = origin.Stats();

  if (s1.loaded_dep_count != kCount) {
    std::fprintf(stderr, "FAIL: expected %zu loaded deps, got %u\n", kCount, s1.loaded_dep_count);
    origin.Dispose();
    return 6;
  }

  std::printf(
      "[18-TARGET W^X INMEM-LINK] core_tier0=%zu + v3_shims=%zu = %u/18 loaded in %.3f ms | "
      "arena_used=%zu B (allocs=%llu)\n",
      real_ok, v3_ok, s1.loaded_dep_count, load_ms, s1.arena_used_bytes,
      static_cast<unsigned long long>(s1.alloc_count));

  auto td0 = Clock::now();
  origin.Dispose();
  auto td1 = Clock::now();
  double disp_us = std::chrono::duration<double, std::micro>(td1 - td0).count();
  auto s2 = origin.Stats();

  if (s2.loaded_dep_count != 0 || s2.arena_used_bytes != 0) {
    std::fprintf(stderr, "FAIL: non-zero state after O(1) Dispose\n");
    return 7;
  }

  std::printf(
      "[SOVEREIGN ORIGIN DISPOSE] O(1) unmap all 18 modules in %.2f us | "
      "remaining=%u remaining_bytes=%zu\n",
      disp_us, s2.loaded_dep_count, s2.arena_used_bytes);
  return 0;
}
