import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext } from '../src/context.js';
import { detectPackageManager } from '../src/util/pm.js';

test('detectPackageManager detects lockfiles correctly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-test-'));
  try {
    assert.equal(detectPackageManager(tmpDir), null);

    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    assert.equal(detectPackageManager(tmpDir), 'npm');
    fs.unlinkSync(path.join(tmpDir, 'package-lock.json'));

    fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
    assert.equal(detectPackageManager(tmpDir), 'yarn');
    fs.unlinkSync(path.join(tmpDir, 'yarn.lock'));

    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    assert.equal(detectPackageManager(tmpDir), 'pnpm');
    fs.unlinkSync(path.join(tmpDir, 'pnpm-lock.yaml'));

    fs.writeFileSync(path.join(tmpDir, 'bun.lockb'), '');
    assert.equal(detectPackageManager(tmpDir), 'bun');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('createContext builds full Context object', () => {
  const ctx = createContext({
    output: 'sample output',
    exitCode: 1,
    signal: null
  }, {
    command: { argv: ['node', 'app.js'], shell: null },
    interactive: false
  });

  assert.equal(ctx.output, 'sample output');
  assert.equal(ctx.exitCode, 1);
  assert.equal(ctx.signal, null);
  assert.equal(ctx.interactive, false);
  assert.equal(typeof ctx.cwd, 'string');
  assert.equal(typeof ctx.platform, 'string');
});
