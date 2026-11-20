import { execa } from 'execa';

const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
export const MAX_OUTPUT_BYTES = 200 * 1024;

export function stripAnsi(text) {
  if (typeof text !== 'string') return '';
  return text.replace(ANSI_REGEX, '');
}

export function capOutput(text) {
  if (!text) return '';
  if (text.length <= MAX_OUTPUT_BYTES) {
    return text;
  }
  return text.slice(-MAX_OUTPUT_BYTES);
}

export function parseUserCommand(args) {
  if (!args || args.length === 0) {
    return { argv: null, shell: null };
  }
  if (args.length === 1 && /\s/.test(args[0])) {
    return { argv: null, shell: args[0] };
  }
  return { argv: [...args], shell: null };
}

export async function runCommand(cmdSpec, options = {}) {
  const spec = Array.isArray(cmdSpec) ? parseUserCommand(cmdSpec) : cmdSpec;
  const cwd = options.cwd || process.cwd();
  const env = { ...process.env, ...options.env };

  if (process.stdout.isTTY && env.FORCE_COLOR === undefined) {
    env.FORCE_COLOR = '1';
  }

  const isSilent = Boolean(options.silent);
  const stdio = isSilent
    ? { stdout: 'pipe', stderr: 'pipe' }
    : { stdout: ['pipe', 'inherit'], stderr: ['pipe', 'inherit'] };

  const execaOptions = {
    cwd,
    env,
    all: true,
    reject: false,
    ...stdio
  };

  let subprocess;
  if (spec.shell) {
    subprocess = execa(spec.shell, { ...execaOptions, shell: true });
  } else if (spec.argv && spec.argv.length > 0) {
    subprocess = execa(spec.argv[0], spec.argv.slice(1), { ...execaOptions, shell: false });
  } else {
    throw new Error('Invalid command specification: neither argv nor shell provided');
  }

  let userInterrupted = false;
  let timedOut = false;
  let timer = null;

  const onSigInt = () => {
    userInterrupted = true;
    try {
      subprocess.kill('SIGINT');
    } catch {
      // Ignore if process has exited
    }
  };

  const onSigTerm = () => {
    userInterrupted = true;
    try {
      subprocess.kill('SIGTERM');
    } catch {
      // Ignore if process has exited
    }
  };

  process.on('SIGINT', onSigInt);
  process.on('SIGTERM', onSigTerm);

  if (options.timeout && options.timeout > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        subprocess.kill('SIGTERM');
      } catch {
        // Ignore
      }
    }, options.timeout);
  }

  let rawOutput = '';
  if (subprocess.all) {
    subprocess.all.on('data', (chunk) => {
      const str = chunk.toString();
      rawOutput += str;
      if (options.onChunk) {
        options.onChunk(str, rawOutput);
      }
    });
  }

  let result;
  try {
    result = await subprocess;
  } finally {
    if (timer) clearTimeout(timer);
    process.removeListener('SIGINT', onSigInt);
    process.removeListener('SIGTERM', onSigTerm);
  }

  // Ensure any final data is captured
  if (rawOutput === '' && result.all) {
    rawOutput = result.all;
  }

  const cleanOutput = capOutput(stripAnsi(rawOutput));

  return {
    exitCode: result.exitCode ?? (result.signal ? 1 : 0),
    signal: result.signal ?? null,
    rawOutput,
    output: cleanOutput,
    userInterrupted,
    timedOut,
    command: spec
  };
}
