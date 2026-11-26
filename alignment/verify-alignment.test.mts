import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verifyBaselineAlignment } from './verify-alignment.mts';

describe('chromium-baseline unified alignment & AngryBird 18/18 parity', () => {
  it('proves single shared V8 16.0.88+ (dup_v8 = 0 B), shared v11 libs, zero legacy refs, and AngryBird 18/18 parity', () => {
    const res = verifyBaselineAlignment();
    assert.deepEqual(res.errors, []);
    assert.equal(res.ok, true);
    assert.equal(res.v8ConsumersVerified, 8);
    assert.equal(res.sharedLibsVerified.length, 8);
    assert.deepEqual(res.legacyReferencesFound, []);
    assert.equal(res.angrybirdParityCount, 18);
    assert.equal(res.angrybirdMissingCount, 0);
    assert.equal(res.angrybirdEarlyStubCount, 0);
    assert.equal(res.inmemLinkerTargetsVerified, 18);
  });
});
