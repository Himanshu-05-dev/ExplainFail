import test from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, parseUserCommand, stripAnsi, capOutput, MAX_OUTPUT_BYTES } from '../src/runner.js';

test('parseUserCommand distinguishes shell strings from argv', () => {
  // Single string with spaces -> shell
  const shellCmd = parseUserCommand(['npm run build && npm test']);
  assert.equal(shellCmd.argv, null);
  assert.equal(shellCmd.shell, 'npm run build && npm test');

  // Single string without spaces -> argv
  const singleArg = parseUserCommand(['ls']);
  assert.deepEqual(singleArg.argv, ['ls']);
  assert.equal(singleArg.shell, null);

  // Multiple args -> argv
  const multiArg = parseUserCommand(['node', '-e', 'console.log(1)']);
  assert.deepEqual(multiArg.argv, ['node', '-e', 'console.log(1)']);
  assert.equal(multiArg.shell, null);
});

test('runner propagates non-zero exit code and captures stdout/stderr', async () => {
  const result = await runCommand(
    ['node', '-e', "console.log('hello out'); console.error('hello err'); process.exit(3);"],
    { silent: true }
  );

  assert.equal(result.exitCode, 3);
  assert.match(result.output, /hello out/);
  assert.match(result.output, /hello err/);
});

test('runner strips ANSI escape codes from captured output', async () => {
  const result = await runCommand(
    ['node', '-e', "console.log('\u001b[31mRed Text\u001b[0m');"],
    { silent: true }
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.output.trim(), 'Red Text');
  assert.equal(stripAnsi('\u001b[32mGreen\u001b[39m'), 'Green');
});

test('runner enforces 200 KB cap on captured output', async () => {
  // Generate 250 KB of output
  const script = "for (let i = 0; i < 2500; i++) { process.stdout.write('X'.repeat(100)); } console.log('TAIL_MARKER');";
  const result = await runCommand(
    ['node', '-e', script],
    { silent: true }
  );

  assert.equal(result.exitCode, 0);
  assert.ok(result.output.length <= MAX_OUTPUT_BYTES, `Output length ${result.output.length} exceeded cap ${MAX_OUTPUT_BYTES}`);
  assert.match(result.output, /TAIL_MARKER/);
});

test('runner supports shell commands', async () => {
  const spec = parseUserCommand(["node -e \"console.log('from-shell')\""]);
  const result = await runCommand(spec, { silent: true });
  assert.equal(result.exitCode, 0);
  assert.match(result.output, /from-shell/);
});

test('runner handles timeout when configured', async () => {
  const result = await runCommand(
    ['node', '-e', 'setTimeout(() => {}, 10000);'],
    { silent: true, timeout: 300 }
  );

  assert.equal(result.timedOut, true);
});
