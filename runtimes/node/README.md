# `runtimes/node/` — Awesome-OS Node.js (`26.x` / `27.x` Shared V8 + `libuv`)

- **V8 Baseline:** Pinned to [`../../components/libv8_monolith/`](../../components/libv8_monolith/README.md) (`16.0.88+`, `dup_v8 = 0 B`)
- **Async I/O Baseline:** Pinned to [`../../components/libuv/`](../../components/libuv/README.md) (`1.53.0`)
- **Native Launcher:** [`src/node_launcher.c`](src/node_launcher.c) (`awesome-os/holo-v11` + `$B8G_CAS_DIR`)
- **Alignment Manifest:** [`alignment.json`](alignment.json)
