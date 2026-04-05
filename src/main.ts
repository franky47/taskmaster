import { Command } from 'commander'

import { runTask } from './run'

async function main(): Promise<void> {
  const program = new Command()
  program.name('tm').version('0.0.1').description('Taskmaster')

  program
    .command('run <name>')
    .description('Execute a task immediately')
    .action(async (name: string) => {
      const result = await runTask(name)
      if (result instanceof Error) {
        console.error(result.message)
        process.exit(1)
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
