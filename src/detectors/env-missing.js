import fs from 'node:fs';
import path from 'node:path';
import { safeReadFile } from '../util/fs.js';

export const id = 'env-missing';
export const title = 'Missing environment variables';

export function match() {
  // env-missing is finding-only; trigger on output is none
  return null;
}

export function parseEnvKeys(content) {
  if (!content) return [];
  const keys = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
    if (match) {
      keys.push(match[1]);
    }
  }
  return keys;
}

export function checkEnvDiff(cwd = process.cwd()) {
  let exampleFile = null;
  if (fs.existsSync(path.join(cwd, '.env.example'))) {
    exampleFile = '.env.example';
  } else if (fs.existsSync(path.join(cwd, '.env.sample'))) {
    exampleFile = '.env.sample';
  }

  if (!exampleFile) return null;

  const exampleContent = safeReadFile(path.join(cwd, exampleFile));
  const exampleKeys = parseEnvKeys(exampleContent);
  if (exampleKeys.length === 0) return null;

  const envPath = path.join(cwd, '.env');
  const envExists = fs.existsSync(envPath);

  if (!envExists) {
    return {
      status: 'missing_env',
      exampleFile,
      missingKeys: exampleKeys
    };
  }

  const envContent = safeReadFile(envPath);
  const existingKeys = new Set(parseEnvKeys(envContent));
  const missing = exampleKeys.filter((k) => !existingKeys.has(k));

  if (missing.length === 0) return null;

  return {
    status: 'missing_keys',
    exampleFile,
    missingKeys: missing
  };
}

export async function preflight(ctx) {
  const cwd = ctx?.cwd || process.cwd();
  const diff = checkEnvDiff(cwd);
  if (!diff) return [];

  const evidence = [
    { label: 'Template file', value: diff.exampleFile },
    { label: 'Missing keys', value: diff.missingKeys.join(', ') }
  ];

  if (diff.status === 'missing_env') {
    evidence.push({ label: '.env status', value: 'File missing' });
  }

  const fixList = [];
  if (diff.status === 'missing_env') {
    fixList.push({
      id: 'create-env',
      label: 'Create .env from template',
      type: 'file',
      risk: 'low',
      files: [{ path: '.env', action: 'create' }],
      apply: async (c) => {
        const dest = path.join(c.cwd, '.env');
        const src = path.join(c.cwd, diff.exampleFile);
        fs.copyFileSync(src, dest);
      }
    });
  } else if (diff.status === 'missing_keys') {
    fixList.push({
      id: 'append-env-keys',
      label: `Append missing keys to .env (${diff.missingKeys.join(', ')})`,
      type: 'file',
      risk: 'medium',
      files: [{ path: '.env', action: 'modify' }],
      apply: async (c) => {
        const envPath = path.join(c.cwd, '.env');
        const appendText = '\n# added by explainfail\n' + diff.missingKeys.map((k) => `${k}=`).join('\n') + '\n';
        fs.appendFileSync(envPath, appendText, 'utf8');
      }
    });
  }

  return [
    {
      detectorId: id,
      title: diff.status === 'missing_env' ? '.env file missing' : 'Missing environment variables in .env',
      evidence,
      explanation:
        diff.status === 'missing_env'
          ? `The project provides ${diff.exampleFile}, but .env does not exist.`
          : `Variables defined in ${diff.exampleFile} are missing from .env: ${diff.missingKeys.join(', ')}.`,
      fixes: fixList
    }
  ];
}

export default {
  id,
  title,
  match,
  gather: async () => null,
  explain: () => 'Missing required environment keys.',
  fixes: () => [],
  preflight,
  parseEnvKeys,
  checkEnvDiff
};

