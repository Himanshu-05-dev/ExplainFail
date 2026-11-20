import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runDoctor } from '../../src/doctor.js';

test('doctor reports 0 when project environment is clean', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainfail-doc-clean-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'clean' }), 'utf8');
    const exitCode = await runDoctor({ cwd: tmpDir });
    assert.equal(exitCode, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('doctor reports 1 when an environment problem is found', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainfail-doc-dirty-'));
  try {
    // Missing .env when .env.example exists
    fs.writeFileSync(path.join(tmpDir, '.env.example'), 'SECRET_KEY=123\n', 'utf8');
    const exitCode = await runDoctor({ cwd: tmpDir });
    assert.equal(exitCode, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
