import fs from 'node:fs';
import path from 'node:path';
import { safeReadJson } from './util/fs.js';
import { redact } from './redact.js';
import { getLockfile } from './util/pm.js';

/**
 * Builds the --for-ai markdown report.
 * Format specified in Section 12:
 *
 * # explainfail report
 * ## Command
 * <command> (cwd: <relative or .>) — exit code <n>
 * ## Verified facts (checked by explainfail on this machine)
 * - <Evidence label>: <value>      (only facts from diagnoses; mark each [cause] or [finding])
 * ## Environment
 * - OS / platform, Node version, package manager, lockfile present, node_modules present
 * ## Error (last 80 lines of output, redacted)
 * <fenced block>
 * ## Already tried (do not repeat)
 * 1. <fix label> → result: PASS | SAME_ERROR | NEW_ERROR (<errorLine>)
 * ## Not verified
 * - explainfail could not confirm a cause.   (only if there were no diagnoses)
 *
 * @param {Object} runLog
 * @param {string} cwd
 * @returns {string}
 */
export function formatForAi(runLog, cwd = process.cwd()) {
  const lines = [];
  lines.push('# explainfail report');

  // ## Command
  const cmdStr = typeof runLog.command === 'string'
    ? runLog.command
    : (runLog.command?.shell || runLog.command?.argv?.join(' ') || 'unknown');
  const lastRound = runLog.rounds?.[runLog.rounds.length - 1];
  const exitCode = lastRound?.fingerprintAfter?.exitCode ?? lastRound?.fingerprintBefore?.exitCode ?? 1;
  lines.push('\n## Command');
  lines.push(`${cmdStr} (cwd: .) — exit code ${exitCode}`);

  // ## Verified facts
  lines.push('\n## Verified facts (checked by explainfail on this machine)');
  const facts = [];
  if (runLog.rounds) {
    for (const r of runLog.rounds) {
      if (r.diagnoses) {
        for (const d of r.diagnoses) {
          if (d.evidence) {
            for (const ev of d.evidence) {
              facts.push(`- ${ev.label}: ${ev.value} [${d.kind}]`);
            }
          }
        }
      }
    }
  }

  if (facts.length > 0) {
    lines.push(...facts);
  } else {
    lines.push('- No verified cause confirmed by deterministic rules.');
  }

  // ## Environment
  const lock = getLockfile(cwd);
  const nodeModulesExists = fs.existsSync(path.join(cwd, 'node_modules'));
  lines.push('\n## Environment');
  lines.push(`- OS: ${process.platform}, Node: ${process.version}, PM: ${lock?.pm || 'npm'}, Lockfile: ${lock ? lock.file : 'none'}, node_modules: ${nodeModulesExists ? 'present' : 'missing'}`);

  // ## Error (last 80 lines of output, redacted)
  lines.push('\n## Error (last 80 lines of output, redacted)');
  const lastError = lastRound?.fingerprintBefore?.errorLine || 'Unknown error';
  lines.push('```');
  lines.push(redact(lastError));
  lines.push('```');

  // ## Already tried
  lines.push('\n## Already tried (do not repeat)');
  let triedCount = 0;
  if (runLog.rounds) {
    for (const r of runLog.rounds) {
      if (r.fixApplied) {
        triedCount++;
        const resStr = r.result || 'APPLIED';
        const errDetail = r.fingerprintAfter?.errorLine ? ` (${r.fingerprintAfter.errorLine})` : '';
        lines.push(`${triedCount}. ${r.fixApplied.label} → result: ${resStr}${errDetail}`);
      }
    }
  }
  if (triedCount === 0) {
    lines.push('- No fixes have been applied yet.');
  }

  // ## Not verified
  if (facts.length === 0) {
    lines.push('\n## Not verified');
    lines.push('- explainfail could not confirm a cause.');
  }

  return lines.join('\n');
}

/**
 * Runs explainfail report
 * @param {Object} [options={}]
 * @returns {number} exit code
 */
export function runReport(options = {}) {
  const cwd = options.cwd || process.cwd();
  const latestPath = path.join(cwd, '.explainfail', 'runs', 'latest.json');

  if (!fs.existsSync(latestPath)) {
    console.error('No explainfail run found in this project.');
    return 1;
  }

  const runLog = safeReadJson(latestPath);
  if (!runLog) {
    console.error('Could not parse latest run log.');
    return 1;
  }

  if (options.forAi) {
    console.log(formatForAi(runLog, cwd));
    return 0;
  }

  if (options.json) {
    console.log(JSON.stringify(runLog, null, 2));
    return 0;
  }

  // Default human-readable report
  console.log(`explainfail report — Latest Run (${runLog.startedAt || 'unknown'})\n`);
  const cmdStr = typeof runLog.command === 'string'
    ? runLog.command
    : (runLog.command?.shell || runLog.command?.argv?.join(' ') || 'unknown');
  console.log(`Command:      ${cmdStr}`);
  console.log(`Final Status: ${runLog.finalStatus}`);
  console.log(`Total Rounds: ${runLog.rounds?.length || 0}`);

  return 0;
}

export default {
  runReport,
  formatForAi
};
