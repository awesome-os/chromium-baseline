#!/usr/bin/env node
/**
 * @file alignment/verify-alignment.mts
 * @description Programmatic verifier for `awesome-os/chromium-baseline`:
 *   1. Single shared V8 (`16.0.88+`, `dup_v8 = 0 B`) across all 8 V8 consumers
 *   2. Shared `v11` C/C++ library layer across Chromium components and `components/angrybird`
 *   3. Zero legacy `b8g-ghost` / `cas-v1` references in `chromium-baseline`
 *   4. `components/angrybird` `18/18` Chrome parity (`0` missing, `0` early-stub)
 *
 * Strictly `erasableSyntaxOnly: true` & zero external dependencies.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AlignmentVerificationResult {
  readonly ok: boolean;
  readonly v8ConsumersVerified: number;
  readonly sharedLibsVerified: readonly string[];
  readonly legacyReferencesFound: readonly string[];
  readonly angrybirdParityCount: number;
  readonly angrybirdMissingCount: number;
  readonly angrybirdEarlyStubCount: number;
  readonly inmemLinkerTargetsVerified: number;
  readonly errors: readonly string[];
}

interface BaselineLockFile {
  readonly schema: string;
  readonly abiMagic: string;
  readonly casLayout: string;
  readonly casRegistry: string;
  readonly v8Baseline: {
    readonly version: string;
    readonly component: string;
    readonly dupV8Bytes: number;
    readonly consumers: ReadonlyArray<{ readonly id: string; readonly path: string; readonly kind: string }>;
  };
  readonly sharedV11Libraries: Record<string, string>;
  readonly angrybird: {
    readonly path: string;
    readonly chromeParity: {
      readonly implemented: number;
      readonly total: number;
      readonly earlyStub: number;
      readonly missing: number;
    };
  };
}

interface RuntimeAlignmentJson {
  readonly v8Baseline?: { readonly version: string; readonly component: string; readonly dupV8Bytes: number };
  readonly libuvBaseline?: { readonly version: string; readonly component: string };
  readonly sharedV11Libraries?: Record<string, string>;
}

const REQUIRED_SHARED_LIBS: Readonly<Record<string, string>> = {
  openssl: '4.1.0',
  harfbuzz: '15.2.0',
  zstd: '1.6.0',
  'zlib-ng': '2.3.3',
  libuv: '1.53.0',
  vulkan: '1.4.369',
  ada: '4.1.1',
  mimalloc: '3.7.1',
};

const EXPECTED_V8_CONSUMERS = [
  'sectium',
  'electron',
  'brave',
  'node',
  'deno',
  'bun-neon',
  'lo',
  'just-js',
] as const;

const LEGACY_PATTERN = /b8g-ghost|B8G_GHOST|(?<![a-zA-Z0-9-])cas-v1(?![0-9])/g;

function walkRepoFiles(dir: string, out: string[]): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === '.holo-ci-runtime') continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      walkRepoFiles(full, out);
    } else if (ent.isFile()) {
      out.push(full);
    }
  }
}

export function verifyBaselineAlignment(
  repoRoot: string = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
): AlignmentVerificationResult {
  const errors: string[] = [];

  const lockPath = join(repoRoot, 'alignment', 'chromium-baseline-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as BaselineLockFile;

  if (lock.abiMagic !== '0x33564742') {
    errors.push(`Expected abiMagic 0x33564742, got ${lock.abiMagic}`);
  }
  if (lock.casLayout !== 'v11') {
    errors.push(`Expected casLayout v11, got ${lock.casLayout}`);
  }
  if (lock.casRegistry !== 'awesome-os/holo-v11') {
    errors.push(`Expected casRegistry awesome-os/holo-v11, got ${lock.casRegistry}`);
  }

  // 1. Verify single shared V8 (16.0.88+, dup_v8 = 0 B) across all 8 consumers
  if (lock.v8Baseline.version !== '16.0.88+') {
    errors.push(`Expected v8Baseline.version 16.0.88+, got ${lock.v8Baseline.version}`);
  }
  if (lock.v8Baseline.dupV8Bytes !== 0) {
    errors.push(`Expected dupV8Bytes === 0, got ${lock.v8Baseline.dupV8Bytes}`);
  }
  if (lock.v8Baseline.component !== 'components/libv8_monolith') {
    errors.push(`Expected v8Baseline.component components/libv8_monolith, got ${lock.v8Baseline.component}`);
  }

  const consumerIds = new Set(lock.v8Baseline.consumers.map((c) => c.id));
  for (const expectedId of EXPECTED_V8_CONSUMERS) {
    if (!consumerIds.has(expectedId)) {
      errors.push(`Missing V8 consumer "${expectedId}" in alignment lock`);
    }
  }

  for (const consumer of lock.v8Baseline.consumers) {
    const consumerDir = join(repoRoot, consumer.path);
    if (!existsSync(consumerDir)) {
      errors.push(`Missing V8 consumer directory: ${consumer.path}`);
      continue;
    }
    const runtimeAlignPath = join(consumerDir, 'alignment.json');
    if (consumer.kind === 'runtime') {
      if (!existsSync(runtimeAlignPath)) {
        errors.push(`Missing runtime alignment manifest: ${consumer.path}/alignment.json`);
      } else {
        const ra = JSON.parse(readFileSync(runtimeAlignPath, 'utf8')) as RuntimeAlignmentJson;
        if (ra.v8Baseline?.version !== '16.0.88+' || ra.v8Baseline?.dupV8Bytes !== 0) {
          errors.push(`Runtime ${consumer.id} not pinned to shared V8 16.0.88+ with dupV8Bytes=0`);
        }
        if (ra.v8Baseline?.component !== 'components/libv8_monolith') {
          errors.push(`Runtime ${consumer.id} must reference components/libv8_monolith`);
        }
        if (ra.libuvBaseline?.version !== '1.53.0' || ra.libuvBaseline?.component !== 'components/libuv') {
          errors.push(`Runtime ${consumer.id} must pin libuv 1.53.0 via components/libuv`);
        }
      }
    }
  }

  // 2. Verify shared v11 C/C++ library layer across Chromium components and AngryBird
  const aheadPins = JSON.parse(
    readFileSync(join(repoRoot, 'upstream', 'ahead-of-chrome-pins.json'), 'utf8'),
  ) as { aheadOfChromePins: Record<string, { version: string }> };
  const maxLock = JSON.parse(
    readFileSync(join(repoRoot, 'upstream', 'max-version-lock.json'), 'utf8'),
  ) as { libraries: ReadonlyArray<{ name: string; maxVersion: string }> };
  const maxByName = new Map(maxLock.libraries.map((l) => [l.name, l.maxVersion]));

  const sharedLibsVerified: string[] = [];
  for (const [lib, expectedVer] of Object.entries(REQUIRED_SHARED_LIBS)) {
    const lockVer = lock.sharedV11Libraries[lib];
    if (lockVer !== expectedVer) {
      errors.push(`sharedV11Libraries.${lib} mismatch: expected ${expectedVer}, got ${lockVer}`);
      continue;
    }
    if (aheadPins.aheadOfChromePins[lib]) {
      if (aheadPins.aheadOfChromePins[lib].version !== expectedVer) {
        errors.push(`ahead-of-chrome-pins.${lib} mismatch: ${aheadPins.aheadOfChromePins[lib].version} !== ${expectedVer}`);
      }
    } else if (maxByName.has(lib) && maxByName.get(lib) !== expectedVer) {
      errors.push(`max-version-lock.${lib} mismatch: ${maxByName.get(lib)} !== ${expectedVer}`);
    }
    sharedLibsVerified.push(`${lib}@${expectedVer}`);
  }

  const toolchainPath = join(repoRoot, 'components', 'angrybird', 'Meta', 'CMake', 'holo_v11_toolchain.cmake');
  if (!existsSync(toolchainPath) || !readFileSync(toolchainPath, 'utf8').includes('B8G_CAS_DIR')) {
    errors.push('components/angrybird/Meta/CMake/holo_v11_toolchain.cmake missing B8G_CAS_DIR v11 linkage');
  }

  // 3. Verify zero legacy b8g-ghost / cas-v1 references in repository files
  const allFiles: string[] = [];
  walkRepoFiles(repoRoot, allFiles);
  const legacyReferencesFound: string[] = [];
  for (const file of allFiles) {
    const rel = relative(repoRoot, file).replace(/\\/g, '/');
    if (rel === 'alignment/verify-alignment.mts' || rel === 'alignment/verify-alignment.test.mts') {
      continue;
    }
    const content = readFileSync(file, 'utf8');
    const matches = content.match(LEGACY_PATTERN);
    if (matches && matches.length > 0) {
      legacyReferencesFound.push(`${rel} (${matches.join(', ')})`);
    }
  }
  if (legacyReferencesFound.length > 0) {
    errors.push(`Legacy b8g-ghost/cas-v1 references found: ${legacyReferencesFound.join('; ')}`);
  }

  // 4. Verify components/angrybird 18/18 Chrome parity (0 missing, 0 early-stub)
  const parityPath = join(repoRoot, 'components', 'angrybird', 'docs', 'chrome-parity-scan.json');
  const parity = JSON.parse(readFileSync(parityPath, 'utf8')) as {
    featureMatrix: ReadonlyArray<{ id: string; status: string }>;
  };
  const angrybirdParityCount = parity.featureMatrix.length;
  const angrybirdMissingCount = parity.featureMatrix.filter((f) => f.status === 'missing').length;
  const angrybirdEarlyStubCount = parity.featureMatrix.filter((f) => f.status === 'early-stub').length;

  if (angrybirdParityCount !== 18) {
    errors.push(`Expected 18 AngryBird Chrome parity probes, got ${angrybirdParityCount}`);
  }
  if (angrybirdMissingCount !== 0 || angrybirdEarlyStubCount !== 0) {
    errors.push(
      `Expected 0 missing and 0 early-stub in AngryBird parity, got missing=${angrybirdMissingCount}, earlyStub=${angrybirdEarlyStubCount}`,
    );
  }

  // 5. Verify components/inmem-linker 18-target B8G-ABI v3 origin linker
  const inmemDir = join(repoRoot, 'components', 'inmem-linker');
  const inmemHeaderPath = join(inmemDir, 'b8g_origin_linker.h');
  const inmemManifestPath = join(inmemDir, 'b8g-stub-roll-manifest.json');
  const inmemGniPath = join(inmemDir, 'b8g_all_abi_stubs.gni');
  let inmemLinkerTargetsVerified = 0;

  if (!existsSync(inmemHeaderPath) || !existsSync(inmemManifestPath) || !existsSync(inmemGniPath)) {
    errors.push('components/inmem-linker missing core B8G-ABI v3 files');
  } else {
    const inmemHeader = readFileSync(inmemHeaderPath, 'utf8');
    if (!inmemHeader.includes('B8G_ABI_MAGIC_V3 0x33564742u') || !inmemHeader.includes('B8gDepModuleV3')) {
      errors.push('components/inmem-linker/b8g_origin_linker.h missing B8G_ABI_MAGIC_V3 / B8gDepModuleV3 contract');
    }
    const stubRoll = JSON.parse(readFileSync(inmemManifestPath, 'utf8')) as {
      schema: string;
      abiMagic: string;
      casLayout: string;
      casRegistry: string;
      survivingStubTargets: number;
      targets: ReadonlyArray<{ chromiumDir: string; abiName: string }>;
    };
    const gniText = readFileSync(inmemGniPath, 'utf8');
    if (
      stubRoll.schema !== 'b8g.stub-roll.v3' ||
      stubRoll.abiMagic !== '0x33564742' ||
      stubRoll.casLayout !== 'v11' ||
      stubRoll.casRegistry !== 'awesome-os/holo-v11'
    ) {
      errors.push('components/inmem-linker/b8g-stub-roll-manifest.json not aligned to Holo v11 / B8G-ABI v3');
    }
    for (const target of stubRoll.targets) {
      if (gniText.includes(`"//${target.chromiumDir}:${target.abiName}"`)) {
        inmemLinkerTargetsVerified++;
      } else {
        errors.push(`components/inmem-linker/b8g_all_abi_stubs.gni missing //${target.chromiumDir}:${target.abiName}`);
      }
    }
    if (inmemLinkerTargetsVerified !== 18 || stubRoll.survivingStubTargets !== 18) {
      errors.push(`Expected 18 inmem-linker stub targets, got ${inmemLinkerTargetsVerified}`);
    }
  }

  return {
    ok: errors.length === 0,
    v8ConsumersVerified: lock.v8Baseline.consumers.length,
    sharedLibsVerified,
    legacyReferencesFound,
    angrybirdParityCount,
    angrybirdMissingCount,
    angrybirdEarlyStubCount,
    inmemLinkerTargetsVerified,
    errors,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = verifyBaselineAlignment();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}
