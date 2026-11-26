# `browsers/brave` (inside `awesome-os/chromium-baseline`)

> **Brave (Shields-Only) — Unified Chromium Baseline Consumer (`dup_v8 = 0 B`)**

Consolidated into [`awesome-os/chromium-baseline`](../../README.md) from `awesome-os/brave`.

## Contents

- [`src/brave_launcher.c`](src/brave_launcher.c) — Native thin C11 launcher binding shared [`components/libv8_monolith/`](../../components/libv8_monolith/README.md) & [`lumi_hydration_splash.h`](src/lumi_hydration_splash.h).
- [`src/hydrate.mts`](src/hydrate.mts) & [`src/cli.mts`](src/cli.mts) — Holo `v11` CAS hydrator and CLI launcher (`--no-first-run --disable-brave-update`).
- [`src/index.mts`](src/index.mts) — Module exports for Chromium Baseline alignment checks.
- [`test/brave-cas.test.mts`](test/brave-cas.test.mts) — Unit & CLI launch-plan verification (`5/5` tests).

## Verification

```sh
node --test browsers/brave/test/brave-cas.test.mts
```
