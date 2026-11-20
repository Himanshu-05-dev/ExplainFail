import chalk from 'chalk';

/**
 * Formats the honest UNKNOWN fallback message.
 * Must match exact specification in Section 11:
 *
 * explainfail could not confirm a cause for this failure. No rule matched with evidence.
 * Last error line: <errorLine>
 * Search: https://www.google.com/search?q=<url-encoded errorLine>
 *
 * @param {string} [errorLine='']
 * @returns {string}
 */
export function formatUnknown(errorLine = '') {
  const cleanLine = errorLine || 'Unknown error';
  const query = encodeURIComponent(cleanLine);
  return [
    chalk.yellow('explainfail could not confirm a cause for this failure. No rule matched with evidence.'),
    `Last error line: ${cleanLine}`,
    `Search: https://www.google.com/search?q=${query}`
  ].join('\n');
}

/**
 * Formats a command failure header.
 * @param {string} commandStr
 * @param {number|null} exitCode
 * @returns {string}
 */
export function formatCommandFailure(commandStr, exitCode = 1) {
  const code = exitCode ?? 1;
  return chalk.red(`✖ Command failed: ${commandStr}   (exit code ${code})`);
}

/**
 * Formats a diagnosis block (Section 11).
 * @param {import('./types').Diagnosis} diag
 * @returns {string}
 */
export function formatDiagnosis(diag) {
  const lines = [];

  const kindTag = `[${diag.kind}]`;
  lines.push(`${chalk.bold('PROBLEM')}  ${diag.title.padEnd(40)} ${chalk.dim(kindTag)}`);

  if (diag.evidence && diag.evidence.length > 0) {
    lines.push(chalk.bold('EVIDENCE'));
    for (const item of diag.evidence) {
      lines.push(`  ${item.label.padEnd(14)} ${item.value}`);
    }
  }

  if (diag.explanation) {
    lines.push(chalk.bold('EXPLANATION'));
    lines.push(`  ${diag.explanation}`);
  }

  if (diag.fixes && diag.fixes.length > 0) {
    const topFix = diag.fixes[0];
    lines.push(`${chalk.bold('FIX')}  ${chalk.dim(`(risk: ${topFix.risk})`)}`);
    lines.push(`  ${topFix.label}`);
    if (topFix.type === 'command' && topFix.argv) {
      lines.push(`  Will run: ${topFix.argv.join(' ')}`);
    } else if (topFix.type === 'file' && topFix.files) {
      const filesDesc = topFix.files.map((f) => `${f.action} ${f.path}`).join(', ');
      lines.push(`  Will change: ${filesDesc}`);
    } else if (topFix.type === 'manual' && topFix.manualText) {
      lines.push(`  Manual action: ${topFix.manualText}`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats a fix prompt block.
 * @param {import('./types').Fix} fix
 * @returns {string}
 */
export function formatFixPrompt(fix) {
  const lines = [];
  lines.push(`Fix: ${fix.label}`);
  lines.push(`Risk: ${fix.risk}`);
  if (fix.type === 'command' && fix.argv) {
    lines.push(`Will run: ${fix.argv.join(' ')}`);
  } else if (fix.type === 'file' && fix.files) {
    const filesDesc = fix.files.map((f) => `${f.action} ${f.path}`).join(', ');
    lines.push(`Will change: ${filesDesc}`);
  }
  if (fix.warning) {
    lines.push(`Warning: ${fix.warning}`);
  }
  return lines.join('\n');
}

/**
 * Formats the post re-run result status (Section 11).
 * @param {'PASS'|'STAYED_UP'|'SAME_ERROR'|'NEW_ERROR'} status
 * @param {Object} [details={}]
 * @returns {string}
 */
export function formatResult(status, details = {}) {
  switch (status) {
    case 'PASS':
      return chalk.green('✔ PASS: command now exits with code 0.');
    case 'STAYED_UP': {
      const sec = details.timeoutSec || 60;
      return chalk.yellow(`⚠ STAYED UP: still running after ${sec}s, no known error seen. This is not proof of a clean exit.`);
    }
    case 'SAME_ERROR': {
      const codeInfo = details.errorCode ? ` (errorCode ${details.errorCode} unchanged)` : '';
      return chalk.red(`✖ SAME ERROR: the fix did not solve it.${codeInfo}`);
    }
    case 'NEW_ERROR': {
      const lineInfo = details.errorLine ? `: ${details.errorLine}` : '';
      return chalk.yellow(`⚠ NEW ERROR: previous problem is gone, but a different error appeared${lineInfo}`);
    }
    default:
      return status;
  }
}

export default {
  formatUnknown,
  formatCommandFailure,
  formatDiagnosis,
  formatFixPrompt,
  formatResult
};
