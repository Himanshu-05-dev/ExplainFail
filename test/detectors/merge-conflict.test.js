import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findConflictFiles, match, gather, explain, fixes } from '../../src/detectors/merge-conflict.js';
import { buildContext } from '../../src/context.js';

test('merge-conflict detects files with all 3 conflict markers', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainfail-conflict-test-'));
  try {
    const fileWithConflict = path.join(tmpDir, 'file.js');
    fs.writeFileSync(
      fileWithConflict,
      `
const a = 1;
<<<<<<< HEAD
const b = 2;
=======
const b = 3;
>>>>>>> branch-xyz
console.log(a, b);
      `,
      'utf8'
    );

    const conflicts = await findConflictFiles(tmpDir);
    assert.ok(conflicts.length >= 1);
    assert.ok(conflicts[0].includes('file.js:3'));

    const ctx = buildContext({ cwd: tmpDir });
    const ev = await gather(ctx);
    assert.ok(ev);
    assert.ok(explain(null, ev).includes('file.js'));

    const fixList = fixes();
    assert.equal(fixList.length, 1);
    assert.equal(fixList[0].type, 'manual');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('merge-conflict match returns null on clean output', () => {
  assert.equal(match(buildContext({ output: 'Everything built successfully' })), null);
});
