import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runLoop } from '../../src/loop.js';

test('e2e --dry-run does not modify project files and reports dry-run', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainfail-dry-run-'));
  try {
    const pkgPath = path.join(tmpDir, 'package.json');
    const originalPkg = JSON.stringify({ name: 'dry-run-test', dependencies: { 'nonexistent-dep': '^1.0.0' } });
    fs.writeFileSync(pkgPath, originalPkg, 'utf8');

    const capturedLogs = [];
    const origLog = console.log;
    console.log = (...args) => capturedLogs.push(args.join(' '));

    try {
      const res = await runLoop(
        ['node', '-e', 'throw new Error("Cannot find module \'nonexistent-dep\'")'],
        {
          cwd: tmpDir,
          dryRun: true
        }
      );

      assert.equal(res.finalStatus, 'DRY_RUN');
      assert.equal(fs.readFileSync(pkgPath, 'utf8'), originalPkg, 'File must remain unmodified');
      assert.ok(capturedLogs.join('\n').includes('(dry-run) nothing was changed'));
    } finally {
      console.log = origLog;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
