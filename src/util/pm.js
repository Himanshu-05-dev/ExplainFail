import fs from 'node:fs';
import path from 'node:path';

export function getLockfile(cwd = process.cwd()) {
  try {
    if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return { pm: 'pnpm', file: 'pnpm-lock.yaml' };
    if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return { pm: 'yarn', file: 'yarn.lock' };
    if (fs.existsSync(path.join(cwd, 'package-lock.json'))) return { pm: 'npm', file: 'package-lock.json' };
    if (fs.existsSync(path.join(cwd, 'bun.lockb'))) return { pm: 'bun', file: 'bun.lockb' };
    if (fs.existsSync(path.join(cwd, 'bun.lock'))) return { pm: 'bun', file: 'bun.lock' };
  } catch {
    return null;
  }
  return null;
}

export function detectPackageManager(cwd = process.cwd()) {
  const lock = getLockfile(cwd);
  return lock ? lock.pm : null;
}
