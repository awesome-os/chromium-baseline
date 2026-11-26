import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CAS_BASE_URL,
  DEFAULT_CAS_INDEX_URL,
  SKIA_CAS_GN_PATH,
  fetchCasIndex,
  loadSkiaGnArgs,
  renderSkiaFrameToAnsiHalfBlocks,
  renderSkiaFrameToKittyProtocol,
  resolveSkiaPlan,
  type CasIndex,
} from '../src/index.mts';

test('config/skia-cas.gn declares standalone component + Dawn GPU + system CAS shard flags', async () => {
  const args = await loadSkiaGnArgs(SKIA_CAS_GN_PATH);

  assert.equal(args.is_component_build, true);
  assert.equal(args.is_official_build, true);
  assert.equal(args.skia_enable_tools, false);
  assert.equal(args.skia_use_system_expat, true);
  assert.equal(args.skia_use_system_libwebp, true);
  assert.equal(args.skia_enable_gpu, true);
  assert.equal(args.skia_use_dawn, true);
});

test('holo-v11 index resolves libwebp, libexpat, and holo-llvm prerequisites across targets', async () => {
  const mockIndex: CasIndex = {
    schema: 'awesome-os-cas-v11-manifest-v1',
    cas_base_url: DEFAULT_CAS_BASE_URL,
    entries: {
      'libwebp-linux-x64.so': {
        filename: 'libwebp-linux-x64.so',
        sha256: 'a'.repeat(64),
        bytes: 631784,
        category: 'holo-5os',
        download_url: `${DEFAULT_CAS_BASE_URL}/${'a'.repeat(64)}`,
      },
      'libexpat-linux-x64.so': {
        filename: 'libexpat-linux-x64.so',
        sha256: 'b'.repeat(64),
        bytes: 203360,
        category: 'holo-5os',
        download_url: `${DEFAULT_CAS_BASE_URL}/${'b'.repeat(64)}`,
      },
      'holo-llvm-21-linux-x64.tar.zst': {
        filename: 'holo-llvm-21-linux-x64.tar.zst',
        sha256: 'd'.repeat(64),
        bytes: 42_000_000,
        category: 'toolchain',
        download_url: `${DEFAULT_CAS_BASE_URL}/${'d'.repeat(64)}`,
      },
    },
  };

  const mockFetch: typeof fetch = async () =>
    new Response(JSON.stringify(mockIndex), { status: 200 });

  const index = await fetchCasIndex(DEFAULT_CAS_INDEX_URL, mockFetch);

  assert.equal(index.schema, 'awesome-os-cas-v11-manifest-v1');
  assert.equal(index.cas_base_url, DEFAULT_CAS_BASE_URL);

  const plan = resolveSkiaPlan(index, 'linux-x64');
  assert.equal(plan.prerequisitesReady, true);

  assert.equal(plan.shards.libwebp.status, 'resolved');
  assert.ok(plan.shards.libwebp.entry);
  assert.match(plan.shards.libwebp.entry.sha256, /^[0-9a-f]{64}$/);
  assert.ok(plan.shards.libwebp.entry.bytes > 0);
  assert.ok(plan.shards.libwebp.entry.download_url.startsWith(`${DEFAULT_CAS_BASE_URL}/`));

  assert.equal(plan.shards.libexpat.status, 'resolved');
  assert.ok(plan.shards.libexpat.entry);
  assert.match(plan.shards.libexpat.entry.sha256, /^[0-9a-f]{64}$/);
  assert.ok(plan.shards.libexpat.entry.bytes > 0);
  assert.ok(plan.shards.libexpat.entry.download_url.startsWith(`${DEFAULT_CAS_BASE_URL}/`));

  assert.equal(plan.shards.holoLlvm.status, 'resolved');
  assert.ok(plan.shards.holoLlvm.entry);
  assert.equal(plan.shards.libskia.status, 'pending');
  assert.match(plan.shards.libskia.reason ?? '', /holo-v11/);
});

test('resolveSkiaPlan handles pending vs resolved libskia deterministically', () => {
  const baseIndex: CasIndex = {
    schema: 'awesome-os-cas-v11-manifest-v1',
    cas_base_url: DEFAULT_CAS_BASE_URL,
    entries: {
      'libwebp-linux-x64.so': {
        filename: 'libwebp-linux-x64.so',
        sha256: 'a'.repeat(64),
        bytes: 631784,
        category: 'holo-5os',
        download_url: `${DEFAULT_CAS_BASE_URL}/${'a'.repeat(64)}`,
      },
      'libexpat-linux-x64.so': {
        filename: 'libexpat-linux-x64.so',
        sha256: 'b'.repeat(64),
        bytes: 203360,
        category: 'holo-5os',
        download_url: `${DEFAULT_CAS_BASE_URL}/${'b'.repeat(64)}`,
      },
    },
  };

  const pendingPlan = resolveSkiaPlan(baseIndex, 'linux-x64');
  assert.equal(pendingPlan.prerequisitesReady, true);
  assert.equal(pendingPlan.skiaReady, false);
  assert.equal(pendingPlan.shards.libskia.status, 'pending');
  assert.equal(pendingPlan.shards.libskia.expectedFilename, 'libskia-linux-x64.so');

  const withSkia: CasIndex = {
    ...baseIndex,
    entries: {
      ...baseIndex.entries,
      'libskia-linux-x64.so': {
        filename: 'libskia-linux-x64.so',
        sha256: 'c'.repeat(64),
        bytes: 12_345_678,
        category: 'chromium-shard',
        download_url: `${DEFAULT_CAS_BASE_URL}/${'c'.repeat(64)}`,
      },
    },
  };

  const resolvedPlan = resolveSkiaPlan(withSkia, 'linux-x64');
  assert.equal(resolvedPlan.prerequisitesReady, true);
  assert.equal(resolvedPlan.skiaReady, true);
  assert.equal(resolvedPlan.shards.libskia.status, 'resolved');
  assert.equal(resolvedPlan.shards.libskia.entry?.sha256, 'c'.repeat(64));
});

test('Skia RGBA framebuffer renders cleanly to TTY ANSI half-blocks and Kitty Graphics Protocol', () => {
  const rgba = new Uint8Array([
    255, 0, 0, 255,   0, 255, 0, 255,
    0, 0, 255, 255,   255, 255, 255, 255,
  ]);
  const ansi = renderSkiaFrameToAnsiHalfBlocks({ width: 2, height: 2, rgba });
  assert.ok(ansi.includes('\x1b[38;2;255;0;0;48;2;0;0;255m\u2580'));
  assert.ok(ansi.endsWith('\x1b[0m'));

  const kitty = renderSkiaFrameToKittyProtocol({ width: 2, height: 2, rgba });
  assert.ok(kitty.startsWith('\x1b_Ga=T,f=32,s=2,v=2,m=0;'));
  assert.ok(kitty.endsWith('\x1b\\'));
});
