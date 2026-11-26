import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  HOLO_CAS_BASE_URL,
  ensureElectronBinary,
  ensureHoloAbiAddonPath,
  getElectronAssetKey,
  getElectronExecutableRelPath,
  getHoloAbiAssetKey,
  resolveElectronEntry,
  type HoloIndex,
} from '../src/index.mts';

test('resolves rolling-latest debloated Electron from awesome-os/holo-v11', async () => {
  const key = getElectronAssetKey();
  const mockIndex: HoloIndex = {
    schema: 'awesome-os-cas-v11-manifest-v1',
    cas_base_url: HOLO_CAS_BASE_URL,
    updated_at: '2026-11-26T18:00:00.000Z',
    total_entries: 1,
    entries: {
      [key]: {
        filename: key,
        sha256: 'e'.repeat(64),
        bytes: 48_000_000,
        raw_bytes: 112_000_000,
        version: '40.0.0-holo',
        download_url: `${HOLO_CAS_BASE_URL}/${key}`,
      },
    },
  };

  const entry = await resolveElectronEntry(key, { index: mockIndex });
  assert.equal(entry.filename, key);
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  assert.ok(entry.bytes > 10_000_000, 'Expected real upstream Electron archive (>10 MB)');
  if (entry.raw_bytes) {
    assert.ok(
      entry.bytes < entry.raw_bytes,
      `Expected debloated zst (${entry.bytes}) < upstream zip (${entry.raw_bytes})`,
    );
  }
});

test('detects warm Electron binary cache hit inside B8G_CAS_DIR', async () => {
  const casDir = mkdtempSync(join(tmpdir(), 'electron-holo-cas-'));
  try {
    const key = getElectronAssetKey();
    const sha = 'a'.repeat(64);
    const exePath = join(casDir, 'electron', sha, getElectronExecutableRelPath());
    mkdirSync(join(exePath, '..'), { recursive: true });
    writeFileSync(exePath, 'stub-electron-binary');

    const mockIndex: HoloIndex = {
      schema: 'awesome-os-cas-v11-manifest-v1',
      cas_base_url: HOLO_CAS_BASE_URL,
      updated_at: '2026-11-26T18:00:00.000Z',
      total_entries: 1,
      entries: {
        [key]: {
          filename: key,
          sha256: sha,
          bytes: 48_000_000,
          download_url: `${HOLO_CAS_BASE_URL}/${key}`,
        },
      },
    };

    const hit = await ensureElectronBinary({ index: mockIndex, cacheDir: casDir });
    assert.equal(existsSync(hit.executablePath), true);
    assert.equal(hit.cacheHit, true);
  } finally {
    rmSync(casDir, { recursive: true, force: true });
  }
});

test('hydrates b8g-holo-abi.node from holo-v11 with SHA-256 verification and cache hit', async () => {
  const casDir = mkdtempSync(join(tmpdir(), 'electron-abi-cas-'));
  try {
    const expectedKey = getHoloAbiAssetKey();
    const payload = Buffer.from('HOLO-ABI-V3-NODE-ADDON-BYTES');
    const sha = createHash('sha256').update(payload).digest('hex');

    const mockIndex: HoloIndex = {
      schema: 'awesome-os-cas-v11-manifest-v1',
      cas_base_url: HOLO_CAS_BASE_URL,
      updated_at: '2026-11-26T18:00:00.000Z',
      total_entries: 1,
      entries: {
        [expectedKey]: {
          filename: expectedKey,
          sha256: sha,
          bytes: payload.byteLength,
          download_url: `${HOLO_CAS_BASE_URL}/${expectedKey}`,
        },
      },
    };

    const mockFetch: typeof fetch = async () => new Response(payload, { status: 200 });

    const first = await ensureHoloAbiAddonPath(expectedKey, {
      index: mockIndex,
      cacheDir: casDir,
      fetchImpl: mockFetch,
    });
    assert.equal(first.entry.filename, expectedKey);
    assert.equal(first.entry.sha256, sha);
    assert.equal(existsSync(first.addonPath), true);
    assert.equal(first.cacheHit, false);
    assert.ok(first.addonPath.endsWith('.node'));

    const second = await ensureHoloAbiAddonPath(expectedKey, {
      index: mockIndex,
      cacheDir: casDir,
      fetchImpl: mockFetch,
    });
    assert.equal(second.addonPath, first.addonPath);
    assert.equal(second.cacheHit, true);
  } finally {
    rmSync(casDir, { recursive: true, force: true });
  }
});
