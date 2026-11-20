import crypto from 'node:crypto';
import os from 'node:os';
import { stripAnsi } from './runner.js';

const PRECEDENCE_CODES = [
  'EADDRINUSE',
  'EACCES',
  'EPERM',
  'ERESOLVE',
  'ERR_MODULE_NOT_FOUND',
  'MODULE_NOT_FOUND'
];

const IGNORED_CODES = new Set([
  'ERROR',
  'ELIFECYCLE',
  'ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL'
]);

export function normalize(text, ctx = {}) {
  if (typeof text !== 'string') return '';
  let str = stripAnsi(text);

  const cwd = ctx.cwd || process.cwd();
  if (cwd) {
    const escapedCwd = cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    str = str.replace(new RegExp(escapedCwd, 'g'), '<root>');
    const fwdCwd = cwd.replace(/\\/g, '/');
    if (fwdCwd !== cwd) {
      const escapedFwd = fwdCwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      str = str.replace(new RegExp(escapedFwd, 'g'), '<root>');
    }
  }

  const home = os.homedir();
  if (home) {
    const escapedHome = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    str = str.replace(new RegExp(escapedHome, 'g'), '~');
    const fwdHome = home.replace(/\\/g, '/');
    if (fwdHome !== home) {
      const escapedFwd = fwdHome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      str = str.replace(new RegExp(escapedFwd, 'g'), '~');
    }
  }

  // Timestamps (\d{4}-\d{2}-\d{2}T[\d:.]+Z?) -> <ts>
  str = str.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<ts>');

  // Durations (\d+(\.\d+)?\s?(ms|s)\b) -> <dur>
  str = str.replace(/\b\d+(\.\d+)?\s?(ms|s)\b/g, '<dur>');

  // Hex strings of 8+ chars -> <hex>
  str = str.replace(/\b[0-9a-fA-F]{8,}\b/g, '<hex>');

  // pid[ =:]*\d+ -> pid <n>
  str = str.replace(/\bpid[ =:]*\d+/gi, 'pid <n>');

  // Collapse whitespace. Keep port numbers.
  str = str.replace(/[ \t]+/g, ' ').replace(/\r\n/g, '\n').trim();

  return str;
}

export function extractErrorCode(output) {
  if (!output) return null;

  // 1. Known specific codes take precedence
  for (const code of PRECEDENCE_CODES) {
    const regex = new RegExp(`\\b${code}\\b`);
    if (regex.test(output)) {
      return code;
    }
  }

  // 2. First match of general code regex ignoring wrappers
  const generalRegex = /\b(E[A-Z]{3,9}|ERR_[A-Z0-9_]+)\b/g;
  let match;
  while ((match = generalRegex.exec(output)) !== null) {
    const code = match[1];
    if (!IGNORED_CODES.has(code)) {
      return code;
    }
  }

  return null;
}

export function extractErrorLine(output, ctx = {}) {
  if (!output || !output.trim()) return null;
  const lines = output.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  const errorPattern = /(Error:|error:|ERR!|ERESOLVE|EADDRINUSE|Cannot find|SyntaxError|TypeError|ReferenceError)/;
  const matched = lines.find(line => errorPattern.test(line));
  const targetLine = matched || lines[lines.length - 1];
  return normalize(targetLine, ctx);
}

export function computeTailHash(output, ctx = {}) {
  if (!output) return crypto.createHash('sha1').update('').digest('hex');
  const lines = output.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const last20 = lines.slice(-20);
  const normalizedBlock = last20.map(l => normalize(l, ctx)).join('\n');
  return crypto.createHash('sha1').update(normalizedBlock).digest('hex');
}

export function buildFingerprint(ctx, detectorIds = []) {
  const exitCode = ctx.exitCode;
  const errorCode = extractErrorCode(ctx.output);
  const errorLine = extractErrorLine(ctx.output, ctx);
  const tailHash = computeTailHash(ctx.output, ctx);

  return {
    exitCode,
    errorCode,
    errorLine,
    tailHash,
    detectorIds: [...detectorIds]
  };
}

export function compare(before, after) {
  if (after.exitCode === 0) {
    return 'PASS';
  }
  if (before.errorCode && before.errorCode === after.errorCode && before.errorLine === after.errorLine) {
    return 'SAME_ERROR';
  }
  if (!before.errorCode && !after.errorCode && before.tailHash === after.tailHash) {
    return 'SAME_ERROR';
  }
  return 'NEW_ERROR';
}

export const computeFingerprint = buildFingerprint;

