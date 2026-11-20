import test from 'node:test';
import assert from 'node:assert/strict';

test('m0 setup passes', () => {
  assert.equal(typeof process.version, 'string');
});
