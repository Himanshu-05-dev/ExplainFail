import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { runCommand } from './runner.js';
import { buildContext } from './context.js';
import { computeFingerprint, compare } from './fingerprint.js';
import { DETECTORS } from './detectors/index.js';
import { safeReadJson } from './util/fs.js';

/**
 * Runs explainfail verify "<command>"
 * @param {import('./runner').CommandSpec|string} command
 * @param {Object} [options={}]
 * @returns {Promise<{ exitCode: number, result: Object }>}
 */
export async function runVerify(command, options = {}) {
  const cwd = options.cwd || process.cwd();
  const timeoutSec = parseInt(options.timeout || '60', 10);
  const timeoutMs = timeoutSec * 1000;
  const alsoCommands = Array.isArray(options.also) ? options.also : (options.also ? [options.also] : []);
  const isJson = Boolean(options.json);

  // Load baseline fingerprint if available
  let baselineFingerprint = null;
  const baselinePath = options.baseline || path.join(cwd, '.explainfail', 'last-failure.json');
  if (fs.existsSync(baselinePath)) {
    baselineFingerprint = safeReadJson(baselinePath, null);
  }

  const runResult = await runCommand(command, {
    cwd,
    timeout: timeoutMs,
    silent: isJson
  });

  const ctx = buildContext({
    cwd,
    command,
    output: runResult.output,
    exitCode: runResult.exitCode,
    signal: runResult.signal
  });

  // Check matched detectors
  const detectorsMatched = [];
  for (const d of DETECTORS) {
    if (d.match && d.match(ctx)) {
      detectorsMatched.push(d.id);
    }
  }

  const fingerprint = computeFingerprint(ctx, detectorsMatched);

  let status;
  if (runResult.exitCode === 0) {
    status = 'PASS';
  } else if (runResult.timedOut) {
    status = 'STAYED_UP';
  } else if (baselineFingerprint) {
    status = compare(baselineFingerprint, fingerprint);
  } else {
    status = 'NEW_ERROR';
  }

  // Also regression checks
  const alsoResults = [];
  let alsoPassed = true;
  if (status === 'PASS' || status === 'STAYED_UP') {
    for (const alsoCmd of alsoCommands) {
      const aRes = await runCommand([alsoCmd], { cwd, silent: isJson });
      alsoResults.push({ command: alsoCmd, exitCode: aRes.exitCode });
      if (aRes.exitCode !== 0) {
        alsoPassed = false;
      }
    }
  }

  const overallSuccess = (status === 'PASS' || status === 'STAYED_UP') && alsoPassed;
  const exitCode = overallSuccess ? 0 : 1;

  const resultObj = {
    status,
    command,
    exitCode: runResult.exitCode,
    fingerprint,
    baselineFingerprint,
    detectorsMatched,
    also: alsoResults
  };

  if (isJson) {
    console.log(JSON.stringify(resultObj, null, 2));
  } else {
    if (status === 'PASS') {
      console.log(chalk.green('✔ PASS: command exits with code 0.'));
    } else if (status === 'STAYED_UP') {
      console.log(chalk.yellow(`⚠ STAYED_UP: process still running at ${timeoutSec}s timeout. (Not proof of clean exit).`));
    } else if (status === 'SAME_ERROR') {
      console.log(chalk.red(`✖ SAME_ERROR: failed with same error fingerprint as baseline.`));
    } else {
      console.log(chalk.red(`✖ NEW_ERROR: failed with error: ${fingerprint.errorLine || 'Unknown'}`));
    }

    if (!alsoPassed) {
      console.log(chalk.red('✖ One or more --also commands failed.'));
    }
  }

  return { exitCode, result: resultObj };
}

export default runVerify;
