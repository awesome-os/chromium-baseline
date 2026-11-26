/**
 * @file browsers/electron/src/hydrate.mts
 * @description Hydrates debloated rolling-latest upstream Electron once per machine
 * from `awesome-os/holo-v11` (`cas-v11`) into `$B8G_CAS_DIR/electron/<sha256>/`.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOLO_INDEX_URL =
  process.env.B8G_HOLO_INDEX_URL ??
  'https://raw.githubusercontent.com/awesome-os/holo-v11/main/index/cas-v11-global-manifest.json';

export const HOLO_CAS_BASE_URL =
  process.env.B8G_HOLO_CAS_URL ??
  'https://github.com/awesome-os/holo-v11/releases/download/v11-latest';

export interface ElectronCasEntry {
  filename: string;
  sha256: string;
  bytes: number;
  raw_bytes?: number;
  version?: string;
  category?: string;
  download_url: string;
  history?: Array<{ sha256: string; bytes: number; version?: string; retired_at?: string }>;
}

export interface HoloIndex {
  schema: string;
  cas_base_url: string;
  updated_at: string;
  total_entries: number;
  entries: Record<string, ElectronCasEntry>;
}

export function getElectronAssetKey(): string {
  if (process.platform === 'win32') return 'electron-win64.tar.zst';
  if (process.platform === 'darwin') return 'electron-macos-arm64.tar.zst';
  return process.arch === 'arm64' ? 'electron-linux-arm64.tar.zst' : 'electron-linux-x64.tar.zst';
}

export function getElectronExecutableRelPath(): string {
  if (process.platform === 'win32') return 'electron.exe';
  if (process.platform === 'darwin') return join('Electron.app', 'Contents', 'MacOS', 'Electron');
  return 'electron';
}

export function getCasCacheDir(overrideDir?: string): string {
  const dir = overrideDir ?? process.env.B8G_CAS_DIR ?? join(homedir(), '.b8g', 'cas');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function fetchHoloIndex(
  options: { indexUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<HoloIndex> {
  const indexPath = process.env.B8G_CAS_INDEX_PATH;
  if (indexPath && existsSync(indexPath)) {
    return JSON.parse(readFileSync(indexPath, 'utf8')) as HoloIndex;
  }
  const url = options.indexUrl ?? HOLO_INDEX_URL;
  const fetchFn = options.fetchImpl ?? fetch;
  const res = await fetchFn(url, {
    headers: { 'User-Agent': 'awesome-os-electron/0.2.0' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return (await res.json()) as HoloIndex;
}

export async function resolveElectronEntry(
  assetKey = getElectronAssetKey(),
  options: { index?: HoloIndex; fetchImpl?: typeof fetch } = {},
): Promise<ElectronCasEntry> {
  const idx = options.index ?? (await fetchHoloIndex({ fetchImpl: options.fetchImpl }));
  const entry = idx.entries[assetKey];
  if (!entry) {
    throw new Error(`Asset "${assetKey}" not found in holo-v11 index (${idx.total_entries} entries)`);
  }
  const pinnedSha = process.env.ELECTRON_HOLO_SHA256?.trim();
  if (pinnedSha && pinnedSha !== entry.sha256) {
    const hist = entry.history?.find((h) => h.sha256 === pinnedSha);
    if (hist) {
      return {
        ...entry,
        sha256: hist.sha256,
        bytes: hist.bytes,
        version: hist.version ?? entry.version,
        download_url: `${HOLO_CAS_BASE_URL}/${hist.sha256}`,
      };
    }
  }
  return entry;
}

export async function ensureElectronBinary(
  options: { index?: HoloIndex; cacheDir?: string; fetchImpl?: typeof fetch; assetKey?: string } = {},
): Promise<{
  entry: ElectronCasEntry;
  installDir: string;
  executablePath: string;
  cacheHit: boolean;
}> {
  const entry = await resolveElectronEntry(options.assetKey, options);
  const cacheDir = getCasCacheDir(options.cacheDir);
  const installDir = join(cacheDir, 'electron', entry.sha256);
  const executablePath = join(installDir, getElectronExecutableRelPath());

  if (existsSync(executablePath)) {
    return { entry, installDir, executablePath, cacheHit: true };
  }

  const archivePath = join(cacheDir, `${entry.sha256}.tar.zst`);
  const fetchFn = options.fetchImpl ?? fetch;
  if (!existsSync(archivePath)) {
    const url = entry.download_url || `${HOLO_CAS_BASE_URL}/${entry.sha256}`;
    const res = await fetchFn(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'awesome-os-electron/0.2.0' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} hydrating ${entry.filename} from ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const actual = createHash('sha256').update(buf).digest('hex');
    if (actual !== entry.sha256) {
      throw new Error(`SHA-256 mismatch for ${entry.filename}: expected ${entry.sha256}, got ${actual}`);
    }
    const tmp = `${archivePath}.${process.pid}.tmp`;
    writeFileSync(tmp, buf);
    renameSync(tmp, archivePath);
  }

  mkdirSync(installDir, { recursive: true });
  execFileSync('tar', ['--zstd', '-xf', archivePath, '-C', installDir], { stdio: 'inherit' });

  if (!existsSync(executablePath)) {
    throw new Error(`Extracted Electron archive missing expected binary: ${executablePath}`);
  }

  return { entry, installDir, executablePath, cacheHit: false };
}

export interface HoloAbiAddonResult {
  entry: ElectronCasEntry;
  addonPath: string;
  cacheDir: string;
  cacheHit: boolean;
}

export function getHoloAbiAssetKey(): string {
  if (process.platform === 'win32') return 'b8g-holo-abi-win64.node';
  if (process.platform === 'darwin') return 'b8g-holo-abi-macos-arm64.node';
  return process.arch === 'arm64' ? 'b8g-holo-abi-linux-arm64.node' : 'b8g-holo-abi-linux-x64.node';
}

export async function resolveHoloAbiEntry(
  assetKey = getHoloAbiAssetKey(),
  options: { index?: HoloIndex; fetchImpl?: typeof fetch } = {},
): Promise<ElectronCasEntry> {
  const idx = options.index ?? (await fetchHoloIndex({ fetchImpl: options.fetchImpl }));
  const entry = idx.entries[assetKey];
  if (!entry) {
    throw new Error(
      `Holo ABI addon "${assetKey}" not found in holo-v11 index (${idx.total_entries} entries)`,
    );
  }
  return entry;
}

export async function ensureHoloAbiAddonPath(
  assetKey = getHoloAbiAssetKey(),
  options: { index?: HoloIndex; cacheDir?: string; fetchImpl?: typeof fetch } = {},
): Promise<HoloAbiAddonResult> {
  const entry = await resolveHoloAbiEntry(assetKey, options);
  const cacheDir = getCasCacheDir(options.cacheDir);
  const addonDir = join(cacheDir, 'holo-abi', entry.sha256);
  const addonPath = join(addonDir, entry.filename);

  if (existsSync(addonPath)) {
    return { entry, addonPath, cacheDir, cacheHit: true };
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const url = entry.download_url || `${HOLO_CAS_BASE_URL}/${entry.sha256}`;
  const res = await fetchFn(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'awesome-os-electron/0.2.0' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} hydrating ${entry.filename} from ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const actual = createHash('sha256').update(buf).digest('hex');
  if (actual !== entry.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${entry.filename}: expected ${entry.sha256}, got ${actual}`,
    );
  }

  mkdirSync(addonDir, { recursive: true });
  const tmp = `${addonPath}.${process.pid}.tmp`;
  writeFileSync(tmp, buf);
  renameSync(tmp, addonPath);

  return { entry, addonPath, cacheDir, cacheHit: false };
}
