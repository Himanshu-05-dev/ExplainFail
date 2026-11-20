import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, extractErrorCode, extractErrorLine, computeTailHash, buildFingerprint, compare } from '../src/fingerprint.js';

test('normalize handles cwd, home, timestamps, durations, hex, pids, whitespace and keeps port', () => {
  const ctx = { cwd: 'D:\\test\\my-project' };
  const raw = 'Error at D:\\test\\my-project\\server.js on port 8080 at 2026-11-20T12:00:00.000Z took 125ms pid: 12345 hash 1a2b3c4d5e6f7890';
  const normalized = normalize(raw, ctx);

  assert.match(normalized, /<root>/);
  assert.match(normalized, /port 8080/); // Keeps port number!
  assert.match(normalized, /<ts>/);
  assert.match(normalized, /<dur>/);
  assert.match(normalized, /pid <n>/);
  assert.match(normalized, /<hex>/);
  assert.doesNotMatch(normalized, /D:\\test\\my-project/);
});

test('extractErrorCode ignores wrapper noise and respects precedence', () => {
  // ELIFECYCLE ignored, EADDRINUSE picked
  const output = 'npm ERR! code ELIFECYCLE\nnpm ERR! errno 1\nError: listen EADDRINUSE: address already in use :::3000';
  assert.equal(extractErrorCode(output), 'EADDRINUSE');

  // ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL ignored
  const pnpmOutput = 'ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL Command failed with exit code 1';
  assert.equal(extractErrorCode(pnpmOutput), null);

  // General code match when not ignored
  const genericOutput = 'System error: ENOENT no such file or directory';
  assert.equal(extractErrorCode(genericOutput), 'ENOENT');
});

test('extractErrorLine picks first matching error line or last non-empty line', () => {
  const output = 'starting app...\nError: Cannot find module express\nsome other trace';
  assert.equal(extractErrorLine(output), 'Error: Cannot find module express');

  const noMatchOutput = 'line 1\nline 2\nlast line';
  assert.equal(extractErrorLine(noMatchOutput), 'last line');
});

test('compare returns PASS when after.exitCode === 0', () => {
  const before = { exitCode: 1, errorCode: 'EADDRINUSE', errorLine: 'err', tailHash: 'h1' };
  const after = { exitCode: 0, errorCode: null, errorLine: null, tailHash: 'h2' };
  assert.equal(compare(before, after), 'PASS');
});

test('compare returns SAME_ERROR when errorCode and errorLine match', () => {
  const before = { exitCode: 1, errorCode: 'EADDRINUSE', errorLine: 'Port 3000 busy', tailHash: 'h1' };
  const after = { exitCode: 1, errorCode: 'EADDRINUSE', errorLine: 'Port 3000 busy', tailHash: 'h2' };
  assert.equal(compare(before, after), 'SAME_ERROR');
});

test('compare returns SAME_ERROR when both errorCodes null and tailHash equal', () => {
  const before = { exitCode: 1, errorCode: null, errorLine: 'some failure', tailHash: 'same-hash' };
  const after = { exitCode: 1, errorCode: null, errorLine: 'another line', tailHash: 'same-hash' };
  assert.equal(compare(before, after), 'SAME_ERROR');
});

test('compare returns NEW_ERROR when errors differ', () => {
  const before = { exitCode: 1, errorCode: 'EADDRINUSE', errorLine: 'Port busy', tailHash: 'h1' };
  const after = { exitCode: 1, errorCode: 'ENOENT', errorLine: 'File missing', tailHash: 'h2' };
  assert.equal(compare(before, after), 'NEW_ERROR');
});
