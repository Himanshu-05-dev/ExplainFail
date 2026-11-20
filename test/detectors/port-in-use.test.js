import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPort, match, explain, fixes } from '../../src/detectors/port-in-use.js';
import { buildContext } from '../../src/context.js';

test('port-in-use extracts port from common error patterns', () => {
  const line1 = 'Error: listen EADDRINUSE: address already in use :::3000';
  assert.equal(extractPort(line1), '3000');

  const line2 = 'events.js:292 throw er; // Unhandled \'error\' event\nError: listen EADDRINUSE 127.0.0.1:8080';
  assert.equal(extractPort(line2), '8080');

  const line3 = 'Port 4000 is already in use by another process.';
  assert.equal(extractPort(line3), '4000');
});

test('port-in-use match returns null on unrelated output', () => {
  const ctx = buildContext({ output: 'TypeError: undefined is not a function' });
  assert.equal(match(ctx), null);
});

test('port-in-use match extracts port on EADDRINUSE', () => {
  const ctx = buildContext({
    output: 'Error: listen EADDRINUSE: address already in use :::5173'
  });
  const m = match(ctx);
  assert.ok(m);
  assert.equal(m.data.port, '5173');
});

test('port-in-use explain and fixes format correctly and protect current process', () => {
  const ev = [
    { label: 'Port', value: '3000' },
    { label: 'PID', value: '999999' },
    { label: 'Process', value: 'node' }
  ];

  const explanation = explain(null, ev);
  assert.ok(explanation.includes('Port 3000 is already being used by process 999999 (node)'));

  const fixList = fixes(buildContext(), { data: { port: '3000' } }, ev);
  assert.ok(fixList.length >= 2);
  const killFix = fixList.find((f) => f.id === 'kill-process');
  assert.ok(killFix);
  assert.equal(killFix.risk, 'medium');

  // Verify explainfail never targets its own PID or parent PID
  const selfEv = [
    { label: 'Port', value: '3000' },
    { label: 'PID', value: String(process.pid) }
  ];
  const safeFixList = fixes(buildContext(), { data: { port: '3000' } }, selfEv);
  assert.equal(safeFixList.find((f) => f.id === 'kill-process'), undefined, 'Must not target own PID');
});
