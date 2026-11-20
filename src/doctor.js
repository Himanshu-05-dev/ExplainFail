import chalk from 'chalk';
import prompts from 'prompts';
import { DETECTORS } from './detectors/index.js';
import { buildContext } from './context.js';
import { formatFixPrompt } from './reporter.js';
import { createBackup } from './backup.js';
import { execa } from 'execa';

/**
 * Runs preflight checks for all detectors.
 * @param {Object} [options={}]
 * @returns {Promise<number>} exit code: 0 if no problems, 1 if problems found
 */
export async function runDoctor(options = {}) {
  const cwd = options.cwd || process.cwd();
  const ctx = buildContext({ cwd });
  const isFix = Boolean(options.fix);
  const isAutoYes = Boolean(options.yes);

  console.log(chalk.bold('explainfail doctor — Environment and Dependency Check\n'));

  const problems = [];
  const results = [];

  for (const detector of DETECTORS) {
    if (!detector.preflight) {
      results.push({ id: detector.id, title: detector.title, status: 'skipped' });
      continue;
    }

    try {
      const findings = await detector.preflight(ctx);
      if (findings && findings.length > 0) {
        results.push({ id: detector.id, title: detector.title, status: 'problem', findings });
        for (const f of findings) {
          problems.push(f);
        }
      } else {
        results.push({ id: detector.id, title: detector.title, status: 'ok' });
      }
    } catch {
      results.push({ id: detector.id, title: detector.title, status: 'skipped' });
    }
  }

  for (const r of results) {
    if (r.status === 'ok') {
      console.log(`${chalk.green('✔')} ${r.title}`);
    } else if (r.status === 'problem') {
      console.log(`${chalk.red('✖')} ${r.title}`);
      for (const finding of r.findings) {
        if (finding.evidence) {
          for (const ev of finding.evidence) {
            console.log(`    ${chalk.dim(ev.label)}: ${ev.value}`);
          }
        }
      }
    } else {
      console.log(`${chalk.dim('–')} ${r.title} ${chalk.dim('(skipped)')}`);
    }
  }

  if (problems.length === 0) {
    console.log(chalk.green('\nNo problems found. Project environment is clean.'));
    return 0;
  }

  console.log(chalk.red(`\nFound ${problems.length} problem(s).`));

  if (isFix) {
    for (const problem of problems) {
      if (!problem.fixes || problem.fixes.length === 0) continue;
      const fix = problem.fixes[0];
      if (fix.type === 'manual') {
        console.log(`\nManual fix required: ${fix.manualText}`);
        continue;
      }

      let approved = false;
      if (isAutoYes && fix.risk === 'low') {
        approved = true;
      } else if (ctx.interactive) {
        console.log('\n' + formatFixPrompt(fix));
        const res = await prompts({
          type: 'confirm',
          name: 'apply',
          message: 'Apply this fix?',
          initial: false
        });
        approved = Boolean(res.apply);
      }

      if (approved) {
        const filesToBackup = fix.files ? fix.files.map((f) => f.path) : [];
        createBackup(cwd, filesToBackup);
        if (fix.type === 'command' && fix.argv) {
          await execa(fix.argv[0], fix.argv.slice(1), { cwd, stdio: 'inherit' });
        } else if (fix.type === 'file' && typeof fix.apply === 'function') {
          await fix.apply(ctx);
        }
        console.log(chalk.green(`Applied fix: ${fix.label}`));
      }
    }
  }

  return 1;
}

export default runDoctor;
