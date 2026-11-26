import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_BRAVE_FLAGS,
  HOLO_CAS_BASE_URL,
  applyKeepLast5Pin,
  buildLaunchPlan,
  fetchHoloIndex,
  getBraveAssetKey,
  getBraveExecutableRelPath,
  parseCliArgs,
  tryResolveBraveEntry,
  type HoloCasEntry,
  type HoloIndex,
} from '../src/index.mts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_PATH = resolve(REPO_ROOT, 'src', 'cli.mts');

test('fetches holo-v11 index and resolves brave-* entry deterministically', async () => {
  const braveKey = getBraveAssetKey();
  const mockIndex: HoloIndex = {
    schema: 'awesome-os-cas-v11-manifest-v1',
    cas_base_url: HOLO_CAS_BASE_URL,
    updated_at: '2026-11-26T18:00:00.000Z',
    total_entries: 1,
    entries: {
      [braveKey]: {
        filename: braveKey,
        sha256: 'a'.repeat(64),
        bytes: 95_000_000,
        version: '1.78.0',
        download_url: `${HOLO_CAS_BASE_URL}/${braveKey}`,
      },
    },
  };

  const index = await fetchHoloIndex(true, async () => new Response(JSON.stringify(mockIndex), { status: 200 }));
  assert.ok(index.total_entries > 0);

  const braveEntry = await tryResolveBraveEntry(braveKey, index);
  assert.ok(braveEntry);
  assert.equal(braveEntry.filename, braveKey);
  assert.match(braveEntry.sha256, /^[a-f0-9]{64}$/);
  assert.ok(braveEntry.bytes > 10_000_000);
});

test('maps platform asset keys and executable paths accurately', () => {
  assert.equal(getBraveAssetKey('win32', 'x64'), 'brave-win64.tar.zst');
  assert.equal(getBraveAssetKey('linux', 'x64'), 'brave-linux-x64.tar.zst');
  assert.equal(getBraveAssetKey('linux', 'arm64'), 'brave-linux-arm64.tar.zst');
  assert.equal(getBraveAssetKey('darwin', 'arm64'), 'brave-macos-arm64.tar.zst');

  assert.equal(getBraveExecutableRelPath('win32'), 'brave.exe');
  assert.equal(getBraveExecutableRelPath('linux'), 'brave');
});

test('applies Keep-Last-5 BRAVE_HOLO_SHA256 pin when present in history', () => {
  const latestSha = 'a'.repeat(64);
  const prevSha = 'b'.repeat(64);
  const entry: HoloCasEntry = {
    filename: 'brave-win64.tar.zst',
    sha256: latestSha,
    bytes: 95_000_000,
    version: '1.78.0',
    download_url: `${HOLO_CAS_BASE_URL}/${latestSha}`,
    history: [
      {
        sha256: prevSha,
        bytes: 94_000_000,
        version: '1.77.0',
        retired_at: '2026-11-20T00:00:00Z',
      },
    ],
  };

  const pinned = applyKeepLast5Pin(entry, prevSha);
  assert.equal(pinned.sha256, prevSha);
  assert.equal(pinned.bytes, 94_000_000);
  assert.equal(pinned.version, '1.77.0');
  assert.ok(pinned.download_url.endsWith(`/${prevSha}`));

  const unpinned = applyKeepLast5Pin(entry, 'c'.repeat(64));
  assert.equal(unpinned.sha256, latestSha);
});

test('parses CLI flags (--dry-run, --version, --no-splash, passthrough)', () => {
  const parsed = parseCliArgs(['--dry-run', '--no-splash', 'https://awesome-os.com', '--', '--version']);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.showVersion, false);
  assert.deepEqual(parsed.forwardArgs, ['https://awesome-os.com', '--', '--version']);

  const ver = parseCliArgs(['-v']);
  assert.equal(ver.showVersion, true);
});

test('CLI --version and --dry-run execute cleanly and resolve holo-v11 launch plan', async () => {
  const versionOut = execFileSync(process.execPath, [CLI_PATH, '--version'], {
    encoding: 'utf8',
  }).trim();
  assert.match(versionOut, /^@awesome-os\/brave 0\.2\.0 /);
  assert.ok(versionOut.includes(getBraveAssetKey()));

  const tmpDir = mkdtempSync(join(tmpdir(), 'brave-holo-cli-'));
  try {
    const idxPath = join(tmpDir, 'index.json');
    const braveKey = getBraveAssetKey();
    writeFileSync(
      idxPath,
      JSON.stringify({
        schema: 'awesome-os-cas-v11-manifest-v1',
        cas_base_url: HOLO_CAS_BASE_URL,
        updated_at: '2026-11-26T18:00:00.000Z',
        total_entries: 1,
        entries: {
          [braveKey]: {
            filename: braveKey,
            sha256: 'd'.repeat(64),
            bytes: 95_000_000,
            version: '1.78.0',
            download_url: `${HOLO_CAS_BASE_URL}/${braveKey}`,
          },
        },
      }),
    );

    const dryRunOut = execFileSync(process.execPath, [CLI_PATH, '--dry-run', 'https://example.com'], {
      encoding: 'utf8',
      env: { ...process.env, B8G_CAS_DIR: tmpDir, B8G_CAS_INDEX_PATH: idxPath },
    });
    const plan = JSON.parse(dryRunOut) as Awaited<ReturnType<typeof buildLaunchPlan>>;
    assert.equal(plan.version, '0.2.0');
    assert.deepEqual(plan.defaultFlags, [...DEFAULT_BRAVE_FLAGS]);
    assert.equal(plan.brave.assetKey, braveKey);
    assert.equal(plan.brave.status, 'resolved');
    assert.deepEqual(plan.forwardArgs, ['https://example.com']);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
