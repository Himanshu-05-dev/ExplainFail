import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { execa } from 'execa';
import { safeReadJson } from '../util/fs.js';

export const id = 'module-not-found';
export const title = 'Module not found';

const BUILTINS = new Set(builtinModules.concat(builtinModules.map((m) => `node:${m}`)));

export function extractModule(output) {
  if (!output || typeof output !== 'string') return null;

  const patterns = [
    /Cannot find module '([^']+)'/,
    /Cannot find package '([^']+)' imported from/,
    /Module not found: Can't resolve '([^']+)'/,
    /Error \[ERR_MODULE_NOT_FOUND\]: Cannot find package '([^']+)'/
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

export function match(ctx) {
  const output = ctx?.output || '';
  const mod = extractModule(output);
  if (!mod) return null;

  return {
    detectorId: id,
    data: { module: mod },
    matchedLines: output.split(/\r?\n/).filter((l) => /Cannot find module|Cannot find package|ERR_MODULE_NOT_FOUND|resolve/i.test(l))
  };
}

export async function gather(ctx, m) {
  const mod = m?.data?.module;
  if (!mod) return null;

  const cwd = ctx?.cwd || process.cwd();

  // Branch 1: Relative or absolute local file path
  if (mod.startsWith('.') || mod.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(mod)) {
    const resolved = path.resolve(cwd, mod);
    return [
      { label: 'Module Path', value: mod },
      { label: 'Resolved Path', value: resolved },
      { label: 'Exists', value: 'false' },
      { label: 'Type', value: 'file' }
    ];
  }

  // Branch 2: Built-in Node module
  if (BUILTINS.has(mod)) {
    return null; // Node builtin, not a package install issue
  }

  // Branch 3: Bare package name
  const pkg = ctx?.pkg || safeReadJson(path.join(cwd, 'package.json'));
  const allDeps = {
    ...(pkg?.dependencies || {}),
    ...(pkg?.devDependencies || {}),
    ...(pkg?.optionalDependencies || {})
  };

  const isDeclared = Object.prototype.hasOwnProperty.call(allDeps, mod);

  if (isDeclared) {
    // Check if node_modules/<mod>/package.json exists
    const installedPath = path.join(cwd, 'node_modules', mod, 'package.json');
    const isInstalled = fs.existsSync(installedPath);

    return [
      { label: 'Package', value: mod },
      { label: 'In package.json', value: 'true' },
      { label: 'Installed in node_modules', value: isInstalled ? 'true' : 'false' },
      { label: 'Type', value: 'declared-package' }
    ];
  }

  // Not in package.json: run read-only "npm view <pkg> name"
  let registryFound = false;
  try {
    const res = await execa('npm', ['view', mod, 'name'], { timeout: 4000, reject: false });
    if (res.exitCode === 0 && res.stdout.trim() === mod) {
      registryFound = true;
    }
  } catch {
    registryFound = false;
  }

  return [
    { label: 'Package', value: mod },
    { label: 'In package.json', value: 'false' },
    { label: 'Registry status', value: registryFound ? 'found on npm' : 'unverified' },
    { label: 'Type', value: 'undeclared-package' }
  ];
}

export function explain(m, ev) {
  const type = ev.find((e) => e.label === 'Type')?.value;
  const mod = m?.data?.module || 'module';

  if (type === 'file') {
    const resolved = ev.find((e) => e.label === 'Resolved Path')?.value || mod;
    return `Local file "${mod}" does not exist at expected path ${resolved}.`;
  }

  if (type === 'declared-package') {
    return `Package "${mod}" is listed in package.json but is not installed in node_modules.`;
  }

  const status = ev.find((e) => e.label === 'Registry status')?.value;
  if (status === 'found on npm') {
    return `Package "${mod}" is not listed in package.json or installed.`;
  }

  return `Cannot find module "${mod}". It is neither a local file nor listed in package.json.`;
}

export function fixes(ctx, m, ev) {
  const type = ev.find((e) => e.label === 'Type')?.value;
  const mod = m?.data?.module;
  const pm = ctx?.pm || 'npm';
  const result = [];

  if (type === 'file') {
    result.push({
      id: 'fix-file-path',
      label: `Check the file path for "${mod}"`,
      type: 'manual',
      risk: 'low',
      manualText: 'This is a relative or local file path; verify the file name, directory, case sensitivity, and file extension.'
    });
    return result;
  }

  if (type === 'declared-package') {
    result.push({
      id: 'install-dependencies',
      label: `Install dependencies with ${pm}`,
      type: 'command',
      risk: 'low',
      argv: [pm, 'install']
    });
    return result;
  }

  if (type === 'undeclared-package') {
    const regStatus = ev.find((e) => e.label === 'Registry status')?.value;
    if (regStatus === 'found on npm') {
      const installArgs = pm === 'npm' ? ['install', mod] : ['add', mod];
      result.push({
        id: 'add-package',
        label: `Install "${mod}" with ${pm}`,
        type: 'command',
        risk: 'medium',
        argv: [pm, ...installArgs],
        warning: 'It may belong in devDependencies.'
      });
    } else {
      result.push({
        id: 'manual-package',
        label: `Verify package "${mod}"`,
        type: 'manual',
        risk: 'low',
        manualText: `Could not verify "${mod}" on the npm registry. Check for typos or run: ${pm} install ${mod}`
      });
    }
  }

  return result;
}

export async function preflight(ctx) {
  const cwd = ctx?.cwd || process.cwd();
  const pkg = safeReadJson(path.join(cwd, 'package.json'));
  if (!pkg) return [];

  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {})
  };

  const missing = [];
  for (const dep of Object.keys(allDeps)) {
    const installed = fs.existsSync(path.join(cwd, 'node_modules', dep, 'package.json'));
    if (!installed) {
      missing.push(dep);
    }
  }

  if (missing.length === 0) return [];

  const pm = ctx?.pm || 'npm';
  return [
    {
      detectorId: id,
      title: 'Missing installed packages',
      evidence: [
        { label: 'Missing packages', value: missing.slice(0, 10).join(', ') },
        { label: 'Total missing', value: String(missing.length) }
      ],
      explanation: `${missing.length} package(s) declared in package.json are not installed in node_modules.`,
      fixes: [
        {
          id: 'install-all-missing',
          label: `Run ${pm} install`,
          type: 'command',
          risk: 'low',
          argv: [pm, 'install']
        }
      ]
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
  extractModule
};
