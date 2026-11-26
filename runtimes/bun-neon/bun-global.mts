import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { access, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, isAbsolute, join } from 'node:path';
import { spawn as nodeSpawn, spawnSync as nodeSpawnSync, type SpawnOptions } from 'node:child_process';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { inspect as nodeInspect, isDeepStrictEqual } from 'node:util';

const START_NS = process.hrtime.bigint();

const MIME_TYPES: Record<string, string> = {
  '.txt': 'text/plain;charset=utf-8',
  '.html': 'text/html;charset=utf-8',
  '.htm': 'text/html;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.js': 'text/javascript;charset=utf-8',
  '.mjs': 'text/javascript;charset=utf-8',
  '.cjs': 'text/javascript;charset=utf-8',
  '.ts': 'text/typescript;charset=utf-8',
  '.mts': 'text/typescript;charset=utf-8',
  '.json': 'application/json;charset=utf-8',
  '.xml': 'application/xml;charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.md': 'text/markdown;charset=utf-8',
  '.csv': 'text/csv;charset=utf-8',
};

function resolveFilePath(filePath: string | URL): string {
  return filePath instanceof URL ? fileURLToPath(filePath) : filePath;
}

function guessMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

export interface BunFile {
  readonly name: string;
  readonly size: number;
  readonly type: string;
  exists(): Promise<boolean>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  bytes(): Promise<Uint8Array>;
  arrayBuffer(): Promise<ArrayBuffer>;
  stream(): ReadableStream<Uint8Array>;
}

class BunFileImpl implements BunFile {
  readonly name: string;
  readonly type: string;

  constructor(filePath: string | URL) {
    this.name = resolveFilePath(filePath);
    this.type = guessMimeType(this.name);
  }

  get size(): number {
    try {
      return statSync(this.name).size;
    } catch {
      return 0;
    }
  }

  async exists(): Promise<boolean> {
    try {
      await access(this.name);
      return true;
    } catch {
      return false;
    }
  }

  async bytes(): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of createReadStream(this.name)) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const buf = Buffer.concat(chunks);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  async text(): Promise<string> {
    const bytes = await this.bytes();
    return new TextDecoder().decode(bytes);
  }

  async json<T = unknown>(): Promise<T> {
    const text = await this.text();
    return JSON.parse(text) as T;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await this.bytes();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  stream(): ReadableStream<Uint8Array> {
    return Readable.toWeb(createReadStream(this.name)) as ReadableStream<Uint8Array>;
  }
}

function isBunFile(value: unknown): value is BunFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'bytes' in value &&
    typeof (value as BunFile).bytes === 'function'
  );
}

export type BunWriteData = string | Uint8Array | ArrayBuffer | Response | BunFile;

