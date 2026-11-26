import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const FFIType = {
  char: 0,
  i8: 0,
  int8_t: 0,
  u8: 1,
  uint8_t: 1,
  i16: 2,
  int16_t: 2,
  u16: 3,
  uint16_t: 3,
  i32: 4,
  int32_t: 4,
  u32: 5,
  uint32_t: 5,
  i64: 6,
  int64_t: 6,
  u64: 7,
  uint64_t: 7,
  f32: 8,
  float: 8,
  f64: 9,
  double: 9,
  bool: 10,
  ptr: 11,
  pointer: 11,
  cstring: 12,
  void: 13,
  usize: 14,
  isize: 15,
  function: 16,
  napi_value: 17,
} as const;

export type FFITypeName = keyof typeof FFIType;
export type FFITypeValue = (typeof FFIType)[FFITypeName] | FFITypeName;

export const suffix: 'dll' | 'dylib' | 'so' =
  process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so';

export type Pointer = number;

const POINTER_BASE = 0x1000_0000;
let nextPointerId = POINTER_BASE;
const pointerRegistry = new Map<Pointer, Uint8Array>();

export function ptr(buf: ArrayBufferView | ArrayBuffer, byteOffset = 0): Pointer {
  let view: Uint8Array;
  if (buf instanceof ArrayBuffer) {
    view = new Uint8Array(buf, byteOffset);
  } else if (ArrayBuffer.isView(buf)) {
    view = new Uint8Array(buf.buffer, buf.byteOffset + byteOffset, buf.byteLength - byteOffset);
  } else {
    throw new TypeError('ptr() expects an ArrayBuffer or ArrayBufferView');
  }
  const id = nextPointerId;
  nextPointerId += Math.max(8, view.byteLength + 8);
  pointerRegistry.set(id, view);
  return id;
}

export function toArrayBuffer(
  pointer: Pointer,
  byteOffset = 0,
  byteLength?: number,
): ArrayBuffer {
  const view = pointerRegistry.get(pointer);
  if (!view) {
    throw new RangeError(`Invalid or unregistered FFI pointer: 0x${pointer.toString(16)}`);
  }
  const start = view.byteOffset + byteOffset;
  const end = byteLength !== undefined ? start + byteLength : view.byteOffset + view.byteLength;
  if (start < view.byteOffset || end > view.byteOffset + view.byteLength || start > end) {
    throw new RangeError('toArrayBuffer range out of bounds');
  }
  return view.buffer.slice(start, end) as ArrayBuffer;
}

export class CString {
  readonly ptr: Pointer;
  readonly byteOffset: number;
  readonly byteLength: number;
  private readonly decoded: string;

  constructor(
    ptrOrBuf: Pointer | Uint8Array | ArrayBuffer,
    byteOffset = 0,
    byteLength?: number,
  ) {
    let view: Uint8Array;
    if (typeof ptrOrBuf === 'number') {
      const registered = pointerRegistry.get(ptrOrBuf);
      if (!registered) {
        throw new RangeError(`Invalid or unregistered CString pointer: 0x${ptrOrBuf.toString(16)}`);
      }
      this.ptr = ptrOrBuf;
      view = registered;
    } else if (ptrOrBuf instanceof ArrayBuffer) {
      this.ptr = ptr(ptrOrBuf, byteOffset);
      view = new Uint8Array(ptrOrBuf);
    } else if (ptrOrBuf instanceof Uint8Array) {
      this.ptr = ptr(ptrOrBuf, byteOffset);
      view = ptrOrBuf;
    } else {
      throw new TypeError('CString expects a Pointer, Uint8Array, or ArrayBuffer');
    }

    this.byteOffset = byteOffset;
    const slice = view.subarray(
      byteOffset,
      byteLength !== undefined ? byteOffset + byteLength : undefined,
    );
    let nulIndex = slice.indexOf(0);
    if (nulIndex === -1) nulIndex = slice.length;
    this.byteLength = nulIndex;
    this.decoded = new TextDecoder().decode(slice.subarray(0, nulIndex));
  }

  toString(): string {
    return this.decoded;
  }

  valueOf(): string {
    return this.decoded;
  }
}

export interface FFISymbolDef {
  args?: readonly FFITypeValue[];
  returns?: FFITypeValue;
}

export type FFISymbolMap = Record<string, FFISymbolDef>;

export interface FFILibrary<T extends FFISymbolMap> {
  readonly path: string;
  readonly symbols: { [K in keyof T]: (...args: unknown[]) => unknown };
  close(): void;
}

function isValidFFIType(val: unknown): val is FFITypeValue {
  if (typeof val === 'string') return val in FFIType;
  if (typeof val === 'number') return Number.isInteger(val) && val >= 0 && val <= 17;
  return false;
}

