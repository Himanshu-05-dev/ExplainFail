import test from 'node:test';
import assert from 'node:assert/strict';
import { match, explain, fixes } from '../../src/detectors/lockfile-sync.js';
import { buildContext } from '../../src/context.js';

test('lockfile-sync matches npm ci out of sync message', () => {
  const output = "npm ERR! `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync.";
  const ctx = buildContext({ output });
  const m = match(ctx);
  assert.ok(m);

  const expl = explain(m, [{ label: 'Lockfile', value: 'package-lock.json (exists)' }]);
  assert.ok(expl.includes('out of sync'));

  const fixList = fixes(ctx, m, []);
  assert.equal(fixList.length, 1);
  assert.equal(fixList[0].risk, 'medium');
  assert.deepEqual(fixList[0].argv, ['npm', 'install']);
});

test('lockfile-sync matches pnpm outdated lockfile error', () => {
  const output = 'ERR_PNPM_OUTDATED_LOCKFILE Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date';
  const ctx = buildContext({ output, pm: 'pnpm' });
  assert.ok(match(ctx));

  const fixList = fixes(ctx, match(ctx), []);
  assert.deepEqual(fixList[0].argv, ['pnpm', 'install', '--no-frozen-lockfile']);
});
