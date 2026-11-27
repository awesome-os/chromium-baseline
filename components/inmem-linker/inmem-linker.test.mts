import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

interface StubRollTarget {
  readonly depId: string;
  readonly chromiumDir: string;
  readonly tier: string;
  readonly abiName: string;
  readonly getterSymbol: string;
  readonly originDisposable: boolean;
  readonly reason: string;
}

interface StubRollManifest {
  readonly schema: string;
  readonly abiMagic: string;
  readonly casLayout: string;
  readonly casRegistry: string;
  readonly chromiumMilestone: string;
  readonly v8Version: string;
  readonly dupV8Bytes: number;
  readonly auditedTotalThirdPartyDirs: number;
  readonly prunedNonAlgoDirs: number;
  readonly prunedPercent: number;
  readonly survivingStubTargets: number;
  readonly targets: ReadonlyArray<StubRollTarget>;
}

const INMEM_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(INMEM_DIR, '..', '..');
const CORE_TIER0_SYMBOLS = new Set(['b8g_ipcz_abi', 'b8g_viz_abi', 'b8g_mojo_abi']);

function runCompiler(
  compiler: { readonly bin: string; readonly prefixArgs: readonly string[] },
  args: readonly string[],
): void {
  const fullArgs = [...compiler.prefixArgs, ...args];
  if (process.platform === 'win32' && compiler.bin.toLowerCase().endsWith('.cmd')) {
    execFileSync('cmd.exe', ['/d', '/c', compiler.bin, ...fullArgs], {
      cwd: INMEM_DIR,
      stdio: 'pipe',
    });
    return;
  }
  execFileSync(compiler.bin, fullArgs, { cwd: INMEM_DIR, stdio: 'pipe' });
}

function resolveCppCompiler(): {
  readonly bin: string;
  readonly prefixArgs: readonly string[];
} {
  if (process.platform === 'win32') {
    const envZig = process.env.ZIG_BIN;
    if (envZig) {
      return { bin: envZig, prefixArgs: ['c++'] };
    }
    for (let probe = REPO_ROOT, depth = 0; depth < 6; depth += 1, probe = resolve(probe, '..')) {
      const workspaceZig = resolve(probe, 'bin', 'zig.cmd');
      if (existsSync(workspaceZig)) {
        return { bin: workspaceZig, prefixArgs: ['c++'] };
      }
    }
    return { bin: 'zig', prefixArgs: ['c++'] };
  }
  return { bin: process.env.CXX || 'c++', prefixArgs: [] };
}

function sharedLibFileName(abiName: string): string {
  if (process.platform === 'win32') return `${abiName}.dll`;
  if (process.platform === 'darwin') return `lib${abiName}.dylib`;
  return `lib${abiName}.so`;
}

