import path from 'node:path';
import semver from 'semver';
import { safeReadFile, safeReadJson } from '../util/fs.js';

export const id = 'node-version';
export const title = 'Incompatible Node.js version';

export function match(ctx) {
  const output = ctx?.output || '';

  // Explicitly do not match ERR_REQUIRE_ESM
  if (/ERR_REQUIRE_ESM/.test(output)) {
    return null;
  }

  const triggers = [
    /Unsupported engine/i,
    /The engine "node" is incompatible/i,
    /requires Node(\.js)? .*(>=|\^|~|\d)/i
  ];

  const matched = triggers.some((r) => r.test(output));
  if (!matched) return null;

  return {
    detectorId: id,
    data: {},
    matchedLines: output.split(/\r?\n/).filter((l) => triggers.some((r) => r.test(l)))
  };
}

export function checkVersionMismatch(cwd = process.cwd()) {
  const current = process.version; // e.g. 'v18.17.0'
  const cleanCurrent = semver.clean(current) || current;

  // 1. Check .nvmrc
  const nvmrc = safeReadFile(path.join(cwd, '.nvmrc'));
  if (nvmrc && nvmrc.trim()) {
    const raw = nvmrc.trim();
    const spec = semver.validRange(raw) || (semver.coerce(raw) ? `^${semver.coerce(raw).version}` : raw);
    if (spec && !semver.satisfies(cleanCurrent, spec)) {
      return { current, spec: raw, definedIn: '.nvmrc' };
    }
  }

  // 2. Check .node-version
  const nodeVersionFile = safeReadFile(path.join(cwd, '.node-version'));
  if (nodeVersionFile && nodeVersionFile.trim()) {
    const raw = nodeVersionFile.trim();
    const spec = semver.validRange(raw) || (semver.coerce(raw) ? `^${semver.coerce(raw).version}` : raw);
    if (spec && !semver.satisfies(cleanCurrent, spec)) {
      return { current, spec: raw, definedIn: '.node-version' };
    }
  }

  // 3. Check package.json -> engines.node
  const pkg = safeReadJson(path.join(cwd, 'package.json'));
  if (pkg?.engines?.node) {
    const spec = pkg.engines.node.trim();
    if (semver.validRange(spec) && !semver.satisfies(cleanCurrent, spec)) {
      return { current, spec, definedIn: 'package.json (engines.node)' };
    }
  }

  return null;
}

export async function gather(ctx) {
  const mismatch = checkVersionMismatch(ctx?.cwd);
  if (!mismatch) return null;

  return [
    { label: 'Current Node', value: mismatch.current },
    { label: 'Required Node', value: mismatch.spec },
    { label: 'Defined in', value: mismatch.definedIn }
  ];
}

export function explain(m, ev) {
  const current = ev.find((e) => e.label === 'Current Node')?.value || process.version;
  const req = ev.find((e) => e.label === 'Required Node')?.value || 'unknown';
  const source = ev.find((e) => e.label === 'Defined in')?.value || 'project config';
  return `Current Node.js version (${current}) does not satisfy requirement "${req}" specified in ${source}.`;
}

export function fixes(ctx, m, ev) {
  const req = ev.find((e) => e.label === 'Required Node')?.value || '';
  return [
    {
      id: 'switch-node',
      label: `Switch Node version to ${req}`,
      type: 'manual',
      risk: 'low',
      manualText: `explainfail cannot change your shell's Node version. Run one of:\n  nvm use ${req}\n  fnm use\n  volta pin node@${req}\nOr download from https://nodejs.org`
    }
  ];
}

export async function preflight(ctx) {
  const mismatch = checkVersionMismatch(ctx?.cwd);
  if (!mismatch) return [];

  const ev = [
    { label: 'Current Node', value: mismatch.current },
    { label: 'Required Node', value: mismatch.spec },
    { label: 'Defined in', value: mismatch.definedIn }
  ];

  return [
    {
      detectorId: id,
      title,
      evidence: ev,
      explanation: explain(null, ev),
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
  preflight,
  checkVersionMismatch
};