async function bunWrite(dest: string | URL | BunFile, data: BunWriteData): Promise<number> {
  const destPath = isBunFile(dest) ? dest.name : resolveFilePath(dest);
  let bytes: Uint8Array;

  if (typeof data === 'string') {
    bytes = Buffer.from(data, 'utf8');
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (typeof Response !== 'undefined' && data instanceof Response) {
    bytes = new Uint8Array(await data.arrayBuffer());
  } else if (isBunFile(data)) {
    bytes = await data.bytes();
  } else {
    throw new TypeError('Unsupported data type for Bun.write');
  }

  await writeFile(destPath, bytes);
  return bytes.byteLength;
}

export interface ServeOptions {
  port?: number;
  hostname?: string;
  fetch: (req: Request) => Response | Promise<Response>;
  error?: (err: Error) => Response | Promise<Response>;
}

export interface BunServer {
  readonly port: number;
  readonly hostname: string;
  readonly url: URL;
  stop(closeActive?: boolean): Promise<void>;
  reload(next: Partial<ServeOptions>): void;
}

async function readIncomingBody(req: IncomingMessage): Promise<Buffer | undefined> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    return undefined;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function bunServe(opts: ServeOptions): BunServer {
  let activeFetch = opts.fetch;
  let activeError = opts.error;
  const hostname = opts.hostname ?? '127.0.0.1';
  const requestedPort = opts.port ?? 3000;

  const server: Server = createServer(async (nodeReq: IncomingMessage, nodeRes: ServerResponse) => {
    try {
      const addr = server.address() as AddressInfo | null;
      const boundPort = addr?.port ?? requestedPort;
      const hostHeader = nodeReq.headers.host ?? `${hostname}:${boundPort}`;
      const reqUrl = `http://${hostHeader}${nodeReq.url ?? '/'}`;

      const headers = new Headers();
      for (const [key, value] of Object.entries(nodeReq.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) headers.append(key, item);
        } else {
          headers.set(key, value);
        }
      }

      const bodyBuf = await readIncomingBody(nodeReq);
      const init: RequestInit = {
        method: nodeReq.method ?? 'GET',
        headers,
      };
      if (bodyBuf !== undefined) {
        init.body = new Uint8Array(bodyBuf.buffer, bodyBuf.byteOffset, bodyBuf.byteLength);
      }

      const webReq = new Request(reqUrl, init);
      const webRes = await activeFetch(webReq);

      const outHeaders: Record<string, string | string[]> = {};
      webRes.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') return;
        outHeaders[key] = value;
      });
      const setCookies =
        typeof webRes.headers.getSetCookie === 'function' ? webRes.headers.getSetCookie() : [];
      if (setCookies.length > 0) {
        outHeaders['set-cookie'] = setCookies;
      }

      nodeRes.writeHead(webRes.status, webRes.statusText, outHeaders);
      const resBuf = Buffer.from(await webRes.arrayBuffer());
      nodeRes.end(resBuf);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (activeError) {
        try {
          const errRes = await activeError(error);
          nodeRes.writeHead(errRes.status, errRes.statusText);
          nodeRes.end(Buffer.from(await errRes.arrayBuffer()));
          return;
        } catch {
          // Fall through to default 500
        }
      }
      if (!nodeRes.headersSent) {
        nodeRes.writeHead(500, { 'content-type': 'text/plain;charset=utf-8' });
      }
      nodeRes.end(error.message || 'Internal Server Error');
    }
  });

  server.listen(requestedPort, hostname);

  const getPort = (): number => {
    const addr = server.address() as AddressInfo | null;
    return addr ? addr.port : requestedPort;
  };

  return {
    get port(): number {
      return getPort();
    },
    get hostname(): string {
      return hostname;
    },
    get url(): URL {
      return new URL(`http://${hostname}:${getPort()}/`);
    },
    stop(closeActive = false): Promise<void> {
      if (closeActive && typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      return new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
    reload(next: Partial<ServeOptions>): void {
      if (next.fetch) activeFetch = next.fetch;
      if ('error' in next) activeError = next.error;
    },
  };
}

export interface BunSpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdin?: 'pipe' | 'inherit' | 'ignore' | Uint8Array | string;
  stdout?: 'pipe' | 'inherit' | 'ignore';
  stderr?: 'pipe' | 'inherit' | 'ignore';
}

export interface Subprocess {
  readonly pid: number;
  readonly exited: Promise<number>;
  readonly exitCode: number | null;
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  kill(signal?: NodeJS.Signals | number): void;
}

