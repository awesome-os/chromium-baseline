#!/usr/bin/env node
/**
 * @file components/libv8_monolith/build-libv8.mts
 * @description Unified V8 `16.0.88+` GN + Holo v11 CAS build recipe generator (`dup_v8 = 0 B`).
 * Emits both the shared component-build configuration (`is_component_build = true`) for
 * Chromium/Sectium/Electron/Brave/Node/Deno/Bun-Neon AND the `v8_monolithic` fast-call
 * projection (`libv8_monolith` + `.b8p` / `v11` CAS) for `just-js/lo` & `just-js/just-js`.
 *
 * Strictly `erasableSyntaxOnly: true` & zero WSL.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type V8BuildTarget = 'win-x64' | 'linux-x64' | 'linux-arm64' | 'macos-arm64';
export type V8Flavor = 'shared-component' | 'monolith-cas';

export interface V8BuildConfig {
  readonly v8Version: '16.0.88+';
  readonly abiMagic: '0x33564742';
  readonly casLayout: 'v11';
  readonly dupV8Bytes: 0;
  readonly target: V8BuildTarget;
  readonly flavor: V8Flavor;
  readonly gnArgs: string;
  readonly casOutputs: readonly string[];
}

export function generateV8GnArgs(
  target: V8BuildTarget,
  flavor: V8Flavor = 'shared-component',
): string {
  const targetOs = target.startsWith('win') ? 'win' : target.startsWith('macos') ? 'mac' : 'linux';
  const targetCpu = target.endsWith('arm64') ? 'arm64' : 'x64';
  const isMonolith = flavor === 'monolith-cas';

  const lines = [
    `# Unified V8 16.0.88+ Build Recipe (${target} | ${flavor})`,
    '# Shared across Sectium, Electron, Brave, Node, Deno, Bun-Neon, lo, just-js (dup_v8 = 0 B)',
    `target_os = "${targetOs}"`,
    `target_cpu = "${targetCpu}"`,
    'is_debug = false',
    'symbol_level = 0',
    'v8_symbol_level = 0',
    'treat_warnings_as_errors = false',
    `is_component_build = ${isMonolith ? 'false' : 'true'}`,
    `v8_monolithic = ${isMonolith ? 'true' : 'false'}`,
    `v8_static_library = ${isMonolith ? 'true' : 'false'}`,
    `v8_use_external_startup_data = ${isMonolith ? 'false' : 'true'}`,
    'v8_expose_public_symbols = true',
    `v8_enable_sandbox = ${isMonolith ? 'false' : 'true'}`,
    `v8_enable_pointer_compression = ${isMonolith ? 'false' : 'true'}`,
    'v8_enable_i18n_support = true',
    'use_custom_libcxx = false',
  ];

  return `${lines.join('\n')}\n`;
}

export function buildV8Config(
  target: V8BuildTarget = 'win-x64',
  flavor: V8Flavor = 'shared-component',
): V8BuildConfig {
  const casOutputs =
    target === 'win-x64'
      ? ['v8.dll', 'v8_libbase.dll', 'v8_libplatform.dll', 'v8-shared-win64.b8p']
      : target === 'macos-arm64'
        ? ['libv8.dylib', 'libv8_libbase.dylib', 'libv8_libplatform.dylib', 'v8-shared-macos-arm64.tar.gz']
        : [`libv8.so`, `libv8_libbase.so`, `libv8_libplatform.so`, `v8-shared-${target}.tar.gz`];

  return {
    v8Version: '16.0.88+',
    abiMagic: '0x33564742',
    casLayout: 'v11',
    dupV8Bytes: 0,
    target,
    flavor,
    gnArgs: generateV8GnArgs(target, flavor),
    casOutputs,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const targetArg = (process.argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'linux-x64') as V8BuildTarget;
  const flavorArg = (process.argv.find((a) => a.startsWith('--flavor='))?.split('=')[1] ?? 'shared-component') as V8Flavor;
  const cfg = buildV8Config(targetArg, flavorArg);
  if (process.argv.includes('--write-gn')) {
    const outGn = join(dirname(fileURLToPath(import.meta.url)), 'args.gn');
    writeFileSync(outGn, cfg.gnArgs, 'utf8');
  }
  console.log(JSON.stringify(cfg, null, 2));
}
