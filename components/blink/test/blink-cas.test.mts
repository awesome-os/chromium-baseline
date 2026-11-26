import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_CAS_BASE_URL,
  auditBlinkCasShards,
  loadBlinkGnOverlay,
  type CasEntry,
  type CasIndex,
} from "../src/index.mts";

const CORE_C_SHARDS = [
  "libbrotli",
  "libwebp",
  "libexpat",
  "libsqlite3",
  "liblz4",
  "libsectium_display",
] as const;

function makeEntry(filename: string, bytes = 65536): CasEntry {
  const sha = "a".repeat(64);
  return {
    filename,
    sha256: sha,
    bytes,
    category: "holo-v11",
    download_url: `${DEFAULT_CAS_BASE_URL}/${filename}`,
  };
}

function makeMockHoloIndex(): CasIndex {
  return {
    schema: "awesome-os-cas-v11-manifest-v1",
    cas_base_url: DEFAULT_CAS_BASE_URL,
    baseline_tag: "v0.7.0-baseline",
    updated_at: "2026-11-26T18:00:00.000Z",
    total_entries: 12,
    entries: {
      "libbrotli-linux-x64.so": makeEntry("libbrotli-linux-x64.so"),
      "libwebp-linux-x64.so": makeEntry("libwebp-linux-x64.so"),
      "libexpat-linux-x64.so": makeEntry("libexpat-linux-x64.so"),
      "libsqlite3-linux-x64.so": makeEntry("libsqlite3-linux-x64.so"),
      "liblz4-linux-x64.so": makeEntry("liblz4-linux-x64.so"),
      "libsectium_display-linux-x64.so": makeEntry("libsectium_display-linux-x64.so"),
      "b8g-holo-abi-win64.node": makeEntry("b8g-holo-abi-win64.node"),
      "b8g-holo-abi-linux-x64.node": makeEntry("b8g-holo-abi-linux-x64.node"),
      "b8g-holo-abi-linux-arm64.node": makeEntry("b8g-holo-abi-linux-arm64.node"),
      "b8g-holo-abi-macos-arm64.node": makeEntry("b8g-holo-abi-macos-arm64.node"),
      "v8-shared-linux-x64.tar.gz": makeEntry("v8-shared-linux-x64.tar.gz", 12_000_000),
      "libskia-linux-x64.so": makeEntry("libskia-linux-x64.so", 4_500_000),
      "libwebgpu_dawn-linux-x64.so": makeEntry("libwebgpu_dawn-linux-x64.so", 6_200_000),
    },
  };
}

describe("@awesome-os/blink holo-v11 shard resolution", () => {
  it("resolves all core C shards, b8g-holo-abi, and shared V8 from awesome-os/holo-v11", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response(JSON.stringify(makeMockHoloIndex()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const report = await auditBlinkCasShards(undefined, mockFetch);

    assert.equal(report.schema, "awesome-os-cas-v11-manifest-v1");
    assert.equal(report.casBaseUrl, DEFAULT_CAS_BASE_URL);
    assert.ok(report.totalIndexEntries > 0, "holo-v11 index must not be empty");
    assert.equal(report.allCoreResolved, true, "All required holo-v11 shards must resolve");

    const byId = new Map(report.shards.map((shard) => [shard.id, shard]));

    for (const shardId of CORE_C_SHARDS) {
      const shard = byId.get(shardId);
      assert.ok(shard, `Missing audit entry for ${shardId}`);
      assert.equal(shard.status, "resolved", `${shardId} must resolve in holo-v11`);
      assert.ok(shard.matchedCount > 0, `${shardId} must have at least one artifact`);
      assert.ok(shard.totalBytes > 0, `${shardId} must have non-zero byte size`);
      for (const artifact of shard.artifacts) {
        assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
        assert.ok(artifact.download_url.startsWith(DEFAULT_CAS_BASE_URL));
      }
    }

    const abiShard = byId.get("b8g-holo-abi");
    assert.ok(abiShard);
    assert.equal(abiShard.status, "resolved");
    assert.ok(abiShard.matchedCount >= 4, "b8g-holo-abi must cover 4 host targets");

    assert.equal(report.engineStatus.v8, "resolved");
    assert.equal(report.engineStatus.skia, "resolved");
    assert.equal(report.engineStatus.dawn, "resolved");
  });

  it("validates config/blink-component-cas.gn component overlay flags", async () => {
    const overlay = await loadBlinkGnOverlay();

    assert.equal(overlay.flags["is_component_build"], true);
    assert.equal(overlay.flags["v8_use_external_startup_data"], true);
    assert.equal(overlay.flags["use_system_libbrotli"], true);
    assert.equal(overlay.flags["use_system_libwebp"], true);
    assert.equal(overlay.flags["use_system_expat"], true);
    assert.equal(overlay.flags["use_v8_cas_shard"], true);
    assert.equal(overlay.flags["use_skia_cas_shard"], true);
    assert.equal(overlay.flags["use_dawn_cas_shard"], true);
    assert.equal(overlay.flags["use_sectium_display_shard"], true);
    assert.equal(overlay.flags["holo_cas_tag"], "cas-v11");
    assert.equal(overlay.flags["holo_cas_repo"], "awesome-os/holo-v11");
  });
});
