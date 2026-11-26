/**
 * @file sections/bun-neon/index.mts
 * @description Public barrel entrypoint for `bun-neon` — zero-JSC Bun API compatibility
 * layer running natively on Awesome-OS erasable TypeScript + `node:sqlite`.
 */

export { Bun, installBunNeonGlobal } from './bun-global.mts';
export { Database } from './bun-sqlite.mts';
export {
  describe,
  test,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  expect,
  mock,
  spyOn,
} from './bun-test.mts';
export { FFIType, suffix, ptr, CString, toArrayBuffer, dlopen } from './bun-ffi.mts';