export interface SyncSubprocess {
  readonly exitCode: number;
  readonly success: boolean;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

function bunSpawn(cmd: string[], opts: BunSpawnOptions = {}): Subprocess {
  if (!Array.isArray(cmd) || cmd.length === 0) {
    throw new TypeError('Bun.spawn requires a non-empty command array');
  }
  const [command, ...args] = cmd;
  const stdinOpt =
    typeof opts.stdin === 'string' &&
    (opts.stdin === 'pipe' || opts.stdin === 'inherit' || opts.stdin === 'ignore')
      ? opts.stdin
      : 'pipe';

  const spawnOpts: SpawnOptions = {
    cwd: opts.cwd,
    env: opts.env,
    shell: false,
    stdio: [stdinOpt, opts.stdout ?? 'pipe', opts.stderr ?? 'pipe'],
  };

  const child = nodeSpawn(command, args, spawnOpts);

  if (child.stdin) {
    if (opts.stdin instanceof Uint8Array) {
      child.stdin.end(Buffer.from(opts.stdin.buffer, opts.stdin.byteOffset, opts.stdin.byteLength));
    } else if (
      typeof opts.stdin === 'string' &&
      opts.stdin !== 'pipe' &&
      opts.stdin !== 'inherit' &&
      opts.stdin !== 'ignore'
    ) {
      child.stdin.end(opts.stdin);
    }
  }

  let resolvedExitCode: number | null = null;
  const exited = new Promise<number>((resolve) => {
    child.on('close', (code) => {
      resolvedExitCode = code ?? 1;
      resolve(resolvedExitCode);
    });
    child.on('error', () => {
      resolvedExitCode = 1;
      resolve(1);
    });
  });

  const stdout = child.stdout
    ? (Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>)
    : null;
  const stderr = child.stderr
    ? (Readable.toWeb(child.stderr) as ReadableStream<Uint8Array>)
    : null;

  return {
    get pid(): number {
      return child.pid ?? -1;
    },
    exited,
    get exitCode(): number | null {
      return resolvedExitCode;
    },
    stdout,
    stderr,
    kill(signal?: NodeJS.Signals | number): void {
      child.kill(signal);
    },
  };
}

function bunSpawnSync(cmd: string[], opts: BunSpawnOptions = {}): SyncSubprocess {
  if (!Array.isArray(cmd) || cmd.length === 0) {
    throw new TypeError('Bun.spawnSync requires a non-empty command array');
  }
  const [command, ...args] = cmd;
  const input =
    opts.stdin instanceof Uint8Array
      ? opts.stdin
      : typeof opts.stdin === 'string' &&
          opts.stdin !== 'pipe' &&
          opts.stdin !== 'inherit' &&
          opts.stdin !== 'ignore'
        ? opts.stdin
        : undefined;

  const res = nodeSpawnSync(command, args, {
    cwd: opts.cwd,
    env: opts.env,
    input,
    shell: false,
  });

  const exitCode = res.status ?? (res.error ? 1 : 0);
  const stdout = Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout ?? '');
  const stderr = Buffer.isBuffer(res.stderr) ? res.stderr : Buffer.from(res.stderr ?? '');

  return {
    exitCode,
    success: exitCode === 0 && !res.error,
    stdout,
    stderr,
  };
}

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function bunHash(data: string | Uint8Array): bigint {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  let hash = FNV_OFFSET_BASIS_64;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]!);
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash;
}

export class CryptoHasher {
  private readonly inner: ReturnType<typeof createHash> | ReturnType<typeof createHmac>;

  constructor(algorithm: string, key?: string | Uint8Array) {
    const normalized = algorithm.toLowerCase().replace(/-/g, '');
    if (key !== undefined) {
      this.inner = createHmac(normalized, key);
    } else {
      this.inner = createHash(normalized);
    }
  }

  update(data: string | Uint8Array | ArrayBuffer): this {
    if (data instanceof ArrayBuffer) {
      this.inner.update(new Uint8Array(data));
    } else {
      this.inner.update(data);
    }
    return this;
  }

  digest(): Uint8Array;
  digest(encoding: 'hex' | 'base64' | 'base64url'): string;
  digest(encoding?: 'hex' | 'base64' | 'base64url'): Uint8Array | string {
    if (encoding) {
      return this.inner.digest(encoding);
    }
    const buf = this.inner.digest();
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
}

const SCRYPT_KEYLEN = 32;

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keylen, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const bunPassword = {
  async hash(pw: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scryptAsync(pw, salt, SCRYPT_KEYLEN);
    return `$scrypt$N=16384,r=8,p=1$${salt.toString('base64')}$${derived.toString('base64')}`;
  },
  async verify(pw: string, hash: string): Promise<boolean> {
    const parts = hash.split('$');
    if (parts.length !== 5 || parts[1] !== 'scrypt') {
      return false;
    }
    const salt = Buffer.from(parts[3]!, 'base64');
    const expected = Buffer.from(parts[4]!, 'base64');
    const actual = await scryptAsync(pw, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  },
};

function bunSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

function bunSleepSync(ms: number): void {
  const duration = Math.max(0, Math.trunc(ms));
  if (duration === 0) return;
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, duration);
}

function bunNanoseconds(): number {
  return Number(process.hrtime.bigint() - START_NS);
}

function bunWhich(bin: string): string | null {
  if (!bin) return null;
  const isWin = process.platform === 'win32';
  const pathExts = isWin
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM;.PS1')
        .split(';')
        .filter(Boolean)
        .map((ext) => ext.toLowerCase())
    : [''];

  const checkCandidate = (candidate: string): string | null => {
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Ignore stat error
      }
    }
    if (isWin) {
      const lower = candidate.toLowerCase();
      for (const ext of pathExts) {
        if (lower.endsWith(ext)) continue;
        const withExt = candidate + ext;
        if (existsSync(withExt)) {
          try {
            if (statSync(withExt).isFile()) return withExt;
          } catch {
            // Ignore stat error
          }
        }
      }
    }
    return null;
  };

  if (isAbsolute(bin) || bin.includes('/') || bin.includes('\\')) {
    return checkCandidate(bin);
  }

  const pathEnv = process.env.PATH ?? process.env.Path ?? '';
  const sep = isWin ? ';' : ':';
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    const found = checkCandidate(join(dir, bin));
    if (found) return found;
  }
  return null;
}

