import fs from 'node:fs';
import path from 'node:path';
import { getLockfile } from '../util/pm.js';
import { safeReadJson } from '../util/fs.js';

export const id = 'lockfile-sync';
export const title = 'Lockfile out of sync';

const LOCKFILE_PATTERNS = [
  /`npm ci` can only install packages when your package\.json and package-lock\.json .* are in sync/is,
  /npm ERR! Missing: .* from lock file/i,
  /npm ERR! Invalid: lock file/i,
  /Your lockfile needs to be updated/i,
  /ERR_PNPM_OUTDATED_LOCKFILE/i
];

export function match(ctx) {
  const output = ctx?.output || '';
  const matched = LOCKFILE_PATTERNS.some((p) => p.test(output));
  if (!matched) return null;

  return {
    detectorId: id,
    data: {},
    matchedLines: output.split(/\r?\n/).filter((l) => LOCKFILE_PATTERNS.some((p) => p.test(l)))
  };
}

export async function gather(ctx, m) {
  const cwd = ctx?.cwd || process.cwd();
  const lock = getLockfile(cwd);
  const matchedLines = m?.matchedLines || [];

  if (matchedLines.length === 0 && !lock) return null;

  const evidence = [];
  if (lock) {
    evidence.push({ label: 'Lockfile', value: `${lock.file} (exists)` });
  } else {
    evidence.push({ label: 'Lockfile', value: 'missing or undetected' });
  }

  for (const line of matchedLines.slice(0, 5)) {
    evidence.push({ label: 'Error message', value: line.trim() });
  }

  return evidence;
}

export function explain(m, ev) {
  const lockName = ev.find((e) => e.label === 'Lockfile')?.value || 'Lockfile';
  return `The lockfile (${lockName}) is out of sync with package.json dependencies.`;
}

export function fixes(ctx, m, ev) {
  const cwd = ctx?.cwd || process.cwd();
  const lock = getLockfile(cwd);

  let pm = ctx?.pm;
  if (/ERR_PNPM_OUTDATED_LOCKFILE/i.test(ctx?.output || '')) {
    pm = 'pnpm';
  } else if (/Your lockfile needs to be updated/i.test(ctx?.output || '')) {
    pm = 'yarn';
  } else if (!pm) {
    pm = lock?.pm || 'npm';
  }

  let argv;
  if (pm === 'pnpm') {
    argv = ['pnpm', 'install', '--no-frozen-lockfile'];
  } else if (pm === 'yarn') {
    argv = ['yarn', 'install'];
  } else {
    argv = ['npm', 'install'];
  }

  return [
    {
      id: 'sync-lockfile',
      label: `Update lockfile with ${argv.join(' ')}`,
      type: 'command',
      risk: 'medium',
      argv,
      warning: 'This changes your lockfile.'
    }
  ];
}

export async function preflight(ctx) {
  const cwd = ctx?.cwd || process.cwd();
  const lock = getLockfile(cwd);
  if (!lock || lock.pm !== 'npm') return [];

  const lockPath = path.join(cwd, 'package-lock.json');
  const pkgPath = path.join(cwd, 'package.json');

  const lockJson = safeReadJson(lockPath);
  const pkgJson = safeReadJson(pkgPath);

  if (!lockJson || !pkgJson) return [];

  const rootLockDeps = lockJson.packages?.['']?.dependencies || {};
  const pkgDeps = pkgJson.dependencies || {};

  const diffs = [];
  for (const [name, range] of Object.entries(pkgDeps)) {
    if (!rootLockDeps[name] || rootLockDeps[name] !== range) {
      diffs.push(`${name} (${range} vs ${rootLockDeps[name] || 'missing'})`);
    }
  }

  if (diffs.length === 0) return [];

  const ev = [
    { label: 'Out-of-sync deps', value: diffs.slice(0, 5).join(', ') },
    { label: 'Lockfile', value: 'package-lock.json' }
  ];

  return [
    {
      detectorId: id,
      title,
      evidence: ev,
      explanation: 'package-lock.json is out of sync with package.json.',
      fixes: fixes(ctx, null, ev)
    }
  ];
}

export default {
  id,
  title,
  match,
  gather,
  explain,
  fixes,
  preflight
};
