import test from 'node:test';
import assert from 'node:assert/strict';
import { match, gather, explain, fixes } from '../../src/detectors/eresolve.js';
import { buildContext } from '../../src/context.js';

test('eresolve matches npm ERESOLVE error', async () => {
  const output = `
    npm ERR! code ERESOLVE
    npm ERR! ERESOLVE could not resolve
    npm ERR! Conflicting peer dependency: react@17.0.2
    npm ERR!   Found: react@18.2.0
  `;
  const ctx = buildContext({ output, command: ['npm', 'install'] });
  const m = match(ctx);
  assert.ok(m);

  const ev = await gather(ctx, m);
  assert.ok(ev && ev.length > 0);

  const expl = explain(m, ev);
  assert.ok(expl.includes('peer dependencies'));

  const fixList = fixes(ctx, m, ev);
  assert.ok(fixList.length >= 2);
  const legacyFix = fixList.find((f) => f.id === 'legacy-peer-deps');
  assert.ok(legacyFix);
  assert.deepEqual(legacyFix.argv, ['npm', 'install', '--legacy-peer-deps']);
});

test('eresolve returns null on unrelated output', () => {
  const ctx = buildContext({ output: 'Error: Cannot find module foo' });
  assert.equal(match(ctx), null);
});
