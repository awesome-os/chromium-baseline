import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const DEFAULT_CAS_INDEX_URL =
  "https://raw.githubusercontent.com/awesome-os/holo-v11/main/index/cas-v11-global-manifest.json";

export const DEFAULT_CAS_BASE_URL =
  "https://github.com/awesome-os/holo-v11/releases/download/v11-latest";

export interface CasEntry {
  readonly filename: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly category: string;
  readonly download_url: string;
  readonly version?: string;
}

export interface CasIndex {
  readonly schema: string;
  readonly cas_base_url: string;
  readonly baseline_tag: string;
  readonly updated_at: string;
  readonly total_entries: number;
  readonly entries: Record<string, CasEntry>;
}

export type ShardTier = "core-c" | "abi" | "engine";
export type ShardStatus = "resolved" | "pending-shard";

export interface BlinkShardSpec {
  readonly id: string;
  readonly tier: ShardTier;
  readonly requiredInCas: boolean;
  readonly upstreamRepo: string;
  readonly patterns: readonly RegExp[];
  readonly gnFlag?: string;
}

export interface ShardAuditResult {
  readonly id: string;
  readonly tier: ShardTier;
  readonly requiredInCas: boolean;
  readonly upstreamRepo: string;
  readonly status: ShardStatus;
  readonly gnFlag?: string;
  readonly matchedCount: number;
  readonly totalBytes: number;
  readonly artifacts: readonly CasEntry[];
}

export interface BlinkCasAuditReport {
  readonly indexUrl: string;
  readonly schema: string;
  readonly casBaseUrl: string;
  readonly baselineTag: string;
  readonly updatedAt: string;
  readonly totalIndexEntries: number;
  readonly shards: readonly ShardAuditResult[];
  readonly allCoreResolved: boolean;
  readonly engineStatus: {
    readonly v8: ShardStatus;
    readonly skia: ShardStatus;
    readonly dawn: ShardStatus;
  };
}

export const BLINK_PREREQUISITE_SHARDS: readonly BlinkShardSpec[] = [
  {
    id: "libbrotli",
    tier: "core-c",
    requiredInCas: true,
    upstreamRepo: "awesome-os/holo-v11",
    patterns: [/^libbrotli-/, /^brotli-(include|shared)-/],
    gnFlag: "use_system_libbrotli",
  },
  {
    id: "libwebp",
    tier: "core-c",
    requiredInCas: true,
    upstreamRepo: "awesome-os/holo-v11",
    patterns: [/^libwebp-/],
    gnFlag: "use_system_libwebp",
  },
  {
    id: "libexpat",
    tier: "core-c",
    requiredInCas: true,
    upstreamRepo: "awesome-os/holo-v11",
    patterns: [/^libexpat-/, /^expat-(include|shared)-/],
    gnFlag: "use_system_expat",
  },
  {
    id: "libsqlite3",
    tier: "core-c",
    requiredInCas: true,
    upstreamRepo: "awesome-os/holo-v11",
    patterns: [/^libsqlite3-/, /^sqlite3-(include|shared)-/],
  },
  {
    id: "liblz4",
    tier: "core-c",
    requiredInCas: true,
    upstreamRepo: "awesome-os/holo-v11",
    patterns: [/^liblz4-/],
  },
  {
    id: "libsectium_display",
    tier: "core-c",
    requiredInCas: true,
    upstreamRepo: "awesome-os/holo-v11",
    patterns: [/^libsectium_display/],
    gnFlag: "use_sectium_display_shard",
  },
  {
    id: "b8g-holo-abi",
    tier: "abi",
    requiredInCas: true,
    upstreamRepo: "awesome-os/holo-v11",
    patterns: [/^b8g-holo-abi-/, /^b8g_abi_/],
  },
  {
    id: "v8",
    tier: "engine",
    requiredInCas: true,
    upstreamRepo: "awesome-os/libv8_monolith",
    patterns: [/^v8-(shared|include)-/, /^libv8_monolith/],
    gnFlag: "use_v8_cas_shard",
  },
  {
    id: "skia",
    tier: "engine",
    requiredInCas: false,
    upstreamRepo: "awesome-os/skia",
    patterns: [/^(lib)?skia-/],
    gnFlag: "use_skia_cas_shard",
  },
  {
    id: "dawn",
    tier: "engine",
    requiredInCas: false,
    upstreamRepo: "awesome-os/dawn",
    patterns: [/^(lib)?(webgpu_)?dawn-/],
    gnFlag: "use_dawn_cas_shard",
  },
];

