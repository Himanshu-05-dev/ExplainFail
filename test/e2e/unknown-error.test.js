import test from 'node:test';
import assert from 'node:assert/strict';
import { runLoop } from '../../src/loop.js';

test('e2e unknown error produces exact UNKNOWN wording and returns child exit code', async () => {
  const capturedLogs = [];
  const originalLog = console.log;
  console.log = (...args) => capturedLogs.push(args.join(' '));

  try {
    const res = await runLoop(['node', '-e', 'console.error("CustomUnknownCrash: something broke"); process.exit(42)'], {
      noFix: true
    });

    assert.equal(res.exitCode, 42);
    assert.equal(res.finalStatus, 'UNKNOWN_ERROR');

    const fullOutput = capturedLogs.join('\n');
    assert.ok(fullOutput.includes('explainfail could not confirm a cause for this failure. No rule matched with evidence.'));
    assert.ok(fullOutput.includes('https://www.google.com/search?q='));
  } finally {
    console.log = originalLog;
  }
});