describe('components/inmem-linker B8G-ABI v3 origin linker & 18-target stub roll', () => {
  it('validates b8g-stub-roll-manifest.json against Holo v11, Chromium 160, V8 16.0.88+, GN stubs, and 15 shims', () => {
    const manifestPath = join(INMEM_DIR, 'b8g-stub-roll-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as StubRollManifest;

    assert.equal(manifest.schema, 'b8g.stub-roll.v3');
    assert.equal(manifest.abiMagic, '0x33564742');
    assert.equal(manifest.casLayout, 'v11');
    assert.equal(manifest.casRegistry, 'awesome-os/holo-v11');
    assert.equal(manifest.chromiumMilestone, '160.0.8184.0');
    assert.equal(manifest.v8Version, '16.0.88+');
    assert.equal(manifest.dupV8Bytes, 0);
    assert.equal(manifest.auditedTotalThirdPartyDirs, 333);
    assert.equal(manifest.prunedNonAlgoDirs, 286);
    assert.equal(manifest.prunedPercent, 85.9);
    assert.equal(manifest.survivingStubTargets, 18);
    assert.equal(manifest.targets.length, 18);

    const gniContent = readFileSync(join(INMEM_DIR, 'b8g_all_abi_stubs.gni'), 'utf8');
    const seenDeps = new Set<string>();
    const seenAbis = new Set<string>();
    let shimCount = 0;

    for (const target of manifest.targets) {
      assert.ok(!seenDeps.has(target.depId), `Duplicate depId ${target.depId}`);
      assert.ok(!seenAbis.has(target.abiName), `Duplicate abiName ${target.abiName}`);
      seenDeps.add(target.depId);
      seenAbis.add(target.abiName);

      assert.ok(['Tier0-Boot', 'Tier1-MediaGPU', 'Tier2-OnDemand'].includes(target.tier));
      const gnLabel = `"//${target.chromiumDir}:${target.abiName}"`;
      assert.ok(gniContent.includes(gnLabel), `Missing GN target ${gnLabel} in b8g_all_abi_stubs.gni`);

      if (!CORE_TIER0_SYMBOLS.has(target.abiName)) {
        const shimPath = join(INMEM_DIR, 'abi-v3-shims', `${target.abiName}_export.cc`);
        assert.ok(existsSync(shimPath), `Missing ABI v3 shim ${shimPath}`);
        const shimSrc = readFileSync(shimPath, 'utf8');
        assert.ok(shimSrc.includes(target.depId), `${shimPath} missing ${target.depId}`);
        assert.ok(shimSrc.includes(target.getterSymbol), `${shimPath} missing ${target.getterSymbol}`);
        assert.ok(shimSrc.includes('B8G_ABI_MAGIC_V3'), `${shimPath} must stamp B8G_ABI_MAGIC_V3`);
        assert.ok(shimSrc.includes('b8p:holo-v11:'), `${shimPath} must reference b8p:holo-v11 CAS tag`);
        shimCount++;
      }
    }

    assert.equal(shimCount, 15);
  });

  it('verifies B8G_ABI_MAGIC_V3 / B8gDepModuleV3 C header invariants and zero legacy refs', () => {
    const header = readFileSync(join(INMEM_DIR, 'b8g_origin_linker.h'), 'utf8');
    const abiTable = readFileSync(join(INMEM_DIR, 'b8g_chromium_abi_table.h'), 'utf8');
    const manifest = JSON.parse(
      readFileSync(join(INMEM_DIR, 'b8g-stub-roll-manifest.json'), 'utf8'),
    ) as StubRollManifest;

    assert.match(header, /#define\s+B8G_ABI_MAGIC_V3\s+0x33564742u/);
    assert.match(header, /#define\s+B8G_DEP_ABI_VERSION\s+3u/);
    assert.ok(header.includes('typedef struct B8gDepModuleV3 {'));
    assert.ok(header.includes('void* (*init_origin)(void* origin_arena, const B8gOriginAllocator* alloc);'));
    assert.ok(header.includes('void  (*dispose_origin)(void* module_state);'));
    assert.ok(header.includes('const void* dispatch_table;'));
    assert.ok(header.includes('struct B8gOriginArena {'));
    assert.ok(abiTable.includes('typedef struct B8gChromiumAbiTableV3 {'));

    for (const target of manifest.targets) {
      assert.ok(header.includes(target.depId), `b8g_origin_linker.h missing enum ${target.depId}`);
    }

    const legacyPattern = new RegExp(
      `${['b8g', 'ghost'].join('-')}|${['B8G', 'GHOST'].join('_')}|${['cas', 'v1'].join('-')}(?![0-9])`,
    );
    const allFiles: string[] = [
      ...readdirSync(INMEM_DIR)
        .filter((f) => !f.startsWith('.') && f !== 'abi-v3-shims')
        .map((f) => join(INMEM_DIR, f)),
      ...readdirSync(join(INMEM_DIR, 'abi-v3-shims')).map((f) => join(INMEM_DIR, 'abi-v3-shims', f)),
    ];
    for (const filePath of allFiles) {
      const text = readFileSync(filePath, 'utf8');
      assert.equal(legacyPattern.test(text), false, `Legacy ref in ${filePath}`);
    }
  });

  it('compiles all 15 ABI v3 shims and executes the 18-target C++20 origin-linker proof & benchmark', () => {
    const compiler = resolveCppCompiler();
    const buildDir = mkdtempSync(join(tmpdir(), 'b8g-inmem-linker-'));
    const manifest = JSON.parse(
      readFileSync(join(INMEM_DIR, 'b8g-stub-roll-manifest.json'), 'utf8'),
    ) as StubRollManifest;

    try {
      const commonFlags = ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror', `-I${INMEM_DIR}`];
      const picFlags = process.platform === 'win32' ? [] : ['-fPIC'];

      for (const target of manifest.targets) {
        if (CORE_TIER0_SYMBOLS.has(target.abiName)) continue;
        const shimSrc = join(INMEM_DIR, 'abi-v3-shims', `${target.abiName}_export.cc`);
        const outLib = join(buildDir, sharedLibFileName(target.abiName));
        runCompiler(compiler, [...commonFlags, ...picFlags, '-shared', shimSrc, '-o', outLib]);
      }

      const exeSuffix = process.platform === 'win32' ? '.exe' : '';
      const proofExe = join(buildDir, `b8g_18_dep_origin_proof${exeSuffix}`);
      const linkLibs = process.platform === 'linux' ? ['-ldl'] : [];

      runCompiler(compiler, [
        ...commonFlags,
        join(INMEM_DIR, 'b8g_18_dep_origin_proof.cc'),
        '-o',
        proofExe,
        ...linkLibs,
      ]);

      const proofOut = execFileSync(proofExe, [buildDir], { encoding: 'utf8' });
      assert.ok(proofOut.includes('magic=0x33564742 abi_v=3'), `Unexpected proof boot output: ${proofOut}`);
      assert.ok(proofOut.includes('v3_shims=15 = 18/18 loaded'), `Expected 15 dynamic v3 shims + 18/18 total: ${proofOut}`);
      assert.ok(proofOut.includes('remaining=0 remaining_bytes=0'), `Expected O(1) zero-leak dispose: ${proofOut}`);

      const benchExe = join(buildDir, `b8g_inmem_linker_bench${exeSuffix}`);
      runCompiler(compiler, [
        ...commonFlags,
        join(INMEM_DIR, 'b8g_inmem_linker_bench.cc'),
        '-o',
        benchExe,
        ...linkLibs,
      ]);

      const benchOut = execFileSync(benchExe, [], { encoding: 'utf8' });
      assert.ok(benchOut.includes('magic=0x33564742'), `Unexpected bench output: ${benchOut}`);
      assert.ok(benchOut.includes("mojo_pipe_rx='https://awesome-os.dev'"), `Unexpected mojo output: ${benchOut}`);
      assert.ok(benchOut.includes('remaining_deps=0 remaining_bytes=0'), `Expected O(1) dispose: ${benchOut}`);
      assert.ok(benchOut.includes('0 leaked bytes'), `Expected 0 leaked bytes: ${benchOut}`);
    } finally {
      rmSync(buildDir, { recursive: true, force: true });
    }
  });
});
