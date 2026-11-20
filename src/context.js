import path from 'node:path';
import { detectPackageManager } from './util/pm.js';
import { safeReadJson } from './util/fs.js';
import { parseUserCommand } from './runner.js';

export function buildContext(runResult = {}, options = {}) {
  const isOptionsFirst = !options.command && (runResult.command || runResult.cwd || runResult.output !== undefined || runResult.pkg !== undefined);
  const opts = isOptionsFirst ? runResult : options;
  const result = isOptionsFirst ? {} : runResult;

  const cwd = opts.cwd || result.cwd || process.cwd();
  const pkg = opts.pkg !== undefined ? opts.pkg : (result.pkg !== undefined ? result.pkg : safeReadJson(path.join(cwd, 'package.json')));
  const pm = opts.pm !== undefined ? opts.pm : (result.pm !== undefined ? result.pm : detectPackageManager(cwd));

  let rawCommand = opts.command !== undefined ? opts.command : result.command;
  let command = { argv: null, shell: null };
  if (Array.isArray(rawCommand)) {
    command = { argv: [...rawCommand], shell: null };
  } else if (typeof rawCommand === 'string') {
    command = parseUserCommand([rawCommand]);
  } else if (rawCommand && (rawCommand.argv !== undefined || rawCommand.shell !== undefined)) {
    command = rawCommand;
  }

  const output = typeof opts.output === 'string' ? opts.output : (typeof result.output === 'string' ? result.output : '');
  const exitCode = opts.exitCode !== undefined ? opts.exitCode : (result.exitCode ?? null);
  const signal = opts.signal !== undefined ? opts.signal : (result.signal ?? null);
  const platform = process.platform;
  const interactive = opts.interactive !== undefined
    ? Boolean(opts.interactive)
    : Boolean(process.stdin.isTTY && process.stdout.isTTY);

  return {
    cwd,
    command,
    output,
    exitCode,
    signal,
    platform,
    pm,
    pkg,
    interactive
  };
}

export const createContext = buildContext;
