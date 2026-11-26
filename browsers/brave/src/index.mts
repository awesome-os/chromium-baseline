/**
 * @file browsers/brave/src/index.mts
 * @description Public API for @awesome-os/brave: Holo v11 CAS hydration and launch helpers.
 */

export {
  applyKeepLast5Pin,
  ensureBraveBinary,
  fetchHoloIndex,
  HOLO_CAS_BASE_URL,
  HOLO_INDEX_URL,
  getBraveAssetKey,
  getBraveExecutableRelPath,
  getCasCacheDir,
  resolveBraveEntry,
  tryResolveBraveEntry,
  type HoloCasEntry,
  type HoloCasHistoryItem,
  type HoloIndex,
  type HydratedBraveResult,
} from './hydrate.mts';

export {
  buildLaunchPlan,
  DEFAULT_BRAVE_FLAGS,
  getPackageVersion,
  parseCliArgs,
  runCli,
  type LaunchPlan,
  type ParsedCliArgs,
} from './cli.mts';
