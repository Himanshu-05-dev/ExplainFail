import fs from 'node:fs';
import path from 'node:path';
import { isWindows } from '../util/platform.js';

export const id = 'eacces';
export const title = 'Permission denied (EACCES / EPERM)';

export function extractPath(output) {
  if (!output) return null;
  const match = output.match(/(?:EACCES|EPERM)[^'\n]*'([^']+)'/i);
  if (match) return match[1];

  const lines = output.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/(?:EACCES|EPERM)/i.test(lines[i])) {
      const pathMatch = (lines[i] + ' ' + (lines[i + 1] || '')).match(/'([^']+)'/);
      if (pathMatch) return pathMatch[1];
    }
  }
  return null;
}

export function match(ctx) {
  const output = ctx?.output || '';
  if (!/(?:EACCES|EPERM)/i.test(output)) return null;

  const targetPath = extractPath(output);
  if (!targetPath) return null;

  return {
    detectorId: id,
    data: { path: targetPath },
    matchedLines: output.split(/\r?\n/).filter((l) => /(?:EACCES|EPERM)/i.test(l))
  };
}

export async function gather(ctx, m) {
  if (isWindows()) {
    // Windows permission diagnosis is documented as partial/unsupported in v1
    return null;
  }

  const targetPath = m?.data?.path;
  if (!targetPath) return null;

  let checkPath = targetPath;
  while (checkPath && !fs.existsSync(checkPath) && path.dirname(checkPath) !== checkPath) {
    checkPath = path.dirname(checkPath);
  }

  if (!fs.existsSync(checkPath)) return null;

  try {
    const stat = fs.statSync(checkPath);
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;

    return [
      { label: 'Target path', value: targetPath },
      { label: 'Inspected path', value: checkPath },
      { label: 'Owner UID', value: String(stat.uid) },
      { label: 'Current UID', value: String(currentUid) },
      { label: 'Mode (octal)', value: (stat.mode & 0o777).toString(8) }
    ];
  } catch {
    return null;
  }
}

export function explain(m, ev) {
  const target = ev.find((e) => e.label === 'Target path')?.value || m?.data?.path || 'path';
  return `Permission denied while accessing "${target}". Your current user lacks required file permissions.`;
}

export function fixes(ctx, m, ev) {
  const target = ev.find((e) => e.label === 'Target path')?.value || m?.data?.path || '<path>';
  return [
    {
      id: 'fix-permissions-manual',
      label: `Correct file permissions for "${target}"`,
      type: 'manual',
      risk: 'low',
      manualText: `Run as root or chown to your current user:\n  sudo chown -R "$(id -u):$(id -g)" "${target}"\nSee docs: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally`
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
  extractPath
};
