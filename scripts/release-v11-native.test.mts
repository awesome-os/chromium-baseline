import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  generateDistManifestAndSums,
  getCompileJobs,
  getSmokeTestCommands,
} from './release-v11-native.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

describe('release-v11-native', () => {
  it('plans all 15 ABI v3 shims and 6 native compile jobs with existing sources', () => {
    const distDir = path.join(repoRoot, 'dist-v11');
    const jobs = getCompileJobs(repoRoot, distDir, '/tmp/b8g_ladybird_bridges.o');

    const shimJobs = jobs.filter((j) => j.label.startsWith('abi-v3 shim '));
    assert.equal(shimJobs.length, 15, 'expected 15 ABI v3 shared library shims');
    assert.equal(jobs.length, 21, 'expected 15 shims + 6 native build jobs');

    for (const job of jobs) {
      for (const arg of job.args) {
        if (/\.(c|cc|cpp)$/.test(arg)) {
          assert.equal(
            fs.existsSync(path.join(repoRoot, arg)),
            true,
            `Missing source file ${arg} referenced by ${job.label}`,
          );
        }
      }
    }
  });

  it('plans all 5 native smoke test binaries', () => {
    const cmds = getSmokeTestCommands('/tmp/dist-v11');
    assert.deepEqual(
      cmds.map((c) => c.label),
      [
        'b8g_18_dep_origin_proof',
        'b8g_inmem_linker_bench',
        'angrybird_bridge_test',
        'angrybird_cpp_engine_test',
        'b8g_libuv_smoke',
      ],
    );
    assert.deepEqual(cmds[0].args, ['/tmp/dist-v11']);
  });

  it('generates deterministic SHA512SUMS.txt and holo-v11-manifest.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-v11-dist-'));
    try {
      fs.writeFileSync(path.join(tmp, 'libz_test.so'), 'so-bytes');
      fs.writeFileSync(path.join(tmp, 'a_bin'), 'bin-bytes');
      fs.writeFileSync(path.join(tmp, 'SHA512SUMS.txt'), 'stale');
      fs.writeFileSync(path.join(tmp, 'holo-v11-manifest.json'), 'stale');

      const { manifest, manifestPath, sumsPath } = generateDistManifestAndSums(tmp, 'deadbeef');
      assert.equal(manifest.schema, 'holo-v11-release.v1');
      assert.equal(manifest.abiMagic, '0x33564742');
      assert.equal(manifest.repo, 'awesome-os/chromium-baseline');
      assert.equal(manifest.arch, 'linux-x86_64');
      assert.equal(manifest.commit, 'deadbeef');
      assert.equal(manifest.artifactCount, 2);
      assert.deepEqual(
        manifest.artifacts.map((a) => a.name),
        ['a_bin', 'libz_test.so'],
      );

      const expectedSha = crypto.createHash('sha512').update('bin-bytes').digest('hex');
      assert.equal(manifest.artifacts[0].sha512, expectedSha);
      assert.ok(fs.existsSync(manifestPath));
      assert.ok(fs.existsSync(sumsPath));
      const sumLines = fs.readFileSync(sumsPath, 'utf8').trim().split('\n');
      assert.equal(sumLines.length, 2);
      assert.equal(sumLines[0], `${expectedSha}  a_bin`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
