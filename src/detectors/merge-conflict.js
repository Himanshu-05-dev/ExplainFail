import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';

export const id = 'merge-conflict';
export const title = 'Unresolved git merge conflicts';

function scanFileForConflicts(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024) return null; // Skip files > 1 MB

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    let hasStart = false;
    let hasMid = false;
    let hasEnd = false;
    let startLine = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('<<<<<<< ')) {
        hasStart = true;
        if (startLine === null) startLine = i + 1;
      } else if (line === '=======') {
        hasMid = true;
      } else if (line.startsWith('>>>>>>> ')) {
        hasEnd = true;
      }
    }

    if (hasStart && hasMid && hasEnd) {
      return { filePath, line: startLine || 1 };
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

export async function findConflictFiles(cwd = process.cwd()) {
  const conflictFiles = [];

  // Try git ls-files first
  try {
    const git = await execa('git', ['ls-files'], { cwd, reject: false });
    if (git.exitCode === 0 && git.stdout) {
      const files = git.stdout.split(/\r?\n/).filter(Boolean);
      for (const rel of files) {
        const full = path.join(cwd, rel);
        const res = scanFileForConflicts(full);
        if (res) {
          conflictFiles.push(`${rel}:${res.line}`);
          if (conflictFiles.length >= 20) break;
        }
      }
      return conflictFiles;
    }
  } catch {
    // fallback to directory scan
  }

  // Fallback: directory walk
  function walk(currentDir) {
    if (conflictFiles.length >= 20) return;
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (['node_modules', '.git', 'dist', 'build', '.explainfail'].includes(entry.name)) {
          continue;
        }
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const res = scanFileForConflicts(full);
          if (res) {
            conflictFiles.push(`${path.relative(cwd, full)}:${res.line}`);
            if (conflictFiles.length >= 20) return;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  walk(cwd);
  return conflictFiles;
}

export function match(ctx) {
  // If output mentions conflict markers or "merge conflict"
  const output = ctx?.output || '';
  if (/merge conflict|<<<<<<<|=======|>>>>>>>/i.test(output)) {
    return {
      detectorId: id,
      data: {},
      matchedLines: output.split(/\r?\n/).filter((l) => /merge conflict|<<<<<<<|=======|>>>>>>>/i.test(l))
    };
  }
  return null;
}

export async function gather(ctx) {
  const cwd = ctx?.cwd || process.cwd();
  const conflicts = await findConflictFiles(cwd);
  if (conflicts.length === 0) return null;

  return [
    { label: 'Conflict files', value: conflicts.join(', ') },
    { label: 'Total files', value: String(conflicts.length) }
  ];
}

export function explain(m, ev) {
  const files = ev.find((e) => e.label === 'Conflict files')?.value || 'files';
  return `Unresolved merge conflict markers found in: ${files}.`;
}

export function fixes() {
  return [
    {
      id: 'resolve-conflicts-manual',
      label: 'Resolve merge conflicts manually',
      type: 'manual',
      risk: 'low',
      manualText: 'Open the affected files, resolve the conflict blocks between <<<<<<< and >>>>>>>, and run git add.'
    }
  ];
}

export async function preflight(ctx) {
  const cwd = ctx?.cwd || process.cwd();
  const conflicts = await findConflictFiles(cwd);
  if (conflicts.length === 0) return [];

  const ev = [
    { label: 'Conflict files', value: conflicts.join(', ') },
    { label: 'Total files', value: String(conflicts.length) }
  ];

  return [
    {
      detectorId: id,
      title,
      evidence: ev,
      explanation: explain(null, ev),
      fixes: fixes()
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
  preflight,
  findConflictFiles
};
