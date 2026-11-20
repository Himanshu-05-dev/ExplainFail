import fs from 'node:fs';
import path from 'node:path';
import { redact } from './redact.js';

export const MAX_RETAINED_RUNS = 20;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Creates a backup of the specified files in .explainfail/backups/<timestamp>/
 * @param {string} cwd
 * @param {string[]} files
 * @returns {string|null} timestamp string or null if no files backed up
 */
export function createBackup(cwd = process.cwd(), files = []) {
  if (!files || files.length === 0) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(cwd, '.explainfail', 'backups', timestamp);

  let backedUpCount = 0;
  for (const relPath of files) {
    const fullPath = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath);
    if (fs.existsSync(fullPath)) {
      const destPath = path.join(backupDir, path.relative(cwd, fullPath));
      ensureDir(path.dirname(destPath));
      fs.copyFileSync(fullPath, destPath);
      backedUpCount++;
    }
  }

  pruneHistory(path.join(cwd, '.explainfail', 'backups'));
  return backedUpCount > 0 ? timestamp : null;
}

/**
 * Restores files from a backup timestamp folder back to cwd.
 * @param {string} cwd
 * @param {string} timestamp
 * @returns {boolean}
 */
export function restoreBackup(cwd = process.cwd(), timestamp) {
  if (!timestamp) return false;
  const backupDir = path.join(cwd, '.explainfail', 'backups', timestamp);
  if (!fs.existsSync(backupDir)) return false;

  function restoreDir(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullSource = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        restoreDir(fullSource);
      } else {
        const rel = path.relative(backupDir, fullSource);
        const dest = path.join(cwd, rel);
        ensureDir(path.dirname(dest));
        fs.copyFileSync(fullSource, dest);
      }
    }
  }

  restoreDir(backupDir);
  return true;
}

/**
 * Saves last failure fingerprint to .explainfail/last-failure.json
 * @param {string} cwd
 * @param {Object} fingerprint
 */
export function saveLastFailure(cwd = process.cwd(), fingerprint) {
  const dir = path.join(cwd, '.explainfail');
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, 'last-failure.json'), JSON.stringify(fingerprint, null, 2), 'utf8');
}

/**
 * Recursively redacts strings in an object.
 */
function redactObject(obj) {
  if (typeof obj === 'string') {
    return redact(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(redactObject);
  }
  if (obj && typeof obj === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = redactObject(v);
    }
    return res;
  }
  return obj;
}

/**
 * Saves a run log into .explainfail/runs/<timestamp>.json and updates latest.json
 * @param {string} cwd
 * @param {Object} runLog
 */
export function saveRunLog(cwd = process.cwd(), runLog) {
  const runsDir = path.join(cwd, '.explainfail', 'runs');
  ensureDir(runsDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sanitized = redactObject(runLog);
  const jsonStr = JSON.stringify(sanitized, null, 2);

  fs.writeFileSync(path.join(runsDir, `${timestamp}.json`), jsonStr, 'utf8');
  fs.writeFileSync(path.join(runsDir, 'latest.json'), jsonStr, 'utf8');

  pruneHistory(runsDir);
}

/**
 * Prunes directory to retain only the most recent MAX_RETAINED_RUNS items.
 * @param {string} dir
 */
export function pruneHistory(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.name !== 'latest.json' && e.name !== 'last-failure.json')
      .map((e) => ({
        name: e.name,
        path: path.join(dir, e.name),
        mtime: fs.statSync(path.join(dir, e.name)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (entries.length > MAX_RETAINED_RUNS) {
      const toDelete = entries.slice(MAX_RETAINED_RUNS);
      for (const item of toDelete) {
        fs.rmSync(item.path, { recursive: true, force: true });
      }
    }
  } catch {
    // Ignore prune errors
  }
}

export default {
  createBackup,
  restoreBackup,
  saveLastFailure,
  saveRunLog,
  pruneHistory,
  MAX_RETAINED_RUNS
};
