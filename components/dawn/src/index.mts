/**
 * @file components/dawn/src/index.mts
 * @description Public entrypoint for `@awesome-os/dawn` — standalone Google Dawn
 *   WebGPU shared library shard wired to `awesome-os/holo-v11` (`cas-v11`) for
 *   Skia Graphite, Sectium Browser, AngryBird, and `B8G_ARENA_V1` 3D workloads.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export {
  DAWN_PACKAGE_VERSION,
  HOLO_CAS_BASE_URL,
  HOLO_INDEX_URL,
  applyPinnedSha,
  fetchHoloIndex,
  getHoloAbiAssetKey,
  getCasCacheDir,
  getSectiumDisplayAssetKey,
  getWebGpuDawnAssetKey,
  getWebGpuDawnAssetKeys,
  hydrateCasArtifact,
  resolveDawnPlan,
  type DawnShardPlan,
  type DawnShardStatus,
  type HoloCasEntry,
  type HoloCasHistoryItem,
  type HoloIndex,
  type HydrateArtifactResult,
  type ResolveDawnPlanOptions,
  type ResolvedCasArtifact,
} from './hydrate.mts';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the standalone Dawn CMake preset file (`config/dawn-cas.cmake`). */
export const DAWN_CMAKE_PRESET_PATH = resolve(MODULE_DIR, '..', 'config', 'dawn-cas.cmake');
