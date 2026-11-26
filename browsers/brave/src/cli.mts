#!/usr/bin/env node
/**
 * @file browsers/brave/src/cli.mts
 * @description Zero-bloat `brave` CLI:
 *   - Hydrates debloated Brave Browser (Shields-only) from `awesome-os/holo-v11` (`cas-v11`)
 *     into `$B8G_CAS_DIR/brave/<sha256>/` if missing.
 *   - Launches `brave.exe` / `brave` detached with `--no-first-run --disable-brave-update`
 *     plus any forwarded user arguments.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureBraveBinary,
  fetchHoloIndex,
  getBraveAssetKey,
  getBraveExecutableRelPath,
  getCasCacheDir,
  tryResolveBraveEntry,
} from './hydrate.mts';

export const DEFAULT_BRAVE_FLAGS: readonly string[] = [
  '--no-first-run',
  '--disable-brave-update',
];

export interface ParsedCliArgs {
  dryRun: boolean;
  showVersion: boolean;
  showHelp: boolean;
  forwardArgs: string[];
}

export interface LaunchPlan {
  version: string;
  cacheDir: string;
  defaultFlags: string[];
  brave: {
    assetKey: string;
    status: 'resolved' | 'pending-ingest';
    sha256: string | null;
    bytes: number | null;
    browserVersion: string | null;
    executablePath: string | null;
  };
  forwardArgs: string[];
}

export function getPackageVersion(): string {
  try {
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.2.0';
  } catch {
    return '0.2.0';
  }
}

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const forwardArgs: string[] = [];
  let dryRun = false;
  let showVersion = false;
  let showHelp = false;
  let passthrough = false;

  for (const arg of argv) {
    if (!passthrough && arg === '--') {
      passthrough = true;
      forwardArgs.push(arg);
      continue;
    }
    if (!passthrough && arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (!passthrough && (arg === '--version' || arg === '-v')) {
      showVersion = true;
      continue;
    }
    if (!passthrough && (arg === '--help' || arg === '-h')) {
      showHelp = true;
      continue;
    }
    if (!passthrough && arg === '--no-splash') {
      continue;
    }
    forwardArgs.push(arg);
  }

  return { dryRun, showVersion, showHelp, forwardArgs };
}

export async function buildLaunchPlan(parsed: ParsedCliArgs): Promise<LaunchPlan> {
  const idx = await fetchHoloIndex();
  const cacheDir = getCasCacheDir();
  const braveKey = getBraveAssetKey();
  const entry = await tryResolveBraveEntry(braveKey, idx);
  const executablePath = entry
    ? join(cacheDir, 'brave', entry.sha256, getBraveExecutableRelPath())
    : null;

  return {
    version: getPackageVersion(),
    cacheDir,
    defaultFlags: [...DEFAULT_BRAVE_FLAGS],
    brave: {
      assetKey: braveKey,
      status: entry ? 'resolved' : 'pending-ingest',
      sha256: entry?.sha256 ?? null,
      bytes: entry?.bytes ?? null,
      browserVersion: entry?.version ?? null,
      executablePath,
    },
    forwardArgs: parsed.forwardArgs,
  };
}

export async function runCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const parsed = parseCliArgs(argv);

  if (parsed.showVersion) {
    console.log(
      `@awesome-os/brave ${getPackageVersion()} (${process.platform}/${process.arch} | brave=${getBraveAssetKey()})`,
    );
    return;
  }

  if (parsed.showHelp) {
    console.log(
      [
        `brave ${getPackageVersion()} — Debloated Brave Browser (Shields-only) on holo-v11 CAS`,
        '',
        'Usage: brave [options] [urls/flags...]',
        '',
        'Options:',
        '  --dry-run     Resolve CAS entry and print launch plan JSON without launching',
        '  --no-splash   Skip Lumi Hydration Splash (native launcher)',
        '  -v, --version Print version and platform CAS asset key',
        '  -h, --help    Show this help message',
        '',
        'Environment:',
        '  BRAVE_HOLO_SHA256    Pin to a Keep-Last-5 SHA-256 from holo-v11',
        '  B8G_CAS_DIR          Override local CAS cache directory',
        '  BRAVE_PROGRESS=1     Emit HOLO_PROGRESS <pct> <msg> lines on stdout',
      ].join('\n'),
    );
    return;
  }

  if (parsed.dryRun) {
    const plan = await buildLaunchPlan(parsed);
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const brave = await ensureBraveBinary();

  if (process.env.BRAVE_VERBOSE === '1') {
    console.error(
      `[awesome-os/brave] executable=${brave.executablePath} (cacheHit=${brave.cacheHit})`,
    );
  }

  const spawnArgs = [...DEFAULT_BRAVE_FLAGS, ...parsed.forwardArgs];
  const child = spawn(brave.executablePath, spawnArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env: {
      ...process.env,
      B8G_CAS_DIR: getCasCacheDir(),
    },
  });
  child.unref();
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  await runCli();
}
