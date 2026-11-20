import { Command } from 'commander';
import { parseUserCommand } from './runner.js';
import { runLoop } from './loop.js';
import { runDoctor } from './doctor.js';
import { runVerify } from './verify.js';
import { runReport } from './report.js';

const program = new Command();

program
  .name('explainfail')
  .description('Evidence-based error doctor for Node projects')
  .version('0.1.0')
  .allowUnknownOption(true)
  .passThroughOptions(true);

program
  .command('doctor')
  .description('Proactively checks environment, engines, and dependencies')
  .option('--fix', 'Interactively apply suggested fixes')
  .option('--yes', 'Auto-approve fixes with risk low')
  .action(async (options) => {
    try {
      const code = await runDoctor(options);
      process.exit(code);
    } catch (err) {
      console.error('explainfail doctor error:', err.message);
      process.exit(70);
    }
  });

program
  .command('verify <command>')
  .description('Runs command once and reports verified facts against baseline')
  .option('--baseline <file>', 'Path to baseline fingerprint JSON')
  .option('--timeout <sec>', 'Seconds to wait before declaring stayed up', '60')
  .option('--also <command>', 'Extra command to run on verify pass', (val, prev) => (prev ? [...prev, val] : [val]), [])
  .option('--json', 'Output machine-readable JSON')
  .action(async (command, options) => {
    try {
      const spec = parseUserCommand([command]);
      const { exitCode } = await runVerify(spec, options);
      process.exit(exitCode);
    } catch (err) {
      console.error('explainfail verify error:', err.message);
      process.exit(70);
    }
  });

program
  .command('report')
  .description('Reads latest failure run log')
  .option('--for-ai', 'Output clean markdown report for AI coding assistants')
  .option('--json', 'Output report as JSON')
  .action((options) => {
    try {
      const code = runReport(options);
      process.exit(code);
    } catch (err) {
      console.error('explainfail report error:', err.message);
      process.exit(70);
    }
  });

// Default run mode: explainfail <command...>
program
  .argument('[command...]', 'Command to run and diagnose')
  .option('--no-fix', 'Diagnose only, never prompt')
  .option('--yes', 'Auto-approve fixes with risk low')
  .option('--dry-run', 'Show what fix would do without applying')
  .option('--max-rounds <n>', 'Maximum fix/verify rounds', '5')
  .option('--verify-timeout <sec>', 'Seconds to wait before declaring stayed up', '60')
  .option('--also <command>', 'Extra command to run on verify pass', (val, prev) => (prev ? [...prev, val] : [val]), [])
  .action(async (commandArgs, options) => {
    if (!commandArgs || commandArgs.length === 0) {
      program.help();
      return;
    }
    try {
      const spec = parseUserCommand(commandArgs);
      const loopOptions = {
        noFix: options.fix === false,
        yes: Boolean(options.yes),
        dryRun: Boolean(options.dryRun),
        maxRounds: options.maxRounds,
        verifyTimeout: options.verifyTimeout,
        also: options.also
      };
      const result = await runLoop(spec, loopOptions);
      process.exit(result.exitCode ?? 0);
    } catch (err) {
      console.error('explainfail error:', err.message);
      process.exit(70);
    }
  });

export default program;

if (process.argv[1] && (process.argv[1].endsWith('explainfail.js') || process.argv[1].endsWith('explainfail'))) {
  program.parse(process.argv);
}
