import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createBackup,
  restoreBackup,
  saveLastFailure,
  saveRunLog,
  MAX_RETAINED_RUNS
} from '../src/backup.js';

test('backup and restore preserves exact file contents', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainfail-backup-test-'));
  try {
    const testFile = path.join(tmpDir, 'test.txt');
    const originalContent = 'original-content-12345';
    fs.writeFileSync(testFile, originalContent, 'utf8');

    // Create backup
    const ts = createBackup(tmpDir, ['test.txt']);
    assert.ok(ts, 'Backup timestamp returned');

    // Modify file
    fs.writeFileSync(testFile, 'modified-content-99999', 'utf8');
    assert.equal(fs.readFileSync(testFile, 'utf8'), 'modified-content-99999');

    // Restore backup
    const restored = restoreBackup(tmpDir, ts);
    assert.equal(restored, true);
    assert.equal(fs.readFileSync(testFile, 'utf8'), originalContent);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('backup prunes history keeping at most 20 entries', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainfail-prune-test-'));
  try {
    const testFile = path.join(tmpDir, 'dummy.txt');
    fs.writeFileSync(testFile, 'dummy', 'utf8');

    // Create 25 runs/backups
    const backupsDir = path.join(tmpDir, '.explainfail', 'backups');
    for (let i = 0; i < 25; i++) {
      createBackup(tmpDir, ['dummy.txt']);
    }

    const remainingBackups = fs.readdirSync(backupsDir);
    assert.ok(remainingBackups.length <= MAX_RETAINED_RUNS, `Expected <= ${MAX_RETAINED_RUNS}, got ${remainingBackups.length}`);

    // Create 25 run logs
    for (let i = 0; i < 25; i++) {
      saveRunLog(tmpDir, { run: i, command: 'test' });
    }
    const runsDir = path.join(tmpDir, '.explainfail', 'runs');
    const remainingRuns = fs.readdirSync(runsDir).filter((f) => f !== 'latest.json');
    assert.ok(remainingRuns.length <= MAX_RETAINED_RUNS, `Expected <= ${MAX_RETAINED_RUNS}, got ${remainingRuns.length}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('saveLastFailure creates last-failure.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainfail-last-fail-'));
  try {
    const fp = { exitCode: 1, errorCode: 'EADDRINUSE' };
    saveLastFailure(tmpDir, fp);

    const saved = JSON.parse(fs.readFileSync(path.join(tmpDir, '.explainfail', 'last-failure.json'), 'utf8'));
    assert.deepEqual(saved, fp);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
