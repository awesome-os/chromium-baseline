// Copyright 2026 Awesome-OS Authors
// SPDX-License-Identifier: BSD-3-Clause
//
// @file components/inmem-linker/b8g_chromium_abi_table.h
// @description Zero-Header C11/C++20 `B8G-ABI` Static Dispatch Table for Chromium 160
// subsystem boundaries (ipcz, Blink Flex, Viz Quads, V8 16.0.88+, Base, Mojo, Net, GPU, Shell)
// over Holo v11 CAS (`B8G_ABI_MAGIC_V3 = 0x33564742`, `dup_v8 = 0 B`).

#ifndef AWESOME_OS_B8G_CHROMIUM_ABI_TABLE_H_
#define AWESOME_OS_B8G_CHROMIUM_ABI_TABLE_H_

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define B8G_CHROMIUM_ABI_MAGIC 0x41473842u  /* "B8GA" */
#define B8G_CHROMIUM_ABI_VERSION_V2 0x00020000u
#define B8G_CHROMIUM_ABI_VERSION_V3 0x00030000u
#define B8G_CHROMIUM_ABI_VERSION B8G_CHROMIUM_ABI_VERSION_V2

typedef struct B8gFlatFlexItem32C {
  float base_size;
  float flex_grow;
  float flex_shrink;
  float min_size;
  float max_size;
  float margin_border_pad;
  float solved_size;
  uint32_t frozen;
} B8gFlatFlexItem32C;

typedef struct B8gVizQuad48C {
  float x, y, w, h;
  float r, g, b, a;
  float corner_radius;
  float z_index;
  uint32_t resource_id;
  uint32_t flags;
} B8gVizQuad48C;

typedef struct B8gIpczDispatchTable {
  size_t (*required_ring_bytes)(void);
  void (*ring_init)(void* shared_arena, uint32_t capability_epoch);
  uint32_t (*try_put)(void* shared_arena, const void* data, size_t num_bytes, uint32_t flags);
  uint32_t (*try_get)(void* shared_arena, void* out_buf, size_t cap_bytes, size_t* out_bytes);
} B8gIpczDispatchTable;

typedef struct B8gBlinkFlexDispatchTable {
  size_t (*item_bytes)(void);
  void (*solve_line)(B8gFlatFlexItem32C* items,
                     size_t count,
                     float available_main_size,
                     float gap);
} B8gBlinkFlexDispatchTable;

typedef struct B8gVizDispatchTable {
  size_t (*quad_bytes)(void);
  double (*compute_coverage_sum)(const B8gVizQuad48C* quads, size_t count);
} B8gVizDispatchTable;

typedef struct B8gV8DispatchTable {
  uint32_t (*abi_version)(void);
  int32_t (*eval_utf8)(const char* code, size_t len, char* out_buf, size_t out_cap);
} B8gV8DispatchTable;

typedef struct B8gBaseDispatchTable {
  uint64_t (*now_ns)(void);
  void* (*alloc_aligned64)(size_t bytes);
  void (*free_aligned64)(void* ptr);
} B8gBaseDispatchTable;

typedef struct B8gMojoDispatchTable {
  uint32_t (*create_pipe)(uint64_t* out_handle_a, uint64_t* out_handle_b);
  uint32_t (*write_message)(uint64_t handle, const void* data, size_t num_bytes);
  uint32_t (*read_message)(uint64_t handle, void* out_buf, size_t cap, size_t* out_bytes);
  uint32_t (*close_handle)(uint64_t handle);
} B8gMojoDispatchTable;

typedef struct B8gNetDispatchTable {
  uint32_t (*protocol_mask)(void); /* bit0=HTTP2, bit1=HTTP3/QUIC, bit2=TLS1.3 */
  int32_t (*parse_url_host)(const char* url, size_t len, char* host_out, size_t host_cap);
  uint64_t (*cache_key_fnv1a)(const char* url, size_t len);
} B8gNetDispatchTable;

typedef struct B8gGpuDispatchTable {
  uint32_t (*backend_id)(void); /* 1=DX12, 2=Vulkan, 3=Metal, 4=WebGPU */
  uint32_t (*create_surface)(uint32_t width, uint32_t height, uint32_t mode);
  uint32_t (*submit_quads_48)(uint32_t surface_id, const B8gVizQuad48C* quads, size_t count);
  uint32_t (*present)(uint32_t surface_id);
} B8gGpuDispatchTable;

typedef struct B8gShellDispatchTable {
  uint32_t (*create_tab)(const char* initial_url, size_t url_len);
  uint32_t (*navigate_tab)(uint32_t tab_id, const char* url, size_t url_len);
  uint32_t (*dispatch_key)(uint32_t tab_id, uint32_t key_code, uint32_t unicode_cp);
  uint32_t (*active_tab_count)(void);
} B8gShellDispatchTable;

