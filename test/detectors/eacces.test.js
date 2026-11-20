import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPath, match, explain, fixes } from '../../src/detectors/eacces.js';
import { buildContext } from '../../src/context.js';

test('eacces extracts path and matches EACCES / EPERM errors', () => {
  const output = "Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/my-pkg'";
  assert.equal(extractPath(output), '/usr/local/lib/node_modules/my-pkg');

  const ctx = buildContext({ output });
  const m = match(ctx);
  assert.ok(m);
  assert.equal(m.data.path, '/usr/local/lib/node_modules/my-pkg');
});

test('eacces explains and offers safe manual fix only', () => {
  const ev = [
    { label: 'Target path', value: '/usr/local/lib' },
    { label: 'Owner UID', value: '0' },
    { label: 'Current UID', value: '1000' }
  ];

  const expl = explain(null, ev);
  assert.ok(expl.includes('Permission denied'));

  const fixList = fixes(buildContext(), { data: { path: '/usr/local/lib' } }, ev);
  assert.equal(fixList.length, 1);
  assert.equal(fixList[0].type, 'manual', 'Must never execute sudo automatically');
  assert.ok(fixList[0].manualText.includes('sudo chown -R'));
});
