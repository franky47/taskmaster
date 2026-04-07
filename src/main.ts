import { Command, Option } from 'commander'
import { z } from 'zod'

import { tasksDir } from './config'
import { doctor } from './doctor'
import {
  formatTimestamp,
  manualTimestamp,
  parseTimestampFlag,
  queryHistory,
  recordHistory,
} from './history'
import { listTasks } from './list'
import { TaskContentionError } from './lock'
import { log } from './logger'
import { runTask } from './run'
import { setup, teardown } from './setup'
import { getTaskStatuses } from './status'
import { tick } from './tick'
import { validateTasks } from './validate'

async function main(): Promise<void> {
  const program = new Command()
  program.name('tm').version('0.0.1').description('Taskmaster')

  program
    .command('run <name>')
    .description('Execute a task immediately')
    .option('--json', 'Output as JSON')
    .addOption(
      new Option(
        '--timestamp <value>',
        'UTC timestamp for this run',
      ).hideHelp(),
    )
    .action(
      async (name: string, opts: { json?: boolean; timestamp?: string }) => {
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

        const trigger = opts.timestamp ? 'tick' : ('manual' as const)
        log({ event: 'started', task: name, trigger })

        const result = await runTask(name)

        if (result instanceof Error) {
          // S5.2: Lock contention — skip gracefully
          if (result instanceof TaskContentionError) {
            log({ event: 'skipped', task: name, reason: 'contention' })
            if (opts.json) {
              console.log(JSON.stringify({ skipped: true, taskName: name }))
            } else {
              console.error(result.message)
            }
            process.exit(0)
          }
          log({ event: 'error', task: name, error: result })
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

        if (opts.json) {
          console.log(
            JSON.stringify({
              skipped: false,
              exitCode: result.exitCode,
              duration_ms:
                result.finishedAt.getTime() - result.startedAt.getTime(),
            }),
          )
        } else {
          if (result.stdout) {
            process.stdout.write(result.stdout)
          }
          if (result.stderr) {
            process.stderr.write(result.stderr)
          }
        }
        process.exit(result.exitCode)
      },
    )

  program
    .command('list')
    .description('List all tasks')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const tasks = await listTasks(tasksDir)
      if (tasks instanceof Error) {
        console.error(tasks.message)
        process.exit(1)
      }

      if (opts.json) {
        console.log(JSON.stringify(tasks))
      } else {
        for (const task of tasks) {
          console.log(
            `${task.name} ${task.schedule} ${task.enabled ? 'enabled' : 'disabled'}`,
          )
        }
      }
    })

  program
    .command('validate')
    .description('Validate all task files')
    .option('--json', 'Output results as JSON')
    .action(async (opts: { json?: boolean }) => {
      const results = await validateTasks(tasksDir)
      if (results instanceof Error) {
        console.error(results.message)
        process.exit(1)
      }

      if (opts.json) {
        console.log(JSON.stringify(results))
      } else {
        for (const result of results) {
          if (result.valid) {
            console.log(`ok  ${result.name}`)
          } else {
            console.error(`err ${result.name}`)
            for (const error of result.errors) {
              console.error(`    ${error}`)
            }
          }
        }
      }

      const hasErrors = results.some((r) => !r.valid)
      process.exit(hasErrors ? 1 : 0)
    })

  program
    .command('history <name>')
    .description('Show run history for a task')
    .option('--json', 'Output as JSON')
    .option('--failures', 'Show only failed runs')
    .option('--last <n>', 'Limit to N most recent entries')
    .action(
      async (
        name: string,
        opts: { json?: boolean; failures?: boolean; last?: string },
      ) => {
        let last: number | undefined
        if (opts.last !== undefined) {
          const parsed = z.coerce.number().int().positive().safeParse(opts.last)
          if (!parsed.success) {
            console.error('--last must be a positive integer')
            process.exit(1)
          }
          last = parsed.data
        }

        const result = await queryHistory(name, {
          failures: opts.failures,
          last,
        })
        if (result instanceof Error) {
          console.error(result.message)
          process.exit(1)
        }

        if (opts.json) {
          const jsonEntries = result.map(({ stderrPath: _, ...entry }) => entry)
          console.log(JSON.stringify(jsonEntries))
        } else {
          for (const entry of result) {
            console.log(entry.timestamp)
            console.log(`  duration  ${entry.duration_ms}ms`)
            console.log(`  exit_code ${entry.exit_code}`)
            console.log(`  status    ${entry.success ? 'ok' : 'err'}`)
            if (entry.stderrPath) {
              console.log(`  stderr    ${entry.stderrPath}`)
            }
          }
        }
      },
    )

  program
    .command('status')
    .description('Show status of all tasks')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const statuses = await getTaskStatuses()
      if (statuses instanceof Error) {
        console.error(statuses.message)
        process.exit(1)
      }

      if (opts.json) {
        console.log(JSON.stringify(statuses))
      } else {
        for (const task of statuses) {
          console.log(task.name)
          console.log(`  schedule  ${task.schedule}`)
          console.log(`  enabled   ${task.enabled}`)
          if (task.timeout) {
            console.log(`  timeout   ${task.timeout}`)
          }
          if (task.last_run) {
            console.log(
              `  last_run  ${task.last_run.timestamp} ${task.last_run.status} ${task.last_run.duration_ms}ms`,
            )
          }
          if (task.next_run) {
            console.log(`  next      ${task.next_run}`)
          }
        }
      }
    })

  program
    .command('tick')
    .description('Scheduler heartbeat: dispatch due tasks')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const result = await tick()
      if (result instanceof Error) {
        console.error(result.message)
        process.exit(1)
      }

      if (opts.json) {
        console.log(JSON.stringify(result))
      } else {
        for (const name of result.dispatched) {
          console.log(`dispatched ${name}`)
        }
        for (const name of result.skipped) {
          console.log(`skipped    ${name} (already ran)`)
        }
        if (result.purged > 0) {
          console.log(`purged     ${result.purged} old entries`)
        }
      }
    })

  program
    .command('setup')
    .description('Install system scheduler for tm tick')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const result = await setup()
      if (result instanceof Error) {
        console.error(result.message)
        process.exit(1)
      }

      if (opts.json) {
        console.log(JSON.stringify(result))
      } else {
        if (result.installed) {
          console.log(`Installed ${result.method} scheduler`)
        } else {
          console.log(`Scheduler already installed (${result.method})`)
        }
      }
    })

  program
    .command('teardown')
    .description('Remove system scheduler for tm tick')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const result = await teardown()
      if (result instanceof Error) {
        console.error(result.message)
        process.exit(1)
      }

      if (opts.json) {
        console.log(JSON.stringify(result))
      } else {
        if (result.removed) {
          console.log(`Removed ${result.method} scheduler`)
        } else {
          console.log(`No scheduler to remove (${result.method})`)
        }
      }
    })

  program
    .command('doctor')
    .description('Run diagnostic checks')
    .option(
      '--since <iso8601>',
      'Check from this timestamp (default: 7 days ago)',
    )
    .action(async (opts: { since?: string }) => {
      let since: Date | undefined
      if (opts.since) {
        const parsed = new Date(opts.since)
        if (isNaN(parsed.getTime())) {
          console.error('Invalid --since timestamp')
          process.exit(1)
        }
        since = parsed
      }

      const result = await doctor({ since })
      if (result.ok) {
        console.log(result.message)
        process.exit(0)
      } else {
        console.log(result.report)
        process.exit(1)
      }
    })

  await program.parseAsync()
}

await main()
