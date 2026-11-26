import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  DAWN_CMAKE_PRESET_PATH,
  HOLO_CAS_BASE_URL,
  fetchHoloIndex,
  getHoloAbiAssetKey,
  getSectiumDisplayAssetKey,
  getWebGpuDawnAssetKey,
  resolveDawnPlan,
  type HoloIndex,
} from '../src/index.mts';

describe('@awesome-os/dawn holo-v11 shard integration', () => {
  it('validates config/dawn-cas.cmake standalone shared-library preset flags', () => {
    const cmake = readFileSync(DAWN_CMAKE_PRESET_PATH, 'utf8');
    assert.match(cmake, /set\(BUILD_SHARED_LIBS\s+OFF\b/);
    assert.match(cmake, /set\(DAWN_BUILD_MONOLITHIC_LIBRARY\s+"SHARED"/);
    assert.match(cmake, /set\(DAWN_BUILD_SAMPLES\s+OFF\b/);
    assert.match(cmake, /set\(TINT_BUILD_TESTS\s+OFF\b/);
    assert.match(cmake, /set\(DAWN_FETCH_DEPENDENCIES\s+ON\b/);
  });

  it('computes canonical platform asset keys across win32, linux, and darwin', () => {
    assert.equal(getHoloAbiAssetKey('win32', 'x64'), 'b8g-holo-abi-win64.node');
    assert.equal(getHoloAbiAssetKey('linux', 'x64'), 'b8g-holo-abi-linux-x64.node');
    assert.equal(getHoloAbiAssetKey('linux', 'arm64'), 'b8g-holo-abi-linux-arm64.node');
    assert.equal(getHoloAbiAssetKey('darwin', 'arm64'), 'b8g-holo-abi-macos-arm64.node');

    assert.equal(getSectiumDisplayAssetKey('win32', 'x64'), 'libsectium_display.dll');
    assert.equal(getSectiumDisplayAssetKey('linux', 'x64'), 'libsectium_display-linux-x64.so');
    assert.equal(getSectiumDisplayAssetKey('linux', 'arm64'), 'libsectium_display-linux-arm64.so');
    assert.equal(
      getSectiumDisplayAssetKey('darwin', 'arm64'),
      'libsectium_display-macos-arm64.dylib',
    );

    assert.equal(getWebGpuDawnAssetKey('win32', 'x64'), 'libwebgpu_dawn-win64.dll');
    assert.equal(getWebGpuDawnAssetKey('linux', 'x64'), 'libwebgpu_dawn-linux-x64.so');
    assert.equal(getWebGpuDawnAssetKey('darwin', 'arm64'), 'libwebgpu_dawn-macos-arm64.dylib');
  });

  it('resolves holo-v11 index entries for b8g-holo-abi and libsectium_display', async () => {
    const mockIndex: HoloIndex = {
      schema: 'awesome-os-cas-v11-manifest-v1',
      cas_base_url: HOLO_CAS_BASE_URL,
      updated_at: '2026-11-26T18:00:00.000Z',
      total_entries: 2,
      entries: {
        [getHoloAbiAssetKey()]: {
          filename: getHoloAbiAssetKey(),
          sha256: 'a'.repeat(64),
          bytes: 12616,
          download_url: `${HOLO_CAS_BASE_URL}/${'a'.repeat(64)}`,
        },
        [getSectiumDisplayAssetKey()]: {
          filename: getSectiumDisplayAssetKey(),
          sha256: 'b'.repeat(64),
          bytes: 22952,
          download_url: `${HOLO_CAS_BASE_URL}/${'b'.repeat(64)}`,
        },
      },
    };

    const index = await fetchHoloIndex({
      forceRefresh: true,
      fetchImpl: async () => new Response(JSON.stringify(mockIndex), { status: 200 }),
    });
    assert.equal(index.schema, 'awesome-os-cas-v11-manifest-v1');
    assert.ok(index.total_entries > 0);

    const plan = await resolveDawnPlan({ index });
    assert.equal(plan.holoAbi.status, 'ready');
    assert.equal(plan.sectiumDisplay.status, 'ready');
    assert.equal(plan.webgpuDawn.status, 'pending');
    assert.equal(plan.readyCount, 2);
  });

  it('resolveDawnPlan() transitions to status=ready when libwebgpu_dawn is present in index', async () => {
    const syntheticIndex: HoloIndex = {
      schema: 'awesome-os-cas-v11-manifest-v1',
      cas_base_url: HOLO_CAS_BASE_URL,
      updated_at: '2026-11-26T00:00:00.000Z',
      total_entries: 3,
      entries: {
        'b8g-holo-abi-linux-x64.node': {
          filename: 'b8g-holo-abi-linux-x64.node',
          sha256: 'a'.repeat(64),
          bytes: 12616,
          download_url: `${HOLO_CAS_BASE_URL}/${'a'.repeat(64)}`,
        },
        'libsectium_display-linux-x64.so': {
          filename: 'libsectium_display-linux-x64.so',
          sha256: 'b'.repeat(64),
          bytes: 22952,
          download_url: `${HOLO_CAS_BASE_URL}/${'b'.repeat(64)}`,
        },
        'libwebgpu_dawn-linux-x64.so': {
          filename: 'libwebgpu_dawn-linux-x64.so',
          sha256: 'c'.repeat(64),
          bytes: 18432000,
          download_url: `${HOLO_CAS_BASE_URL}/${'c'.repeat(64)}`,
        },
      },
    };

    const plan = await resolveDawnPlan({
      platform: 'linux',
      arch: 'x64',
      index: syntheticIndex,
    });

    assert.equal(plan.status, 'ready');
    assert.equal(plan.readyCount, 3);
    assert.deepEqual(plan.pendingKeys, []);
    assert.equal(plan.webgpuDawn.status, 'ready');
    assert.equal(plan.webgpuDawn.entry?.sha256, 'c'.repeat(64));
  });
});
