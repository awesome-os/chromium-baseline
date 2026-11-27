#!/usr/bin/env node
/**
 * @file scripts/release-v11-native.mts
 * @description Native linux-x86_64 C11/C++20/C++23 compiler, test runner,
 *   deterministic `SHA512SUMS.txt` + `holo-v11-manifest.json` + tarball builder,
 *   and `v11-chromium-baseline-latest` release publisher.
 *
 * Strictly `erasableSyntaxOnly: true` & Node built-ins only (`shell: false`).
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASE_TAG = 'v11-chromium-baseline-latest';
export const TARBALL_NAME = 'chromium-baseline-linux-x86_64-holo-v11.tar.gz';

export interface CompileJob {
  readonly label: string;
  readonly compiler: 'cc' | 'c++' | 'g++';
  readonly args: readonly string[];
  readonly outputPath: string;
}

export interface SmokeBinaryJob {
  readonly label: string;
  readonly binaryPath: string;
  readonly args: readonly string[];
}

export interface NativeArtifactEntry {
  readonly name: string;
  readonly bytes: number;
  readonly sha512: string;
}

export interface HoloV11ReleaseManifest {
  readonly schema: 'holo-v11-release.v1';
  readonly abiMagic: '0x33564742';
  readonly repo: 'awesome-os/chromium-baseline';
  readonly arch: 'linux-x86_64';
  readonly commit: string;
  readonly artifactCount: number;
  readonly artifacts: readonly NativeArtifactEntry[];
}

export function getCompileJobs(
  repoRoot: string,
  distDir: string,
  tmpObjPath: string = path.join(os.tmpdir(), 'b8g_ladybird_bridges.o'),
): CompileJob[] {
  const shimsDir = path.join(repoRoot, 'components', 'inmem-linker', 'abi-v3-shims');
  const shimFiles = fs
    .readdirSync(shimsDir)
    .filter((f) => f.endsWith('_export.cc'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const jobs: CompileJob[] = [];
  for (const file of shimFiles) {
    const base = file.replace(/_export\.cc$/, '');
    const outPath = path.join(distDir, `lib${base}.so`);
    jobs.push({
      label: `abi-v3 shim lib${base}.so`,
      compiler: 'c++',
      args: [
        '-std=c++20',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-fPIC',
        '-shared',
        '-Icomponents/inmem-linker',
        path.posix.join('components/inmem-linker/abi-v3-shims', file),
        '-o',
        outPath,
      ],
      outputPath: outPath,
    });
  }

  jobs.push(
    {
      label: 'b8g_18_dep_origin_proof',
      compiler: 'c++',
      args: [
        '-std=c++20',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-Icomponents/inmem-linker',
        'components/inmem-linker/b8g_18_dep_origin_proof.cc',
        '-ldl',
        '-o',
        path.join(distDir, 'b8g_18_dep_origin_proof'),
      ],
      outputPath: path.join(distDir, 'b8g_18_dep_origin_proof'),
    },
    {
      label: 'b8g_inmem_linker_bench',
      compiler: 'c++',
      args: [
        '-std=c++20',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-Icomponents/inmem-linker',
        'components/inmem-linker/b8g_inmem_linker_bench.cc',
        '-ldl',
        '-o',
        path.join(distDir, 'b8g_inmem_linker_bench'),
      ],
      outputPath: path.join(distDir, 'b8g_inmem_linker_bench'),
    },
    {
      label: 'angrybird_bridge_test',
      compiler: 'cc',
      args: [
        '-std=c11',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        'components/angrybird/b8g_ladybird_bridges.c',
        'components/angrybird/bridge_test.c',
        '-o',
        path.join(distDir, 'angrybird_bridge_test'),
      ],
      outputPath: path.join(distDir, 'angrybird_bridge_test'),
    },
    {
      label: 'b8g_ladybird_bridges.o',
      compiler: 'cc',
      args: [
        '-std=c11',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-c',
        'components/angrybird/b8g_ladybird_bridges.c',
        '-o',
        tmpObjPath,
      ],
      outputPath: tmpObjPath,
    },
    {
      label: 'angrybird_cpp_engine_test',
      compiler: 'g++',
      args: [
        '-std=c++23',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-Icomponents/angrybird',
        'components/angrybird/cpp_engine_test.cpp',
        'components/angrybird/Libraries/LibJS/JIT/HoloHotLoopJIT.cpp',
        'components/angrybird/Libraries/LibWasm/SIMD/Simd128.cpp',
        tmpObjPath,
        '-o',
        path.join(distDir, 'angrybird_cpp_engine_test'),
      ],
      outputPath: path.join(distDir, 'angrybird_cpp_engine_test'),
    },
    {
      label: 'b8g_libuv_smoke',
      compiler: 'cc',
      args: [
        '-std=c11',
        '-O2',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-D_POSIX_C_SOURCE=200809L',
        '-Icomponents/libuv/include',
        'components/libuv/src/b8g_libuv.c',
        'components/libuv/src/b8g_libuv_smoke.c',
        '-luv',
        '-o',
        path.join(distDir, 'b8g_libuv_smoke'),
      ],
      outputPath: path.join(distDir, 'b8g_libuv_smoke'),
    },
  );

  return jobs;
}

export function getSmokeTestCommands(distDir: string): SmokeBinaryJob[] {
  return [
    {
      label: 'b8g_18_dep_origin_proof',
      binaryPath: path.join(distDir, 'b8g_18_dep_origin_proof'),
      args: [distDir],
    },
    {
      label: 'b8g_inmem_linker_bench',
      binaryPath: path.join(distDir, 'b8g_inmem_linker_bench'),
      args: [],
    },
    {
      label: 'angrybird_bridge_test',
      binaryPath: path.join(distDir, 'angrybird_bridge_test'),
      args: [],
    },
    {
      label: 'angrybird_cpp_engine_test',
      binaryPath: path.join(distDir, 'angrybird_cpp_engine_test'),
      args: [],
    },
    {
      label: 'b8g_libuv_smoke',
      binaryPath: path.join(distDir, 'b8g_libuv_smoke'),
      args: [],
    },
  ];
}

export function generateDistManifestAndSums(
  distDir: string,
  commitSha: string,
): { readonly manifest: HoloV11ReleaseManifest; readonly manifestPath: string; readonly sumsPath: string } {
  const absDist = path.resolve(distDir);
  const files = fs
    .readdirSync(absDist)
    .filter((f) => f !== 'SHA512SUMS.txt' && f !== 'holo-v11-manifest.json')
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const sumLines: string[] = [];
  const artifacts: NativeArtifactEntry[] = [];
  for (const file of files) {
    const full = path.join(absDist, file);
    const buf = fs.readFileSync(full);
    const sha512 = crypto.createHash('sha512').update(buf).digest('hex');
    sumLines.push(`${sha512}  ${file}`);
    artifacts.push({
      name: file,
      bytes: buf.length,
      sha512,
    });
  }

  const sumsPath = path.join(absDist, 'SHA512SUMS.txt');
  fs.writeFileSync(sumsPath, `${sumLines.join('\n')}\n`, 'utf8');

  const manifest: HoloV11ReleaseManifest = {
    schema: 'holo-v11-release.v1',
    abiMagic: '0x33564742',
    repo: 'awesome-os/chromium-baseline',
    arch: 'linux-x86_64',
    commit: commitSha,
    artifactCount: artifacts.length,
    artifacts,
  };
  const manifestPath = path.join(absDist, 'holo-v11-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { manifest, manifestPath, sumsPath };
}

function buildTestAndPackage(repoRoot: string, commitSha: string): void {
  const distDir = path.join(repoRoot, 'dist-v11');
  fs.mkdirSync(distDir, { recursive: true });
  const tmpObjPath = path.join(os.tmpdir(), 'b8g_ladybird_bridges.o');

  for (const job of getCompileJobs(repoRoot, distDir, tmpObjPath)) {
    console.log(`[compile] ${job.label}`);
    execFileSync(job.compiler, [...job.args], {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
    });
  }

  for (const testJob of getSmokeTestCommands(distDir)) {
    console.log(`[test] ${testJob.label}`);
    execFileSync(testJob.binaryPath, [...testJob.args], {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
    });
  }

  generateDistManifestAndSums(distDir, commitSha);

  const tarballPath = path.join(repoRoot, TARBALL_NAME);
  execFileSync(
    'tar',
    [
      '--sort=name',
      '--mtime=@0',
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '-czf',
      tarballPath,
      '-C',
      distDir,
      '.',
    ],
    { cwd: repoRoot, stdio: 'inherit', shell: false },
  );
  console.log(`[package] ${tarballPath} (${fs.statSync(tarballPath).size} bytes)`);
}

function publishRelease(repoRoot: string, targetSha: string): void {
  const assets = [
    path.join(repoRoot, TARBALL_NAME),
    path.join(repoRoot, 'dist-v11', 'holo-v11-manifest.json'),
    path.join(repoRoot, 'dist-v11', 'SHA512SUMS.txt'),
  ];

  let exists = false;
  try {
    execFileSync('gh', ['release', 'view', RELEASE_TAG], { stdio: 'ignore', shell: false });
    exists = true;
  } catch {
    exists = false;
  }

  if (exists) {
    execFileSync('gh', ['release', 'upload', RELEASE_TAG, ...assets, '--clobber'], {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
    });
    execFileSync(
      'gh',
      [
        'release',
        'edit',
        RELEASE_TAG,
        '--target',
        targetSha,
        '--title',
        'Holo v11 Native Linux x86_64 (chromium-baseline)',
      ],
      { cwd: repoRoot, stdio: 'inherit', shell: false },
    );
  } else {
    execFileSync(
      'gh',
      [
        'release',
        'create',
        RELEASE_TAG,
        ...assets,
        '--target',
        targetSha,
        '--title',
        'Holo v11 Native Linux x86_64 (chromium-baseline)',
        '--notes',
        'Automated Holo v11 native linux-x86_64 build & verification release.',
      ],
      { cwd: repoRoot, stdio: 'inherit', shell: false },
    );
  }
}

function main(): void {
  const idx = process.argv.indexOf('--mode');
  const mode = idx !== -1 ? process.argv[idx + 1] : 'build-and-package';
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sha = process.env.GITHUB_SHA || '';

  if (mode === 'build-and-package') {
    buildTestAndPackage(repoRoot, sha);
    return;
  }
  if (mode === 'publish') {
    publishRelease(repoRoot, sha || 'main');
    return;
  }
  throw new Error(`Unsupported --mode: ${mode}`);
}

const isMain =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
