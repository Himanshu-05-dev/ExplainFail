import test from 'node:test';
import assert from 'node:assert/strict';
import prompts from 'prompts';
import { spawn } from 'node:child_process';
import { runLoop } from '../../src/loop.js';

test('e2e port conflict flow: fail -> diagnose -> approve -> re-run -> PASS', async () => {
  const port = 19881;
  const blockerCode = `
    const http = require('http');
    http.createServer().listen(${port}, () => console.log('BLOCKER_STARTED'));
    setInterval(() => {}, 1000);
  `;

  const blocker = spawn('node', ['-e', blockerCode], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve) => {
    blocker.stdout.on('data', (d) => {
      if (d.toString().includes('BLOCKER_STARTED')) resolve();
    });
  });

  try {
    // 1. With --yes (risk medium), must NOT auto-apply
    const targetScript = `
      const http = require('http');
      const s = http.createServer().listen(${port}, () => {
        s.close(() => process.exit(0));
      });
    `;

    const noAutoRes = await runLoop(['node', '-e', targetScript], {
      yes: true,
      nonInteractive: true,
      silent: true
    });
    // Should NOT have killed blocker because medium risk requires confirmation
    assert.notEqual(noAutoRes.finalStatus, 'PASS');

    // 2. With simulated 'y' approval, kills blocker and re-runs to PASS
    prompts.inject([true]);
    const passRes = await runLoop(['node', '-e', targetScript], {
      interactive: true,
      silent: true
    });

    assert.equal(passRes.exitCode, 0);
    assert.equal(passRes.finalStatus, 'PASS');
  } finally {
    try { blocker.kill(); } catch {}
  }
});
