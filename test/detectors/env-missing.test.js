import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseEnvKeys, checkEnvDiff, preflight } from '../../src/detectors/env-missing.js';
import { buildContext } from '../../src/context.js';

test('env-missing parses keys ignoring comments and empty lines', () => {
  const envContent = `
    # Database config
    DB_HOST=localhost
    DB_PORT=5432
    
    # Secret
    API_KEY=secret_value
  `;
  const keys = parseEnvKeys(envContent);
  assert.deepEqual(keys, ['DB_HOST', 'DB_PORT', 'API_KEY']);
});

test('env-missing detects missing .env and missing keys', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainfail-env-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, '.env.example'), 'PORT=3000\nDATABASE_URL=\nAPI_KEY=\n', 'utf8');

    // Case 1: .env file missing
    let diff = checkEnvDiff(tmpDir);
    assert.equal(diff.status, 'missing_env');
    assert.deepEqual(diff.missingKeys, ['PORT', 'DATABASE_URL', 'API_KEY']);

    // Case 2: .env exists but missing keys
    fs.writeFileSync(path.join(tmpDir, '.env'), 'PORT=3000\n', 'utf8');
    diff = checkEnvDiff(tmpDir);
    assert.equal(diff.status, 'missing_keys');
    assert.deepEqual(diff.missingKeys, ['DATABASE_URL', 'API_KEY']);

    // Preflight generates finding
    const findings = await preflight(buildContext({ cwd: tmpDir }));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].fixes.length, 1);
    assert.equal(findings[0].fixes[0].risk, 'medium');

    // Apply fix
    await findings[0].fixes[0].apply(buildContext({ cwd: tmpDir }));
    const updatedEnv = fs.readFileSync(path.join(tmpDir, '.env'), 'utf8');
    assert.ok(updatedEnv.includes('DATABASE_URL='));
    assert.ok(updatedEnv.includes('API_KEY='));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