export function dlopen<T extends FFISymbolMap>(path: string, symbols: T): FFILibrary<T> {
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new TypeError('dlopen requires a non-empty library path');
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`dlopen failed: shared library not found at "${path}"`);
  }
  if (typeof symbols !== 'object' || symbols === null || Array.isArray(symbols)) {
    throw new TypeError('dlopen requires a symbol definition map');
  }

  let closed = false;
  const bound = {} as { [K in keyof T]: (...args: unknown[]) => unknown };

  for (const [name, def] of Object.entries(symbols)) {
    if (typeof def !== 'object' || def === null) {
      throw new TypeError(`Invalid FFI symbol definition for "${name}"`);
    }
    if (def.args !== undefined) {
      if (!Array.isArray(def.args) || !def.args.every(isValidFFIType)) {
        throw new TypeError(`Invalid FFI args specification for symbol "${name}"`);
      }
    }
    if (def.returns !== undefined && !isValidFFIType(def.returns)) {
      throw new TypeError(`Invalid FFI return type for symbol "${name}"`);
    }

    const expectedArgs = def.args?.length ?? 0;
    bound[name as keyof T] = (...callArgs: unknown[]): unknown => {
      if (closed) {
        throw new Error(`FFI library "${path}" has been closed`);
      }
      if (callArgs.length < expectedArgs) {
        throw new TypeError(
          `FFI symbol "${name}" expects at least ${expectedArgs} argument(s), received ${callArgs.length}`,
        );
      }
      throw new Error(
        `FFI native invocation for "${name}" in "${path}" requires a native B8G FFI bridge`,
      );
    };
  }

  return {
    path,
    symbols: bound,
    close(): void {
      closed = true;
    },
  };
}

export interface GhostFFIOptions<T extends FFISymbolMap> {
  readonly lib: string;
  readonly sha256: string;
  readonly downloadUrl?: string;
  readonly casDir?: string;
  readonly symbols: T;
  readonly fetcher?: (url: string) => Promise<Uint8Array>;
}

export interface GhostFFILibrary<T extends FFISymbolMap> extends FFILibrary<T> {
  readonly spec: string;
  readonly sha256: string;
  readonly casHit: boolean;
  dispose(): void;
}

export function getGhostCasDir(override?: string): string {
  if (override && override.trim()) return override;
  if (process.env['B8G_CAS_DIR']?.trim()) return process.env['B8G_CAS_DIR']!;
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
    return join(local, 'AwesomeOS', 'cas');
  }
  return join(homedir(), '.local', 'share', 'awesome-os', 'cas');
}

export async function ghostFFI<T extends FFISymbolMap>(
  spec: string,
  opts: GhostFFIOptions<T>,
): Promise<GhostFFILibrary<T>> {
  const expected = opts.sha256.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new TypeError(`ghostFFI requires a 64-hex SHA-256 digest, got "${opts.sha256}"`);
  }
  const filename =
    opts.lib.endsWith('.dll') || opts.lib.endsWith('.so') || opts.lib.endsWith('.dylib')
      ? opts.lib
      : process.platform === 'win32'
        ? `${opts.lib}.dll`
        : process.platform === 'darwin'
          ? `${opts.lib}-macos-${process.arch === 'arm64' ? 'arm64' : 'x64'}.dylib`
          : `${opts.lib}-linux-${process.arch === 'arm64' ? 'arm64' : 'x64'}.so`;

  const entryDir = join(getGhostCasDir(opts.casDir), expected);
  const targetPath = join(entryDir, filename);
  let casHit = false;

  if (existsSync(targetPath)) {
    const actual = createHash('sha256').update(readFileSync(targetPath)).digest('hex');
    if (actual === expected) casHit = true;
  }

  if (!casHit) {
    const [repo, tag] = spec.split('@');
    const url = opts.downloadUrl ?? `https://github.com/${repo}/releases/download/${tag}/${filename}`;
    const bytes = opts.fetcher
      ? await opts.fetcher(url)
      : new Uint8Array(await (await fetch(url)).arrayBuffer());
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected) {
      throw new Error(`ghostFFI SHA-256 mismatch for ${filename}: expected ${expected}, got ${actual}`);
    }
    mkdirSync(entryDir, { recursive: true });
    const tmp = `${targetPath}.tmp-${process.pid}`;
    writeFileSync(tmp, bytes);
    try {
      renameSync(tmp, targetPath);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
  }

  const lib = dlopen(targetPath, opts.symbols);
  return {
    ...lib,
    spec,
    sha256: expected,
    casHit,
    dispose(): void {
      lib.close();
    },
  };
}
