import test from 'node:test';
import assert from 'node:assert/strict';
import { runLoop } from '../../src/loop.js';

test('e2e non-interactive execution without --yes exits without prompting', async () => {
  const res = await runLoop(
    ['node', '-e', 'throw new Error("Cannot find module \'express\'")'],
    {
      nonInteractive: true
    }
  );

  // In non-interactive mode without --yes, cannot prompt
  assert.equal(res.finalStatus, 'NON_INTERACTIVE');
});
