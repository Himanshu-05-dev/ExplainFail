import { Command } from 'commander';
import { runCommand, parseUserCommand } from './runner.js';

const program = new Command();

program
  .name('explainfail')
  .description('Evidence-based error doctor for Node projects')
  .version('0.1.0')
  .allowUnknownOption(true)
  .passThroughOptions(true)
  .option('--no-fix', 'Diagnose only, never prompt')
  .option('--yes', 'Auto-approve fixes with risk low')
  .option('--dry-run', 'Show what fix would do without applying')
  .option('--max-rounds <n>', 'Maximum fix/verify rounds', '5')
  .option('--verify-timeout <sec>', 'Seconds to wait before declaring stayed up', '60')
  .option('--also <command>', 'Extra command to run on verify pass', (val, prev) => (prev ? [...prev, val] : [val]), [])
  .argument('[command...]', 'Command to run and diagnose')
  .action(async (commandArgs, options) => {
    if (!commandArgs || commandArgs.length === 0) {
      program.help();
      return;
    }
    try {
      const spec = parseUserCommand(commandArgs);
      const result = await runCommand(spec);
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
