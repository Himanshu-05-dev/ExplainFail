import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUnknown, formatCommandFailure, formatResult } from '../src/reporter.js';

test('formatUnknown prints exact wording specified in Section 11', () => {
  const errorLine = 'Error: listen EADDRINUSE :::3000';
  const formatted = formatUnknown(errorLine);

  assert.ok(formatted.includes('explainfail could not confirm a cause for this failure. No rule matched with evidence.'));
  assert.ok(formatted.includes(`Last error line: ${errorLine}`));
  assert.ok(formatted.includes(`Search: https://www.google.com/search?q=${encodeURIComponent(errorLine)}`));
});

test('formatCommandFailure prints exit code and command', () => {
  const formatted = formatCommandFailure('npm run dev', 2);
  assert.ok(formatted.includes('✖ Command failed: npm run dev'));
  assert.ok(formatted.includes('(exit code 2)'));
});

test('formatResult handles all 4 outcome statuses', () => {
  assert.ok(formatResult('PASS').includes('✔ PASS'));
  assert.ok(formatResult('STAYED_UP', { timeoutSec: 30 }).includes('⚠ STAYED UP: still running after 30s'));
  assert.ok(formatResult('SAME_ERROR', { errorCode: 'EADDRINUSE' }).includes('✖ SAME ERROR'));
  assert.ok(formatResult('NEW_ERROR', { errorLine: 'SyntaxError: Unexpected token' }).includes('⚠ NEW ERROR'));
});