function bunDeepEquals(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b);
}

const HTML_ESCAPE_RE = /[&<>"']/g;
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};

function bunEscapeHTML(str: string): string {
  return String(str).replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

function bunInspect(val: unknown): string {
  return nodeInspect(val, { depth: 4, colors: false });
}

const ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function isFullWidthCodePoint(cp: number): boolean {
  return (
    cp >= 0x1100 &&
    (cp <= 0x115f ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0x3247 && cp !== 0x303f) ||
      (cp >= 0x3250 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0xa4c6) ||
      (cp >= 0xa960 && cp <= 0xa97c) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6b) ||
      (cp >= 0xff01 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff) ||
      (cp >= 0x20000 && cp <= 0x3fffd))
  );
}

function bunStringWidth(str: string): number {
  const clean = str.replace(ANSI_ESCAPE_RE, '');
  let width = 0;
  for (const ch of clean) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) continue;
    if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d) {
      continue;
    }
    width += isFullWidthCodePoint(cp) ? 2 : 1;
  }
  return width;
}

export interface ShellOutput {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  text(): string;
  json<T = unknown>(): T;
}

export interface ShellPromise extends PromiseLike<ShellOutput> {
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  quiet(): ShellPromise;
  nothrow(): ShellPromise;
  cwd(dir: string): ShellPromise;
  env(env: Record<string, string | undefined>): ShellPromise;
}

