/**
 * @file sections/bun-neon/bun-neon.test.mts
 * @description Comprehensive `node:test` verification suite for `bun-neon`
 * (`Bun` global APIs, `bun-sqlite`, `bun-test`, and `bun-neon` CLI).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Bun, Database, expect, installBunNeonGlobal, mock } from './index.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, 'cli.mts');

describe('bun-neon compatibility layer', () => {
  it('installBunNeonGlobal attaches globalThis.Bun', () => {
    installBunNeonGlobal();
    assert.strictEqual((globalThis as unknown as { Bun?: unknown }).Bun, Bun);
    assert.equal(typeof Bun.version, 'string');
    assert.ok(Bun.version.length > 0);
  });

  it('Bun.file + Bun.write support text, json, bytes, exists, and size in a temp dir', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-neon-test-'));
    try {
      const textPath = path.join(tmpDir, 'hello.txt');
      const jsonPath = path.join(tmpDir, 'data.json');

      const missingFile = Bun.file(textPath);
      assert.equal(await missingFile.exists(), false);

      await Bun.write(textPath, 'hello bun-neon');
      const textFile = Bun.file(textPath);
      assert.equal(await textFile.exists(), true);
      assert.equal(textFile.size, Buffer.byteLength('hello bun-neon', 'utf8'));
      assert.equal(await textFile.text(), 'hello bun-neon');

      const bytes = await textFile.bytes();
      assert.ok(bytes instanceof Uint8Array);
      assert.equal(Buffer.from(bytes).toString('utf8'), 'hello bun-neon');

      const payload = { ok: true, count: 42, tags: ['neon', 'zero-jsc'] };
      await Bun.write(jsonPath, JSON.stringify(payload));
      const jsonFile = Bun.file(jsonPath);
      assert.equal(await jsonFile.exists(), true);
      assert.deepEqual(await jsonFile.json(), payload);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('Bun.serve binds port 0, serves live JSON over fetch(), and stops cleanly', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req: Request) {
        const url = new URL(req.url);
        return Response.json({ path: url.pathname, runtime: 'bun-neon' });
      },
    });

    try {
      for (let i = 0; i < 50 && server.port === 0; i++) {
        await Bun.sleep(10);
      }
      assert.ok(typeof server.port === 'number' && server.port > 0);
      const res = await fetch(`http://127.0.0.1:${server.port}/ping`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, { path: '/ping', runtime: 'bun-neon' });
    } finally {
      await server.stop(true);
    }
  });

  it('Bun.hash, CryptoHasher, password.hash/verify, deepEquals, escapeHTML, and nanoseconds work', async () => {
    const h1 = Bun.hash('awesome-os');
    const h2 = Bun.hash('awesome-os');
    const h3 = Bun.hash('different');
    assert.equal(h1, h2);
    assert.notEqual(h1, h3);

    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update('bun-neon');
    const digest = hasher.digest('hex');
    assert.equal(typeof digest, 'string');
    assert.equal(digest.length, 64);

    const hashed = await Bun.password.hash('s3cr3t-pass');
    assert.equal(typeof hashed, 'string');
    assert.equal(await Bun.password.verify('s3cr3t-pass', hashed), true);
    assert.equal(await Bun.password.verify('wrong-pass', hashed), false);

    assert.equal(Bun.deepEquals({ a: [1, 2], b: { c: true } }, { a: [1, 2], b: { c: true } }), true);
    assert.equal(Bun.deepEquals({ a: [1, 2] }, { a: [1, 3] }), false);

    assert.equal(Bun.escapeHTML('<script>"x"&\'y\'</script>'), '&lt;script&gt;&quot;x&quot;&amp;&#x27;y&#x27;&lt;/script&gt;');

    const ns1 = Bun.nanoseconds();
    const ns2 = Bun.nanoseconds();
    assert.equal(typeof ns1, 'number');
    assert.ok(ns2 >= ns1);
  });

  it('Bun.spawnSync executes a child process and captures stdout', () => {
    const proc = Bun.spawnSync([process.execPath, '-e', 'console.log(99)']);
    assert.equal(proc.exitCode, 0);
    assert.equal(proc.stdout.toString().trim(), '99');
  });

  it('Database from bun-sqlite.mts supports CREATE TABLE, INSERT, SELECT, transaction, and close', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
      const insert = db.prepare('INSERT INTO items (name) VALUES (?)');
      const insertMany = db.transaction((names: string[]) => {
        for (const name of names) {
          insert.run(name);
        }
      });
      insertMany(['alpha', 'beta', 'gamma']);

      const rows = db.query('SELECT id, name FROM items ORDER BY id ASC').all() as Array<{
        id: number;
        name: string;
      }>;
      assert.equal(rows.length, 3);
      assert.deepEqual(
        rows.map((r) => r.name),
        ['alpha', 'beta', 'gamma'],
      );
    } finally {
      db.close();
    }
  });

  it('expect, .not, and mock from bun-test.mts work', () => {
    expect(2 + 2).toBe(4);
    expect(2 + 2).not.toBe(5);
    expect({ a: 1 }).toEqual({ a: 1 });
    expect([1, 2, 3]).toContain(2);

    const fn = mock((x: number) => x * 2);
    assert.equal(fn(21), 42);
    assert.equal(fn.mock.calls.length, 1);
    assert.deepEqual(fn.mock.calls[0], [21]);
  });

  it('bun-neon CLI supports --version and -e "console.log(Bun.version)"', () => {
    const verRes = spawnSync(process.execPath, [CLI_PATH, '--version'], {
      encoding: 'utf8',
      shell: false,
    });
    assert.equal(verRes.status, 0);
    assert.equal(verRes.stdout.trim(), '1.2.0-neon (bun-neon on Awesome-OS; zero JSC)');

    const evalRes = spawnSync(process.execPath, [CLI_PATH, '-e', 'console.log(Bun.version)'], {
      encoding: 'utf8',
      shell: false,
    });
    assert.equal(evalRes.status, 0);
    assert.equal(evalRes.stdout.trim(), Bun.version);
  });
});
