#!/usr/bin/env node
/**
 * @file sections/bun-neon/cli.mts
 * @description Executable CLI for `bun-neon` (zero-JSC Bun-compatible runtime on Awesome-OS).
 *
 * Commands:
 *   --version, -v           Print version banner and exit 0
 *   --help, -h              Print usage help and exit 0
 *   -e <code>, --eval       Evaluate JS/TS code with `globalThis.Bun` active
 *   run <file> [...args]    Run script directly with `globalThis.Bun` + `sectium-node-hook.mts`
 *   <file.ts|mts|js> [...]  Shorthand for `run <file> [...args]`
 *   test [...files]         Run tests via `process.execPath --import <hook> --test ...files`
 *   install [...args]       Route cleanly to `pnpm install`
 *   add [...args]           Route cleanly to `pnpm add`
 *   x <pkg> [...args]       Route cleanly to `pnx <pkg> [...args]`
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { installBunNeonGlobal } from './bun-global.mts';

installBunNeonGlobal();

const VERSION_BANNER = '1.2.0-neon (bun-neon on Awesome-OS; zero JSC)';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
const SECTIUM_NODE_HOOK = path.join(WORKSPACE_ROOT, 'sections', 'b8g-runtime', 'sectium-node-hook.mts');
const BIN_DIR = path.join(WORKSPACE_ROOT, 'bin');
const BIN_SHIM_ENTRY = path.join(WORKSPACE_ROOT, 'packages', '@awesome-os', 'bin-shim', 'src', 'index.mts');

const HELP_TEXT = `bun-neon ${VERSION_BANNER}

Usage:
  bun-neon <command> [options]

Commands:
  run <file> [...args]    Run a JS/TS/MTS script with globalThis.Bun + Sectium hooks
  <file.ts|mts|js> [...]  Shorthand for \`bun-neon run <file> [...args]\`
  -e, --eval <code>       Evaluate inline JS/TS code with globalThis.Bun active
  test [...files]         Run test suites with node:test + Sectium node hook
  install [...args]       Install dependencies via pnpm
  add [...args]           Add dependencies via pnpm
  x <pkg> [...args]       Execute a package binary via pnx
  -v, --version           Show version information
  -h, --help              Show this help message
`;

function runThroughBinShim(tool: 'pnpm' | 'pnx', args: string[]): number {
  if (fs.existsSync(BIN_SHIM_ENTRY)) {
    const res = spawnSync(process.execPath, ['--experimental-strip-types', BIN_SHIM_ENTRY, ...args], {
      stdio: 'inherit',
      shell: false,
      env: {
        ...process.env,
        SHIM_TARGET: tool,
        B8G_SHIM_ORIGIN_BIN: BIN_DIR,
      },
    });
    if (res.error) {
      console.error(`[bun-neon] Failed to invoke ${tool} shim: ${res.error.message}`);
      return 1;
    }
    return res.status ?? 0;
  }

  const res = spawnSync(tool, args, {
    stdio: 'inherit',
    shell: false,
  });
  if (res.error) {
    console.error(`[bun-neon] Failed to invoke ${tool}: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 0;
}

function stripTsIfSupported(code: string): string {
  const maybeStrip = (module as unknown as { stripTypeScriptTypes?: (src: string) => string }).stripTypeScriptTypes;
  if (typeof maybeStrip === 'function') {
    try {
      return maybeStrip(code);
    } catch {
      return code;
    }
  }
  return code;
}

async function ensureSectiumHookLoaded(): Promise<void> {
  if (fs.existsSync(SECTIUM_NODE_HOOK)) {
    await import(pathToFileURL(SECTIUM_NODE_HOOK).href);
  }
}

async function runEval(code: string): Promise<number> {
  await ensureSectiumHookLoaded();
  const jsCode = stripTsIfSupported(code);
  const needsModule = /\b(?:import|export)\b|\bawait\b/.test(jsCode);
  if (needsModule) {
    const encoded = Buffer.from(jsCode, 'utf8').toString('base64');
    await import(`data:text/javascript;base64,${encoded}`);
    return 0;
  }
  vm.runInThisContext(jsCode, { filename: '[bun-neon-eval]' });
  return 0;
}

async function runScript(fileArg: string, scriptArgs: string[]): Promise<number> {
  const resolved = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(resolved)) {
    console.error(`[bun-neon] Script not found: ${fileArg}`);
    return 1;
  }
  await ensureSectiumHookLoaded();
  process.argv = [process.execPath, resolved, ...scriptArgs];
  await import(pathToFileURL(resolved).href);
  return 0;
}

function runTests(files: string[]): number {
  const nodeArgs: string[] = [];
  if (fs.existsSync(SECTIUM_NODE_HOOK)) {
    nodeArgs.push('--import', pathToFileURL(SECTIUM_NODE_HOOK).href);
  }
  nodeArgs.push('--test', ...files);

  const res = spawnSync(process.execPath, nodeArgs, {
    stdio: 'inherit',
    shell: false,
  });
  if (res.error) {
    console.error(`[bun-neon] Failed to run tests: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 0;
}

function looksLikeScriptFile(arg: string): boolean {
  return /\.(?:[cm]?ts|[cm]?js|tsx|jsx)$/i.test(arg) || fs.existsSync(path.resolve(process.cwd(), arg));
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  const [cmd, ...rest] = argv;

  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(`${VERSION_BANNER}\n`);
    return 0;
  }

  if (cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  if (cmd === '-e' || cmd === '--eval') {
    const code = rest[0];
    if (code === undefined) {
      console.error('[bun-neon] Missing code argument for --eval');
      return 1;
    }
    return await runEval(code);
  }

  if (cmd.startsWith('--eval=')) {
    return await runEval(cmd.slice('--eval='.length));
  }

  if (cmd === 'run') {
    const [fileArg, ...scriptArgs] = rest;
    if (!fileArg) {
      console.error('[bun-neon] Missing script path for `run`');
      return 1;
    }
    return await runScript(fileArg, scriptArgs);
  }

  if (cmd === 'test') {
    return runTests(rest);
  }

  if (cmd === 'install' || cmd === 'i') {
    return runThroughBinShim('pnpm', ['install', ...rest]);
  }

  if (cmd === 'add') {
    return runThroughBinShim('pnpm', ['add', ...rest]);
  }

  if (cmd === 'x') {
    if (rest.length === 0) {
      console.error('[bun-neon] Missing package name for `x`');
      return 1;
    }
    return runThroughBinShim('pnx', rest);
  }

  if (looksLikeScriptFile(cmd)) {
    return await runScript(cmd, rest);
  }

  console.error(`[bun-neon] Unknown command or file: ${cmd}`);
  return 1;
}

const isEntrypoint =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  main()
    .then((code) => {
      if (code !== 0) {
        process.exitCode = code;
      }
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
