import test from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/redact.js';

test('redact masks Bearer token', () => {
  const input = 'Authorization: Bearer mySecretToken12345';
  assert.equal(redact(input), 'Authorization: Bearer <redacted>');
});

test('redact masks sk-..., ghp_..., AKIA..., xox- tokens', () => {
  const input = 'Keys: sk-abc1234567890def ghp_abcdef1234567890 AKIAIOSFODNN7EXAMPLE xoxb-12345678-abcdef';
  const expected = 'Keys: <redacted> <redacted> <redacted> <redacted>';
  assert.equal(redact(input), expected);
});

test('redact masks private key blocks', () => {
  const input = 'start\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----\nend';
  assert.equal(redact(input), 'start\n<redacted>\nend');
});

test('redact masks password=, token=, secret=, apikey= in key=val and key: val', () => {
  const input1 = 'database password=superSecretPass123 host=localhost';
  assert.equal(redact(input1), 'database password=<redacted> host=localhost');

  const input2 = 'api_config:\n  token: secretTokenVal\n  secret: "mySecret"\n  apikey: \'abc123xyz\'';
  assert.equal(redact(input2), 'api_config:\n  token: <redacted>\n  secret: <redacted>\n  apikey: <redacted>');
});

test('redact masks URL credentials', () => {
  const input = 'Connecting to https://user:pass1234@db.example.com/mydb';
  assert.equal(redact(input), 'Connecting to https://<redacted>@db.example.com/mydb');
});

test('redact leaves non-secrets untouched', () => {
  const input = 'Server listening on port 3000 at 127.0.0.1. Error: ENOENT file not found.';
  assert.equal(redact(input), input);
});
