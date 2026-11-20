import test from 'node:test';
import assert from 'node:assert/strict';
import { runVerify } from '../../src/verify.js';

test('verify returns PASS (exit code 0) for passing command', async () => {
  const { exitCode, result } = await runVerify(['node', '-e', 'process.exit(0)']);
  assert.equal(exitCode, 0);
  assert.equal(result.status, 'PASS');
});

test('verify returns error status and exit code 1 for failing command', async () => {
  const { exitCode, result } = await runVerify(['node', '-e', 'throw new Error("fail")'], {
    timeout: '5'
  });
  assert.equal(exitCode, 1);
  assert.ok(['NEW_ERROR', 'SAME_ERROR'].includes(result.status));
  assert.equal(typeof result.fingerprint.tailHash, 'string');
});

test('verify --json schema matches specification', async () => {
  const { result } = await runVerify(['node', '-e', 'process.exit(0)'], {
    json: true
  });

  assert.ok('status' in result);
  assert.ok('command' in result);
  assert.ok('exitCode' in result);
  assert.ok('fingerprint' in result);
  assert.ok('baselineFingerprint' in result);
  assert.ok('detectorsMatched' in result);
  assert.ok('also' in result);
});