export async function fetchCasIndex(
  indexUrl: string = DEFAULT_CAS_INDEX_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<CasIndex> {
  const response = await fetchImpl(indexUrl, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch holo-v11 index from ${indexUrl}: HTTP ${response.status} ${response.statusText}`,
    );
  }
  const data = (await response.json()) as CasIndex;
  if (!data || typeof data !== "object" || !data.entries) {
    throw new Error(`Invalid cas-v11 index payload from ${indexUrl}`);
  }
  return data;
}

export function resolveShardFromIndex(
  index: CasIndex,
  spec: BlinkShardSpec,
): ShardAuditResult {
  const artifacts: CasEntry[] = [];
  for (const [key, entry] of Object.entries(index.entries)) {
    if (spec.patterns.some((pattern) => pattern.test(key))) {
      artifacts.push(entry);
    }
  }
  artifacts.sort((a, b) => a.filename.localeCompare(b.filename));
  const totalBytes = artifacts.reduce((sum, item) => sum + item.bytes, 0);
  return {
    id: spec.id,
    tier: spec.tier,
    requiredInCas: spec.requiredInCas,
    upstreamRepo: spec.upstreamRepo,
    status: artifacts.length > 0 ? "resolved" : "pending-shard",
    gnFlag: spec.gnFlag,
    matchedCount: artifacts.length,
    totalBytes,
    artifacts,
  };
}

export async function auditBlinkCasShards(
  indexUrl: string = DEFAULT_CAS_INDEX_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<BlinkCasAuditReport> {
  const index = await fetchCasIndex(indexUrl, fetchImpl);
  const shards = BLINK_PREREQUISITE_SHARDS.map((spec) =>
    resolveShardFromIndex(index, spec),
  );

  const byId = new Map(shards.map((s) => [s.id, s]));
  const allCoreResolved = shards
    .filter((s) => s.requiredInCas)
    .every((s) => s.status === "resolved");

  return {
    indexUrl,
    schema: index.schema,
    casBaseUrl: index.cas_base_url,
    baselineTag: index.baseline_tag,
    updatedAt: index.updated_at,
    totalIndexEntries: index.total_entries,
    shards,
    allCoreResolved,
    engineStatus: {
      v8: byId.get("v8")?.status ?? "pending-shard",
      skia: byId.get("skia")?.status ?? "pending-shard",
      dawn: byId.get("dawn")?.status ?? "pending-shard",
    },
  };
}

export interface ParsedGnOverlay {
  readonly flags: Readonly<Record<string, string | boolean | number>>;
  readonly rawLineCount: number;
}

export function parseGnOverlay(content: string): ParsedGnOverlay {
  const flags: Record<string, string | boolean | number> = {};
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const rawVal = trimmed.slice(eqIndex + 1).trim();
    if (rawVal === "true") {
      flags[key] = true;
    } else if (rawVal === "false") {
      flags[key] = false;
    } else if (/^-?\d+$/.test(rawVal)) {
      flags[key] = Number(rawVal);
    } else if (
      (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
      (rawVal.startsWith("'") && rawVal.endsWith("'"))
    ) {
      flags[key] = rawVal.slice(1, -1);
    } else {
      flags[key] = rawVal;
    }
  }
  return { flags, rawLineCount: lines.length };
}

export async function loadBlinkGnOverlay(
  gnPath: string | URL = new URL("../config/blink-component-cas.gn", import.meta.url),
): Promise<ParsedGnOverlay> {
  const content = await readFile(gnPath, "utf8");
  return parseGnOverlay(content);
}

const isDirectEntry =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectEntry) {
  const report = await auditBlinkCasShards();
  console.log(JSON.stringify(report, null, 2));
  if (!report.allCoreResolved) {
    process.exitCode = 1;
  }
}