function tokenizeTemplate(strings: TemplateStringsArray, values: unknown[]): string[] {
  const args: string[] = [];
  let current = '';
  let hasToken = false;
  let quote: '"' | "'" | null = null;

  const pushCurrent = () => {
    if (hasToken) {
      args.push(current);
      current = '';
      hasToken = false;
    }
  };

  for (let i = 0; i < strings.length; i++) {
    const part = strings[i]!;
    for (let j = 0; j < part.length; j++) {
      const ch = part[j]!;
      if (quote) {
        if (ch === quote) {
          quote = null;
        } else {
          current += ch;
          hasToken = true;
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        hasToken = true;
      } else if (/\s/.test(ch)) {
        pushCurrent();
      } else {
        current += ch;
        hasToken = true;
      }
    }

    if (i < values.length) {
      const val = values[i];
      if (Array.isArray(val)) {
        pushCurrent();
        for (const item of val) {
          args.push(String(item));
        }
      } else if (val !== undefined && val !== null) {
        current += String(val);
        hasToken = true;
      }
    }
  }
  pushCurrent();
  return args;
}

class BunShellCommand implements ShellPromise {
  private readonly argv: string[];
  private isQuiet = false;
  private isNothrow = false;
  private workdir: string | undefined;
  private envVars: Record<string, string | undefined> | undefined;
  private execution: Promise<ShellOutput> | null = null;

  constructor(argv: string[]) {
    this.argv = argv;
  }

  quiet(): ShellPromise {
    this.isQuiet = true;
    return this;
  }

  nothrow(): ShellPromise {
    this.isNothrow = true;
    return this;
  }

  cwd(dir: string): ShellPromise {
    this.workdir = dir;
    return this;
  }

  env(env: Record<string, string | undefined>): ShellPromise {
    this.envVars = env;
    return this;
  }

  private run(): Promise<ShellOutput> {
    if (this.execution) return this.execution;
    this.execution = this.execute();
    return this.execution;
  }

  private async execute(): Promise<ShellOutput> {
    if (this.argv.length === 0) {
      const empty = Buffer.alloc(0);
      return {
        exitCode: 0,
        stdout: empty,
        stderr: empty,
        text: () => '',
        json: <T = unknown>() => JSON.parse('') as T,
      };
    }

    const [cmd, ...args] = this.argv;

    // Built-in portable echo fallback when no echo binary exists on Windows
    if (cmd === 'echo' && bunWhich('echo') === null) {
      const out = Buffer.from(args.join(' ') + '\n', 'utf8');
      if (!this.isQuiet) process.stdout.write(out);
      return {
        exitCode: 0,
        stdout: out,
        stderr: Buffer.alloc(0),
        text: () => out.toString('utf8'),
        json: <T = unknown>() => JSON.parse(out.toString('utf8')) as T,
      };
    }

    const resolvedCmd = bunWhich(cmd!) ?? cmd!;
    return new Promise<ShellOutput>((resolve, reject) => {
      const child = nodeSpawn(resolvedCmd, args, {
        cwd: this.workdir,
        env: this.envVars,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const outChunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      child.stdout?.on('data', (chunk: Buffer) => {
        outChunks.push(chunk);
        if (!this.isQuiet) process.stdout.write(chunk);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        errChunks.push(chunk);
        if (!this.isQuiet) process.stderr.write(chunk);
      });

      child.on('error', (err) => {
        if (this.isNothrow) {
          const stderr = Buffer.from(err.message, 'utf8');
          resolve({
            exitCode: 1,
            stdout: Buffer.alloc(0),
            stderr,
            text: () => '',
            json: <T = unknown>() => JSON.parse('') as T,
          });
        } else {
          reject(err);
        }
      });

      child.on('close', (code) => {
        const exitCode = code ?? 1;
        const stdout = Buffer.concat(outChunks);
        const stderr = Buffer.concat(errChunks);
        const output: ShellOutput = {
          exitCode,
          stdout,
          stderr,
          text: () => stdout.toString('utf8'),
          json: <T = unknown>() => JSON.parse(stdout.toString('utf8')) as T,
        };
        if (exitCode !== 0 && !this.isNothrow) {
          const err = new Error(
            `Shell command failed with exit code ${exitCode}: ${stderr.toString('utf8').trim()}`,
          );
          reject(err);
          return;
        }
        resolve(output);
      });
    });
  }

  then<TResult1 = ShellOutput, TResult2 = never>(
    onfulfilled?: ((value: ShellOutput) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  async text(): Promise<string> {
    const out = await this.run();
    return out.text();
  }

  async json<T = unknown>(): Promise<T> {
    const out = await this.run();
    return out.json<T>();
  }
}

function bunShell(strings: TemplateStringsArray, ...values: unknown[]): ShellPromise {
  const argv = tokenizeTemplate(strings, values);
  return new BunShellCommand(argv);
}

export const Bun = {
  version: '1.2.0-neon',
  revision: 'bun-neon-awesome-os',
  env: process.env,
  argv: process.argv,
  main: process.argv[1] ?? '',
  isMainThread: true,
  file(filePath: string | URL): BunFile {
    return new BunFileImpl(filePath);
  },
  write: bunWrite,
  serve: bunServe,
  spawn: bunSpawn,
  spawnSync: bunSpawnSync,
  hash: bunHash,
  CryptoHasher,
  password: bunPassword,
  sleep: bunSleep,
  sleepSync: bunSleepSync,
  nanoseconds: bunNanoseconds,
  which: bunWhich,
  deepEquals: bunDeepEquals,
  escapeHTML: bunEscapeHTML,
  inspect: bunInspect,
  stringWidth: bunStringWidth,
  $: bunShell,
};

export function installBunNeonGlobal(): typeof Bun {
  (globalThis as Record<string, unknown>).Bun = Bun;
  return Bun;
}

export default Bun;
