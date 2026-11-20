import { execa } from 'execa';
import prompts from 'prompts';
import { runCommand } from './runner.js';
import { buildContext } from './context.js';
import { diagnose } from './engine.js';
import { DETECTORS } from './detectors/index.js';
import { computeFingerprint, compare } from './fingerprint.js';
import {
  formatCommandFailure,
  formatDiagnosis,
  formatFixPrompt,
  formatUnknown,
  formatResult
} from './reporter.js';
import {
  createBackup,
  restoreBackup,
  saveLastFailure,
  saveRunLog
} from './backup.js';

/**
 * Runs the main explainfail execution and verification loop.
 * @param {import('./runner').CommandSpec|string[]} command
 * @param {Object} [options={}]
 * @returns {Promise<{ exitCode: number, finalStatus: string }>}
 */
export async function runLoop(command, options = {}) {
  const cwd = options.cwd || process.cwd();
  const maxRounds = parseInt(options.maxRounds || '5', 10);
  const verifyTimeout = parseInt(options.verifyTimeout || '60', 10) * 1000;
  const isDryRun = Boolean(options.dryRun);
  const isNoFix = Boolean(options.noFix);
  const isAutoYes = Boolean(options.yes);
  const alsoCommands = Array.isArray(options.also) ? options.also : (options.also ? [options.also] : []);

  const runLog = {
    command,
    startedAt: new Date().toISOString(),
    rounds: [],
    finalStatus: 'UNKNOWN'
  };

  let round = 1;
  let currentCommandResult = null;
  const fixChain = [];

  while (round <= maxRounds) {
    let liveMatchOccurred = false;
    const seenLiveDetectors = new Set();
    let debounceTimer = null;

    const onChunk = (chunk, totalOutput) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const liveCtx = buildContext({ output: totalOutput, cwd, command });
        for (const d of DETECTORS) {
          if (!seenLiveDetectors.has(d.id) && d.match && d.match(liveCtx)) {
            seenLiveDetectors.add(d.id);
            liveMatchOccurred = true;
            console.log(`explainfail: output matches known problem "${d.id}" — full diagnosis when the process exits.`);
          }
        }
      }, 500);
    };

    // 1. Run the command
    currentCommandResult = await runCommand(command, {
      cwd,
      timeout: round > 1 ? verifyTimeout : 0,
      onChunk
    });

    if (debounceTimer) clearTimeout(debounceTimer);

    // 2. If exit code 0 -> success
    if (currentCommandResult.exitCode === 0) {
      if (fixChain.length > 0) {
        console.log(formatResult('PASS'));
      }
      runLog.finalStatus = 'PASS';
      saveRunLog(cwd, runLog);
      return { exitCode: 0, finalStatus: 'PASS' };
    }

    // 3. User interruption check
    if (currentCommandResult.userInterrupted && !liveMatchOccurred) {
      runLog.finalStatus = 'INTERRUPTED';
      saveRunLog(cwd, runLog);
      return { exitCode: currentCommandResult.exitCode ?? 130, finalStatus: 'INTERRUPTED' };
    }

    // 4. Build fingerprint F_before and save
    const ctx = buildContext({
      cwd,
      command,
      output: currentCommandResult.output,
      exitCode: currentCommandResult.exitCode,
      signal: currentCommandResult.signal,
      interactive: !options.nonInteractive && Boolean(process.stdin.isTTY && process.stdout.isTTY)
    });

    const fBefore = computeFingerprint(ctx);
    saveLastFailure(cwd, fBefore);

    // 5. Diagnose
    const diagnoses = await diagnose(ctx, DETECTORS);

    const roundLog = {
      round,
      fingerprintBefore: fBefore,
      diagnoses: diagnoses.map((d) => ({
        id: d.detectorId,
        kind: d.kind,
        evidence: d.evidence
      })),
      fixApplied: null,
      result: null,
      fingerprintAfter: null
    };

    // 6. Print diagnoses or fallback
    const cmdStr = typeof command === 'string' ? command : (command.shell || command.argv?.join(' ') || '');
    console.log('\n' + formatCommandFailure(cmdStr, currentCommandResult.exitCode));

    if (diagnoses.length === 0) {
      console.log('\n' + formatUnknown(fBefore.errorLine));
      runLog.rounds.push(roundLog);
      runLog.finalStatus = 'UNKNOWN_ERROR';
      saveRunLog(cwd, runLog);
      return { exitCode: currentCommandResult.exitCode, finalStatus: 'UNKNOWN_ERROR' };
    }

    for (const d of diagnoses) {
      console.log('\n' + formatDiagnosis(d));
    }

    // 7. Check non-fix / dry-run / non-interactive flags
    if (isNoFix) {
      runLog.rounds.push(roundLog);
      runLog.finalStatus = 'NO_FIX';
      saveRunLog(cwd, runLog);
      return { exitCode: currentCommandResult.exitCode, finalStatus: 'NO_FIX' };
    }

    // Identify top-ranked fix: first from 'cause' else first from 'finding'
    const causeDiag = diagnoses.find((d) => d.kind === 'cause' && d.fixes?.length > 0);
    const targetDiag = causeDiag || diagnoses.find((d) => d.fixes?.length > 0);
    const chosenFix = targetDiag?.fixes?.[0];

    if (!chosenFix) {
      runLog.rounds.push(roundLog);
      runLog.finalStatus = 'NO_FIX_AVAILABLE';
      saveRunLog(cwd, runLog);
      return { exitCode: currentCommandResult.exitCode, finalStatus: 'NO_FIX_AVAILABLE' };
    }

    if (isDryRun) {
      console.log('\n' + formatFixPrompt(chosenFix));
      console.log('(dry-run) nothing was changed');
      runLog.rounds.push(roundLog);
      runLog.finalStatus = 'DRY_RUN';
      saveRunLog(cwd, runLog);
      return { exitCode: currentCommandResult.exitCode, finalStatus: 'DRY_RUN' };
    }

    // Manual fixes are displayed, never executed
    if (chosenFix.type === 'manual') {
      runLog.rounds.push(roundLog);
      runLog.finalStatus = 'MANUAL_FIX_REQUIRED';
      saveRunLog(cwd, runLog);
      return { exitCode: currentCommandResult.exitCode, finalStatus: 'MANUAL_FIX_REQUIRED' };
    }

    // Non-interactive check without --yes
    if (!ctx.interactive && !isAutoYes) {
      runLog.rounds.push(roundLog);
      runLog.finalStatus = 'NON_INTERACTIVE';
      saveRunLog(cwd, runLog);
      return { exitCode: currentCommandResult.exitCode, finalStatus: 'NON_INTERACTIVE' };
    }

    // 8. Permission check
    let approved = false;
    if (isAutoYes && chosenFix.risk === 'low') {
      approved = true;
    } else if (ctx.interactive) {
      console.log('\n' + formatFixPrompt(chosenFix));
      const res = await prompts({
        type: 'confirm',
        name: 'apply',
        message: 'Apply this fix?',
        initial: false
      });
      approved = Boolean(res.apply);
    }

    if (!approved) {
      console.log('Fix declined by user.');
      runLog.rounds.push(roundLog);
      runLog.finalStatus = 'USER_DECLINED';
      saveRunLog(cwd, runLog);
      return { exitCode: currentCommandResult.exitCode, finalStatus: 'USER_DECLINED' };
    }

    // 9. Backup & Apply
    const affectedFiles = [];
    if (chosenFix.type === 'file' && chosenFix.files) {
      for (const f of chosenFix.files) {
        affectedFiles.push(f.path);
      }
    }
    if (chosenFix.type === 'command' && chosenFix.argv?.some((a) => a === 'install' || a === 'add')) {
      affectedFiles.push('package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb');
    }

    const backupTimestamp = createBackup(cwd, affectedFiles);

    try {
      if (chosenFix.type === 'command' && chosenFix.argv) {
        console.log(`Running: ${chosenFix.argv.join(' ')}`);
        await execa(chosenFix.argv[0], chosenFix.argv.slice(1), {
          cwd,
          shell: false,
          stdio: 'inherit'
        });
      } else if (chosenFix.type === 'file' && typeof chosenFix.apply === 'function') {
        await chosenFix.apply(ctx);
      }
      fixChain.push(chosenFix.label);
      roundLog.fixApplied = { id: chosenFix.id, label: chosenFix.label, risk: chosenFix.risk };
    } catch (applyErr) {
      if (backupTimestamp) {
        restoreBackup(cwd, backupTimestamp);
      }
      console.error('Error applying fix:', applyErr.message);
      runLog.rounds.push(roundLog);
      runLog.finalStatus = 'FIX_FAILED';
      saveRunLog(cwd, runLog);
      return { exitCode: 70, finalStatus: 'FIX_FAILED' };
    }

    // 10. Re-run identical command
    console.log('\nRe-running command to verify fix...');
    const reRunResult = await runCommand(command, {
      cwd,
      timeout: verifyTimeout
    });

    const ctxAfter = buildContext({
      cwd,
      command,
      output: reRunResult.output,
      exitCode: reRunResult.exitCode,
      signal: reRunResult.signal
    });

    const fAfter = computeFingerprint(ctxAfter);
    roundLog.fingerprintAfter = fAfter;

    // 11. Compare
    let status;
    if (reRunResult.timedOut) {
      status = 'STAYED_UP';
    } else {
      status = compare(fBefore, fAfter);
    }
    roundLog.result = status;

    if (status === 'PASS') {
      console.log(formatResult('PASS'));
      // Run any --also regression commands
      for (const alsoCmd of alsoCommands) {
        console.log(`Running regression check: ${alsoCmd}`);
        const alsoRes = await runCommand([alsoCmd], { cwd });
        if (alsoRes.exitCode !== 0) {
          console.error(`Regression check failed: ${alsoCmd} (exit code ${alsoRes.exitCode})`);
          runLog.finalStatus = 'REGRESSION_FAILED';
          saveRunLog(cwd, runLog);
          return { exitCode: alsoRes.exitCode, finalStatus: 'REGRESSION_FAILED' };
        }
      }
      runLog.rounds.push(roundLog);
      runLog.finalStatus = 'PASS';
      saveRunLog(cwd, runLog);
      return { exitCode: 0, finalStatus: 'PASS' };
    }

    if (status === 'STAYED_UP') {
      console.log(formatResult('STAYED_UP', { timeoutSec: verifyTimeout / 1000 }));
      runLog.rounds.push(roundLog);
      runLog.finalStatus = 'STAYED_UP';
      saveRunLog(cwd, runLog);
      return { exitCode: 0, finalStatus: 'STAYED_UP' };
    }

    if (status === 'SAME_ERROR') {
      console.log(formatResult('SAME_ERROR', { errorCode: fBefore.errorCode }));
      if (backupTimestamp && ctx.interactive) {
        const rev = await prompts({
          type: 'confirm',
          name: 'revert',
          message: 'Revert the changes of this fix?',
          initial: true
        });
        if (rev.revert) {
          restoreBackup(cwd, backupTimestamp);
          console.log('Restored previous files from backup.');
        }
      }
      runLog.rounds.push(roundLog);
      runLog.finalStatus = 'SAME_ERROR';
      saveRunLog(cwd, runLog);
      return { exitCode: reRunResult.exitCode, finalStatus: 'SAME_ERROR' };
    }

    if (status === 'NEW_ERROR') {
      console.log(formatResult('NEW_ERROR', { errorLine: fAfter.errorLine }));
      runLog.rounds.push(roundLog);
      round += 1;
      currentCommandResult = reRunResult;
      // Loop continues to next round with new error
    }
  }

  runLog.finalStatus = 'MAX_ROUNDS_EXCEEDED';
  saveRunLog(cwd, runLog);
  console.log(`Maximum rounds (${maxRounds}) reached.`);
  return { exitCode: currentCommandResult?.exitCode ?? 1, finalStatus: 'MAX_ROUNDS_EXCEEDED' };
}

export default runLoop;
