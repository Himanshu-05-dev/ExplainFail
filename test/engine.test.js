import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, validateEvidence } from '../src/engine.js';
import { buildContext } from '../src/context.js';

test('engine produces diagnosis when detector matches and gathers evidence', async () => {
  const ctx = buildContext({
    output: 'Error: listen EADDRINUSE :::3000'
  });

  const mockDetector = {
    id: 'port-in-use',
    title: 'Port already in use',
    match: (c) => (/EADDRINUSE/.test(c.output) ? { port: '3000' } : null),
    gather: async () => [{ label: 'Port', value: '3000' }, { label: 'PID', value: '1234' }],
    explain: (m, ev) => `Port ${m.port} is already in use by process 1234.`,
    fixes: () => [{ id: 'kill', label: 'Kill process', type: 'command', risk: 'medium', argv: ['kill', '1234'] }]
  };

  const diags = await diagnose(ctx, [mockDetector]);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].detectorId, 'port-in-use');
  assert.equal(diags[0].kind, 'cause');
  assert.equal(diags[0].evidence.length, 2);
  assert.equal(diags[0].explanation, 'Port 3000 is already in use by process 1234.');
  assert.equal(diags[0].fixes[0].id, 'kill');
});

test('engine does NOT produce diagnosis when gather returns null or empty', async () => {
  const ctx = buildContext({
    output: 'Error: listen EADDRINUSE :::3000'
  });

  const mockDetector = {
    id: 'port-in-use',
    title: 'Port already in use',
    match: () => ({ port: '3000' }),
    gather: async () => [] // no evidence gathered (e.g. port already freed)
  };

  const diags = await diagnose(ctx, [mockDetector]);
  assert.equal(diags.length, 0, 'Must produce no diagnosis without evidence');
});

test('engine enforces evidence rule: throws in NODE_ENV=test when empty evidence is validated', () => {
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'test';
    assert.throws(
      () => validateEvidence([], 'test-detector'),
      /Evidence rule violated: Diagnosis for "test-detector" has empty evidence/
    );

    assert.equal(validateEvidence([{ label: 'key', value: 'val' }], 'test-detector'), true);

    process.env.NODE_ENV = 'production';
    assert.equal(validateEvidence([], 'test-detector'), false);
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

test('engine gathers preflight findings as kind finding', async () => {
  const ctx = buildContext({ output: 'clean' });

  const mockDetector = {
    id: 'env-missing',
    title: 'Missing environment variables',
    match: () => null,
    preflight: async () => [
      {
        detectorId: 'env-missing',
        title: 'Missing .env file',
        evidence: [{ label: 'File missing', value: '.env' }],
        fixes: [{ id: 'create-env', label: 'Create .env', type: 'file', risk: 'low' }]
      }
    ]
  };

  const diags = await diagnose(ctx, [mockDetector]);
  assert.equal(diags.length, 1);
  assert.equal(diags[0].kind, 'finding');
  assert.equal(diags[0].evidence[0].value, '.env');
});
