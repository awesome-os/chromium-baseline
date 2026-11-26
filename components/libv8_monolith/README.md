# `components/libv8_monolith/` — Unified V8 `16.0.88+` Shared-Library Baseline (`dup_v8 = 0 B`)

> **Registry:** [`awesome-os/holo-v11`](https://github.com/awesome-os/holo-v11) (`index/cas-v11-global-manifest.json`, `B8G_ABI_MAGIC_V3 = 0x33564742`)

Instead of linking separate copies of V8 across every browser and JavaScript runtime (`~250 MB` static `libv8_monolith.a` bloat per binary), **`components/libv8_monolith/`** unifies all **8 V8 consumers** onto **one shared V8 `16.0.88+` ABI** projected from the **`Holo v11`** CAS (`$B8G_CAS_DIR/v11/files`) with **`dup_v8 = 0 B`**:

1. `browsers/sectium` (`sectium-browser`)
2. `browsers/electron` (`awesome-os/electron`)
3. `browsers/brave` (`awesome-os/brave`)
4. `runtimes/node` (`awesome-os/node`)
5. `runtimes/deno` (`deno`, `10/10` v11 CAS coverage)
6. `runtimes/bun-neon` (`awesome-os/bun-neon`)
7. `components/just-js/lo` (`just-js/lo`, `19/19` v11 CAS coverage)
8. `components/just-js/just-js` (`just-js/just`)

## Files

- [`holo-v8.mts`](holo-v8.mts) — O(1) Holo `v11` CAS hydrator using `$B8G_CAS_DIR` (SHA-512/SHA-256 verified)
- [`build-libv8.mts`](build-libv8.mts) — Unified GN + `.b8p` / `v11` CAS recipe generator (`shared-component` + `monolith-cas`)
- [`args.gn`](args.gn) — Canonical Chromium 160 / V8 `16.0.88+` GN flags