typedef struct B8gChromiumAbiTable {
  uint32_t magic;
  uint32_t abi_version;
  const B8gIpczDispatchTable* ipcz;
  const B8gBlinkFlexDispatchTable* blink_flex;
  const B8gVizDispatchTable* viz;
  const B8gV8DispatchTable* v8;
  const B8gBaseDispatchTable* base;
  const B8gMojoDispatchTable* mojo;
  const B8gNetDispatchTable* net;
  const B8gGpuDispatchTable* gpu;
  const B8gShellDispatchTable* shell;
} B8gChromiumAbiTable;

#define B8G_CAP_ORIGIN_ARENA         (1u << 0) /* O(1) VirtualFree/munmap origin arena */
#define B8G_CAP_CLOUD_SYNC           (1u << 1) /* 350 us hot-swappable oss/local/google sync */
#define B8G_CAP_LIBNODE_SHARED_V8    (1u << 2) /* 0 B duplicate v8.dll Node embedding */
#define B8G_CAP_EPHEMERAL_TOKEN      (1u << 3) /* RAM-only zero-wiped capability leases */
#define B8G_CAP_CHROME_FACADE        (1u << 4) /* 11.8 KB / 149 KB ChromeMain binary facade */
#define B8G_CAP_OFFSCREEN_COMPOSITOR (1u << 5) /* RAM-only RGBA desktop compositor */

#define B8G_SUBSYS_ORIGIN_ARENA 1u
#define B8G_SUBSYS_CLOUD_SYNC   2u
#define B8G_SUBSYS_LIBNODE      3u

typedef struct B8gOriginArenaDispatchTable {
  uint64_t (*create_arena)(uint32_t origin_id, size_t reserve_bytes);
  void* (*alloc_in_arena)(uint64_t arena_handle, size_t bytes, size_t align);
  uint32_t (*wipe_and_destroy_o1)(uint64_t arena_handle); /* atomic O(1) VirtualFree/munmap */
  uint64_t (*active_arena_count)(void);
} B8gOriginArenaDispatchTable;

typedef struct B8gCloudSyncV3DispatchTable {
  const char* (*active_provider)(void); /* "oss" | "local" | "google" */
  int32_t (*hot_swap_provider)(const char* provider_name);
  uint64_t (*last_swap_us)(void);
} B8gCloudSyncV3DispatchTable;

typedef struct B8gLibNodeDispatchTable {
  uint64_t (*shared_v8_bytes)(void);
  uint64_t (*duplicate_v8_bytes)(void); /* invariant: always 0 */
  int32_t (*eval_module_utf8)(const char* code, size_t len);
} B8gLibNodeDispatchTable;

typedef struct B8gAbiUpgradeDispatchTable {
  uint32_t (*negotiate)(uint32_t min_version, uint32_t max_version, uint32_t* out_active_version);
  uint32_t (*has_capability)(uint32_t cap_bit);
  int32_t (*hot_swap_subsystem)(uint32_t subsystem_id, const void* new_dispatch_table);
} B8gAbiUpgradeDispatchTable;

typedef struct B8gChromiumAbiTableV3 {
  B8gChromiumAbiTable v2; /* MUST stay at offset 0 for 100% v2 binary compatibility */
  uint32_t struct_size;   /* sizeof(B8gChromiumAbiTableV3) */
  uint32_t capability_flags;
  const B8gOriginArenaDispatchTable* origin_arena;
  const B8gCloudSyncV3DispatchTable* cloud_sync;
  const B8gLibNodeDispatchTable* libnode;
  const B8gAbiUpgradeDispatchTable* upgrade;
} B8gChromiumAbiTableV3;

static inline int b8g_abi_is_v3(const B8gChromiumAbiTable* tbl) {
  if (!tbl || tbl->magic != B8G_CHROMIUM_ABI_MAGIC) return 0;
  if (tbl->abi_version < B8G_CHROMIUM_ABI_VERSION_V3) return 0;
  const B8gChromiumAbiTableV3* v3 = (const B8gChromiumAbiTableV3*)tbl;
  return v3->struct_size >= sizeof(B8gChromiumAbiTableV3);
}

#if defined(_WIN32)
#define B8G_ABI_EXPORT __declspec(dllexport)
#else
#define B8G_ABI_EXPORT __attribute__((visibility("default")))
#endif

typedef const B8gChromiumAbiTable* (*B8gGetAbiTableFn)(void);
typedef const B8gChromiumAbiTableV3* (*B8gGetAbiTableV3Fn)(void);

#ifdef __cplusplus
}
#endif

#endif  // AWESOME_OS_B8G_CHROMIUM_ABI_TABLE_H_
