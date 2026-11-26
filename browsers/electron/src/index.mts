/**
 * @file browsers/electron/src/index.mts
 * @description Drop-in `electron` package entrypoint powered by `awesome-os/holo-v11` (`cas-v11`).
 */

export {
  HOLO_INDEX_URL,
  HOLO_CAS_BASE_URL,
  getElectronAssetKey,
  getElectronExecutableRelPath,
  getHoloAbiAssetKey,
  getCasCacheDir,
  fetchHoloIndex,
  resolveElectronEntry,
  resolveHoloAbiEntry,
  ensureElectronBinary,
  ensureHoloAbiAddonPath,
  type ElectronCasEntry,
  type HoloAbiAddonResult,
  type HoloIndex,
} from './hydrate.mts';
