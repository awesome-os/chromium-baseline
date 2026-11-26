/**
 * @file components/libv8_monolith/holo-v8.mts
 * @description Zero-dependency O(1) Holo v11 CAS V8 Hydrator for `awesome-os/chromium-baseline`
 * (`components/libv8_monolith`), `lo`, `just-js`, `node`, `deno`, `bun-neon`, `sectium`, `electron`, and `brave`.
 * Replaces legacy 250 MB static `libv8_monolith.a` duplication with shared V8 `16.0.88+`
 * (`libv8.so` / `v8.dll` / `libv8_monolith`) hydrated from `awesome-os/holo-v11` (`dup_v8 = 0 B`).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const HOLO_V11_INDEX_URL =
  'https://raw.githubusercontent.com/awesome-os/holo-v11/main/index/cas-v11-global-manifest.json';

export const V8_BASELINE_VERSION = '16.0.88+';

export interface HoloV11Entry {
  readonly filename: string;
  readonly sha512?: string;
  readonly sha256?: string;
  readonly size?: number;
  readonly bytes?: number;
  readonly downloadUrl?: string;
  readonly download_url?: string;
  readonly blobPath?: string;
}

export interface HoloV11Manifest {
  readonly schema: string;
  readonly abiMagic?: string;
  readonly version?: string;
  readonly entries: readonly HoloV11Entry[] | Record<string, HoloV11Entry>;
}

export function getCasDir(): string {
  if (process.env['B8G_CAS_DIR']?.trim()) return process.env['B8G_CAS_DIR']!;
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'AwesomeOS', 'cas');
  }
  return join(homedir(), '.b8g', 'cas');
}

function normalizeEntries(entries: HoloV11Manifest['entries']): Map<string, HoloV11Entry> {
  const map = new Map<string, HoloV11Entry>();
  if (Array.isArray(entries)) {
    for (const item of entries) {
      if (item?.filename) map.set(item.filename, item);
    }
  } else if (entries && typeof entries === 'object') {
    for (const [k, item] of Object.entries(entries)) {
      map.set(item.filename || k, item);
    }
  }
  return map;
}

export async function hydrateV8FromHoloCas(opts?: {
  readonly platform?: 'linux-x64' | 'win64' | 'macos-arm64';
  readonly includeHeaders?: boolean;
  readonly verifyOnly?: boolean;
  readonly indexUrl?: string;
  readonly fetchImpl?: typeof fetch;
}) {
  const fetchFn = opts?.fetchImpl ?? fetch;
  const indexUrl = opts?.indexUrl ?? HOLO_V11_INDEX_URL;
  const res = await fetchFn(indexUrl);
  if (!res.ok) throw new Error(`Failed to fetch Holo v11 index: HTTP ${res.status}`);
  const idx = (await res.json()) as HoloV11Manifest;
  const entryMap = normalizeEntries(idx.entries);

  const plat =
    opts?.platform ??
    (process.platform === 'win32' ? 'win64' : process.platform === 'darwin' ? 'macos-arm64' : 'linux-x64');
  const v8Pack =
    plat === 'win64'
      ? 'v8-shared-win64.b8p'
      : plat === 'macos-arm64'
        ? 'v8-shared-macos-arm64.tar.gz'
        : 'v8-shared-linux-x64.tar.gz';
  const hdrPack = Array.from(entryMap.keys()).find((k) => k.startsWith('v8-include-') && k.endsWith('.tar.gz'));

  const targets = [v8Pack, ...(opts?.includeHeaders !== false && hdrPack ? [hdrPack] : [])];
  const results: Array<{ filename: string; digest: string; bytes: number; casHit: boolean; path?: string }> = [];

  for (const name of targets) {
    const entry = entryMap.get(name) ?? (plat === 'win64' ? entryMap.get('v8-shared-win64.zip') : undefined);
    if (!entry) throw new Error(`Missing "${name}" in canonical Holo v11 CAS index (${indexUrl})`);

    const expectedSha512 = entry.sha512?.toLowerCase();
    const expectedSha256 = entry.sha256?.toLowerCase();
    const digest = expectedSha512 ?? expectedSha256 ?? '';
    const algo = expectedSha512 ? 'sha512' : 'sha256';
    const bytesLen = entry.size ?? entry.bytes ?? 0;
    const downloadUrl = entry.downloadUrl ?? entry.download_url ?? '';

    if (opts?.verifyOnly) {
      results.push({ filename: entry.filename, digest, bytes: bytesLen, casHit: false });
      continue;
    }

    const dir = entry.blobPath
      ? join(getCasDir(), entry.blobPath)
      : join(getCasDir(), 'v11', 'files', digest.slice(0, 2), digest);
    const targetPath = entry.blobPath ? dir : join(dir, entry.filename);

    if (existsSync(targetPath)) {
      const actual = createHash(algo).update(readFileSync(targetPath)).digest('hex');
      if (actual === digest) {
        results.push({ filename: entry.filename, digest, bytes: bytesLen, casHit: true, path: targetPath });
        continue;
      }
    }

    const dl = await fetchFn(downloadUrl);
    if (!dl.ok) throw new Error(`HTTP ${dl.status} downloading ${downloadUrl}`);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    const actual = createHash(algo).update(bytes).digest('hex');
    if (digest && actual !== digest) {
      throw new Error(`${algo.toUpperCase()} mismatch for ${entry.filename}: expected ${digest}, got ${actual}`);
    }
    mkdirSync(entry.blobPath ? join(targetPath, '..') : dir, { recursive: true });
    const tmp = `${targetPath}.tmp-${process.pid}`;
    writeFileSync(tmp, bytes);
    try {
      renameSync(tmp, targetPath);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    results.push({
      filename: entry.filename,
      digest: actual,
      bytes: bytes.byteLength,
      casHit: false,
      path: targetPath,
    });
  }
  return results;
}

if (process.argv[1]?.endsWith('holo-v8.mts')) {
  const verifyOnly = process.argv.includes('--verify');
  const platArg = process.argv.find((a) => a.startsWith('--platform='))?.split('=')[1] as
    | 'linux-x64'
    | 'win64'
    | 'macos-arm64'
    | undefined;
  hydrateV8FromHoloCas({ platform: platArg, verifyOnly }).then((rows) => {
    for (const r of rows) {
      console.log(
        `[libv8_monolith:holo-v11] ${verifyOnly ? 'INDEX-OK' : r.casHit ? 'CAS-HIT ' : 'HYDRATED'} ${r.filename} (${r.bytes} B, digest=${r.digest.slice(0, 16)}...)`,
      );
    }
  });
}
