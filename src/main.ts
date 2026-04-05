import { Command, Option } from 'commander'

import {
  formatTimestamp,
  manualTimestamp,
  parseTimestampFlag,
  recordHistory,
} from './history'
import { runTask } from './run'

async function main(): Promise<void> {
  const program = new Command()
  program.name('tm').version('0.0.1').description('Taskmaster')

  program
    .command('run <name>')
    .description('Execute a task immediately')
    .addOption(
      new Option(
        '--timestamp <value>',
        'UTC timestamp for this run',
      ).hideHelp(),
    )
    .action(async (name: string, opts: { timestamp?: string }) => {
      // Resolve timestamp
      let timestamp: string
      if (opts.timestamp) {
        const parsed = parseTimestampFlag(opts.timestamp)
        if (parsed instanceof Error) {
          console.error(parsed.message)
          process.exit(1)
        }
        timestamp = formatTimestamp(parsed)
      } else {
        timestamp = manualTimestamp()
      }

      const result = await runTask(name)
      if (result instanceof Error) {
        console.error(result.message)
        process.exit(1)
      }

      // Record history (non-fatal)
      const recordErr = await recordHistory({
        taskName: name,
        timestamp,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        prompt: result.prompt,
        cwd: result.cwd,
      })
      if (recordErr instanceof Error) {
        console.error(recordErr.message)
      }

      if (result.stdout) {
        process.stdout.write(result.stdout)
      }
      if (result.stderr) {
        process.stderr.write(result.stderr)
      }
      process.exit(result.exitCode)
    })

  await program.parseAsync()
}

await main()
