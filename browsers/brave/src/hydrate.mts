/**
 * @file browsers/brave/src/hydrate.mts
 * @description Resolves and hydrates debloated rolling-latest Brave Browser
 *   (`brave-win64.tar.zst` / `brave-linux-x64.tar.zst`) from
 *   `awesome-os/holo-v11` (`cas-v11`) into `$B8G_CAS_DIR/brave/<sha256>/`
 *   with SHA-256 verification, Keep-Last-5 `BRAVE_HOLO_SHA256` pinning,
 *   and streaming `HOLO_PROGRESS <pct> <msg>` output when `BRAVE_PROGRESS=1`.
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

export interface HoloCasHistoryItem {
  sha256: string;
  bytes: number;
  version?: string;
  retired_at?: string;
}

export interface HoloCasEntry {
  filename: string;
  sha256: string;
  bytes: number;
  raw_bytes?: number;
  version?: string;
  category?: string;
  download_url: string;
  history?: HoloCasHistoryItem[];
}

export interface HoloIndex {
  schema: string;
  cas_base_url: string;
  updated_at: string;
  total_entries: number;
  entries: Record<string, HoloCasEntry>;
}

export interface HydratedBraveResult {
  entry: HoloCasEntry;
  installDir: string;
  executablePath: string;
  cacheHit: boolean;
}

let cachedIndex: HoloIndex | null = null;

export function getCasCacheDir(overrideDir?: string): string {
  const dir = overrideDir ?? process.env.B8G_CAS_DIR ?? join(homedir(), '.b8g', 'cas');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getBraveAssetKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  if (platform === 'win32') return 'brave-win64.tar.zst';
  if (platform === 'darwin') return 'brave-macos-arm64.tar.zst';
  return arch === 'arm64' ? 'brave-linux-arm64.tar.zst' : 'brave-linux-x64.tar.zst';
}

export function getBraveExecutableRelPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'brave.exe';
  if (platform === 'darwin') return join('Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser');
  return 'brave';
}

export async function fetchHoloIndex(
  forceRefresh = false,
  fetchImpl: typeof fetch = fetch,
): Promise<HoloIndex> {
  const envIndexPath = process.env.B8G_CAS_INDEX_PATH;
  if (envIndexPath && existsSync(envIndexPath)) {
    const parsed = JSON.parse(readFileSync(envIndexPath, 'utf8')) as HoloIndex;
    cachedIndex = parsed;
    return parsed;
  }
  if (cachedIndex && !forceRefresh) {
    return cachedIndex;
  }
  const cacheFile = join(getCasCacheDir(), 'index.json');
  try {
    const res = await fetchImpl(HOLO_INDEX_URL, {
      headers: { 'User-Agent': 'awesome-os-brave/0.2.0' },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${HOLO_INDEX_URL}`);
    }
    const json = (await res.json()) as HoloIndex;
    try {
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(json, null, 2), 'utf8');
      renameSync(tmp, cacheFile);
    } catch {
      // Non-fatal if cache write races
    }
    cachedIndex = json;
    return json;
  } catch (err) {
    if (existsSync(cacheFile)) {
      cachedIndex = JSON.parse(readFileSync(cacheFile, 'utf8')) as HoloIndex;
      return cachedIndex;
    }
    throw err;
  }
}

export function applyKeepLast5Pin(entry: HoloCasEntry, pinnedSha?: string): HoloCasEntry {
  const sha = pinnedSha?.trim().toLowerCase();
  if (!sha || sha === entry.sha256.toLowerCase()) {
    return entry;
  }
  const hist = entry.history?.find((h) => h.sha256.toLowerCase() === sha);
  if (hist) {
    return {
      ...entry,
      sha256: hist.sha256,
      bytes: hist.bytes,
      version: hist.version ?? entry.version,
      download_url: `${HOLO_CAS_BASE_URL}/${hist.sha256}`,
    };
  }
  return entry;
}

export async function tryResolveBraveEntry(
  assetKey = getBraveAssetKey(),
  index?: HoloIndex,
): Promise<HoloCasEntry | null> {
  const idx = index ?? (await fetchHoloIndex());
  const entry = idx.entries[assetKey];
  if (!entry) {
    return null;
  }
  return applyKeepLast5Pin(entry, process.env.BRAVE_HOLO_SHA256);
}

export async function resolveBraveEntry(
  assetKey = getBraveAssetKey(),
  index?: HoloIndex,
): Promise<HoloCasEntry> {
  const idx = index ?? (await fetchHoloIndex());
  const entry = await tryResolveBraveEntry(assetKey, idx);
  if (!entry) {
    throw new Error(
      `Brave asset "${assetKey}" not found in holo-v11 index (${idx.total_entries} entries).`,
    );
  }
  return entry;
}

function emitProgress(percent: number, message: string): void {
  if (process.env.BRAVE_PROGRESS === '1') {
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    process.stdout.write(`HOLO_PROGRESS ${pct} ${message}\n`);
  }
}

async function downloadVerifiedBlob(
  entry: HoloCasEntry,
  destPath: string,
  pctStart = 10,
  pctEnd = 82,
): Promise<boolean> {
  if (existsSync(destPath)) {
    const actual = createHash('sha256').update(readFileSync(destPath)).digest('hex');
    if (actual === entry.sha256) {
      emitProgress(pctEnd, `Warm CAS hit: ${entry.filename}`);
      return true;
    }
  }

  emitProgress(pctStart, `Hydrating ${entry.filename}...`);
  const url = entry.download_url || `${HOLO_CAS_BASE_URL}/${entry.sha256}`;
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'awesome-os-brave/0.2.0' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} hydrating ${entry.filename} from ${url}`);
  }

  const totalBytes = Number(res.headers.get('content-length') ?? entry.bytes ?? 0);
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastPct = -1;

  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        if (totalBytes > 0) {
          const frac = Math.min(1, received / totalBytes);
          const curPct = Math.round(pctStart + frac * (pctEnd - pctStart));
          if (curPct !== lastPct) {
            lastPct = curPct;
            const mbDone = (received / 1048576).toFixed(1);
            const mbTot = (totalBytes / 1048576).toFixed(1);
            emitProgress(curPct, `Downloading ${entry.filename} (${mbDone} / ${mbTot} MB)`);
          }
        }
      }
    }
  } else {
    chunks.push(new Uint8Array(await res.arrayBuffer()));
  }

  emitProgress(pctEnd, `Verifying SHA-256 for ${entry.filename}...`);
  const buf = Buffer.concat(chunks);
  const actual = createHash('sha256').update(buf).digest('hex');
  if (actual !== entry.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${entry.filename}: expected ${entry.sha256}, got ${actual}`,
    );
  }

  const tmp = `${destPath}.${process.pid}.tmp`;
  writeFileSync(tmp, buf);
  renameSync(tmp, destPath);
  return false;
}

function locateExtractedExecutable(installDir: string, platform: NodeJS.Platform = process.platform): string | null {
  const candidates =
    platform === 'win32'
      ? [
          join(installDir, 'brave.exe'),
          join(installDir, 'Brave-Browser', 'brave.exe'),
          join(installDir, 'Application', 'brave.exe'),
        ]
      : platform === 'darwin'
        ? [join(installDir, 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser')]
        : [
            join(installDir, 'brave'),
            join(installDir, 'brave-browser'),
            join(installDir, 'opt', 'brave.com', 'brave', 'brave'),
          ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function ensureBraveBinary(
  assetKey = getBraveAssetKey(),
): Promise<HydratedBraveResult> {
  const entry = await resolveBraveEntry(assetKey);
  const cacheDir = getCasCacheDir();
  const installDir = join(cacheDir, 'brave', entry.sha256);

  const existing = locateExtractedExecutable(installDir);
  if (existing) {
    emitProgress(92, `Warm CAS hit: Brave ${entry.version ?? ''}`.trim());
    return { entry, installDir, executablePath: existing, cacheHit: true };
  }

  const archivePath = join(cacheDir, `${entry.sha256}.tar.zst`);
  await downloadVerifiedBlob(entry, archivePath, 10, 80);

  emitProgress(84, `Extracting Brave ${entry.version ?? ''}...`.trim());
  mkdirSync(installDir, { recursive: true });
  execFileSync('tar', ['--zstd', '-xf', archivePath, '-C', installDir], { stdio: 'inherit' });

  const executablePath = locateExtractedExecutable(installDir);
  if (!executablePath) {
    const expected = join(installDir, getBraveExecutableRelPath());
    throw new Error(`Extracted Brave archive missing expected binary: ${expected}`);
  }

  emitProgress(96, 'Brave (Shields) ready');
  return { entry, installDir, executablePath, cacheHit: false };
}
