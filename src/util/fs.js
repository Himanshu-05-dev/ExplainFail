import fs from 'node:fs';
import path from 'node:path';

export const PROTECTED_GLOBS = [
  '**/*.test.*',
  '**/*.spec.*',
  '.github/**',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock'
];

export function safeReadFile(filePath, encoding = 'utf8') {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, encoding);
  } catch {
    return null;
  }
}

export function safeReadJson(filePath) {
  const content = safeReadFile(filePath);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}
