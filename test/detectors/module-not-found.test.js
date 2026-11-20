import test from 'node:test';
import assert from 'node:assert/strict';
import { extractModule, match, gather, explain, fixes } from '../../src/detectors/module-not-found.js';
import { buildContext } from '../../src/context.js';

test('module-not-found extracts module names and paths', () => {
  assert.equal(extractModule("Error: Cannot find module 'express'"), 'express');
  assert.equal(extractModule("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'lodash' imported from"), 'lodash');
  assert.equal(extractModule("Cannot find module './routes/auth.js'"), './routes/auth.js');
});

test('module-not-found match returns null on unrelated errors', () => {
  const ctx = buildContext({ output: 'ReferenceError: x is not defined' });
  assert.equal(match(ctx), null);
});

test('module-not-found handles missing relative local file', async () => {
  const ctx = buildContext({
    output: "Error: Cannot find module './missing-file.js'"
  });

  const m = match(ctx);
  assert.ok(m);
  const ev = await gather(ctx, m);
  assert.ok(ev);
  assert.equal(ev.find((e) => e.label === 'Type')?.value, 'file');

  const expl = explain(m, ev);
  assert.ok(expl.includes('missing-file.js'));

  const fixList = fixes(ctx, m, ev);
  assert.equal(fixList.length, 1);
  assert.equal(fixList[0].type, 'manual');
});

test('module-not-found handles declared package in package.json', async () => {
  const ctx = buildContext({
    output: "Error: Cannot find module 'nonexistent-local-dep'",
    pkg: {
      dependencies: {
        'nonexistent-local-dep': '^1.0.0'
      }
    },
    pm: 'npm'
  });

  const m = match(ctx);
  assert.ok(m);
  const ev = await gather(ctx, m);
  assert.ok(ev);
  assert.equal(ev.find((e) => e.label === 'In package.json')?.value, 'true');

  const fixList = fixes(ctx, m, ev);
  assert.equal(fixList.length, 1);
  assert.equal(fixList[0].id, 'install-dependencies');
  assert.equal(fixList[0].risk, 'low');
  assert.deepEqual(fixList[0].argv, ['npm', 'install']);
});
