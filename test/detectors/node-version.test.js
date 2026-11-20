import test from 'node:test';
import assert from 'node:assert/strict';
import { match, explain, fixes } from '../../src/detectors/node-version.js';
import { buildContext } from '../../src/context.js';

test('node-version match detects engine incompatibility and ignores ERR_REQUIRE_ESM', () => {
  const ctxIncompatible = buildContext({
    output: 'npm ERR! notsup Unsupported engine for pkg@1.0.0: wanted: {"node":">=22.0.0"} (current: {"node":"18.17.0"})'
  });
  assert.ok(match(ctxIncompatible));

  const ctxEsm = buildContext({
    output: 'Error [ERR_REQUIRE_ESM]: require() of ES Module index.js not supported'
  });
  assert.equal(match(ctxEsm), null, 'Must ignore ERR_REQUIRE_ESM');
});

test('node-version formats explanation and manual fixes', () => {
  const ev = [
    { label: 'Current Node', value: 'v18.17.0' },
    { label: 'Required Node', value: '>=20.0.0' },
    { label: 'Defined in', value: '.nvmrc' }
  ];

  const expl = explain(null, ev);
  assert.ok(expl.includes('v18.17.0'));
  assert.ok(expl.includes('>=20.0.0'));
  assert.ok(expl.includes('.nvmrc'));

  const fixList = fixes(buildContext(), null, ev);
  assert.equal(fixList.length, 1);
  assert.equal(fixList[0].type, 'manual');
  assert.ok(fixList[0].manualText.includes('nvm use >=20.0.0'));
});
