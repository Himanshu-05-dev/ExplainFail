export const id = 'eresolve';
export const title = 'Conflicting peer dependencies (ERESOLVE)';

export function match(ctx) {
  const output = ctx?.output || '';
  if (!/npm (?:ERR!|error) code ERESOLVE/i.test(output)) {
    return null;
  }

  const lines = output.split(/\r?\n/);
  const matchedLines = lines.filter((l) =>
    /code ERESOLVE|Could not resolve dependency|Conflicting peer dependency|Found:|peer\s+/i.test(l)
  );

  return {
    detectorId: id,
    data: {},
    matchedLines
  };
}

export async function gather(ctx, m) {
  const matchedLines = m?.matchedLines || [];
  if (matchedLines.length === 0) return null;

  const evidence = [];
  for (const line of matchedLines.slice(0, 10)) {
    const clean = line.replace(/^npm (?:ERR!|error)\s*/i, '').trim();
    if (clean) {
      evidence.push({ label: 'Conflict detail', value: clean });
    }
  }

  return evidence.length > 0 ? evidence : null;
}

export function explain(m, ev) {
  return 'npm could not resolve peer dependencies due to conflicting version constraints.';
}

export function fixes(ctx, m, ev) {
  const result = [];

  result.push({
    id: 'align-peer-deps',
    label: 'Manually align conflicting peer dependency versions',
    type: 'manual',
    risk: 'low',
    manualText: 'Review the conflicting package versions in the evidence and update package.json to compatible versions.'
  });

  // Check if failed command was npm install / i / ci / update
  const cmd = ctx?.command;
  let isNpmInstall = false;
  if (cmd?.argv && cmd.argv.length > 0) {
    const bin = cmd.argv[0];
    const sub = cmd.argv[1];
    if (bin === 'npm' && ['install', 'i', 'ci', 'update'].includes(sub)) {
      isNpmInstall = true;
    }
  } else if (cmd?.shell && /\bnpm\s+(?:install|i|ci|update)\b/.test(cmd.shell)) {
    isNpmInstall = true;
  }

  if (isNpmInstall) {
    let newArgv;
    if (cmd.argv) {
      newArgv = [...cmd.argv, '--legacy-peer-deps'];
    } else {
      newArgv = ['npm', 'install', '--legacy-peer-deps'];
    }

    result.push({
      id: 'legacy-peer-deps',
      label: 'Re-run install with --legacy-peer-deps',
      type: 'command',
      risk: 'medium',
      argv: newArgv,
      warning: 'This can hide real incompatibilities.'
    });
  }

  return result;
}

export default {
  id,
  title,
  match,
  gather,
  explain,
  fixes
};
