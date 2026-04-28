import { spawn } from 'node:child_process'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { isatty } from 'node:tty'

import { Command, Option } from 'commander'
import ms from 'ms'
import { z } from 'zod'

import { dispatch } from './dispatch'
import { doctor } from './doctor'
import {
  buildDisplayEntries,
  formatTimestamp,
  manualTimestamp,
  parseTimestampFlag,
  queryGlobalHistory,
  queryHistory,
  recordHistory,
} from './history'
import type { HistoryEntry, RunId } from './history'
import { isAgentRanMeta } from './history/schema'
import {
  configDir,
  historyDir,
  locksDir,
  logFilePath,
  tasksDir,
} from './lib/config'
import { TaskContentionError, readRunningMarker } from './lib/lock'
import { log } from './lib/logger'
import { parseSinceFlag } from './lib/observability-time'
import { listTasks } from './list'
import { getTaskLogs } from './logs'
import { runTask } from './run'
import { setup, teardown } from './setup'
import { getTaskStatuses } from './status'
import { tick } from './tick'
import { validateTasks } from './validate'

function printHistoryEntry(entry: HistoryEntry, taskName?: string): void {
  const header = taskName ? `${taskName}  ${entry.timestamp}` : entry.timestamp
  console.log(header)
  console.log(`  duration  ${entry.duration_ms}ms`)
  if (isAgentRanMeta(entry)) {
    console.log(`  exit_code ${entry.exit_code}`)
    const status = entry.success ? 'ok' : entry.timed_out ? 'timeout' : 'err'
    console.log(`  status    ${status}`)
  } else {
    console.log(`  status    ${entry.status}`)
  }
  if (entry.trigger) {
    console.log(`  trigger   ${entry.trigger}`)
  }
  if (entry.event) {
    console.log(`  event     ${entry.event}`)
  }
  if (entry.output_path) {
    console.log(`  output    ${entry.output_path}`)
  }
}

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
    .addOption(
      new Option('--trigger <value>', 'How this run was triggered').hideHelp(),
    )
    .addOption(
      new Option('--event <value>', 'Event name for dispatch').hideHelp(),
    )
    .addOption(
      new Option(
        '--payload-file <path>',
        'Path to payload file to append to prompt',
      ).hideHelp(),
    )
    .action(
      async (
        name: string,
        opts: {
          json?: boolean
          timestamp?: string
          trigger?: string
          event?: string
          payloadFile?: string
        },
      ) => {
        let timestamp: RunId
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

        const rawTrigger = opts.trigger ?? (opts.timestamp ? 'tick' : 'manual')
        const triggerResult = z
          .enum(['manual', 'tick', 'dispatch'])
          .safeParse(rawTrigger)
        if (!triggerResult.success) {
          console.error(`Invalid --trigger value: ${rawTrigger}`)
          process.exit(1)
        }
        const trigger = triggerResult.data
        log({ event: 'started', task: name, trigger }, logFilePath)

        let payload: string | undefined
        if (opts.payloadFile) {
          try {
            payload = await fsPromises.readFile(opts.payloadFile, 'utf-8')
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e)
            console.error(`Failed to read payload file: ${msg}`)
            process.exit(1)
          }
        }

        const result = await runTask(name, {
          timestamp,
          trigger,
          event: trigger === 'dispatch' ? opts.event : undefined,
          payloadFile: opts.payloadFile,
          lock: trigger === 'tick',
          payload,
        })

        // Clean up payload file once preflight + agent had a chance to read it
        if (opts.payloadFile) {
          await fsPromises.unlink(opts.payloadFile).catch(() => {})
        }

        if (result instanceof Error) {
          if (result instanceof TaskContentionError) {
            log(
              { event: 'skipped', task: name, reason: 'contention' },
              logFilePath,
            )
            if (opts.json) {
              console.log(JSON.stringify({ skipped: true, taskName: name }))
            } else {
              console.error(result.message)
            }
            process.exit(0)
          }
          log({ event: 'error', task: name, error: result }, logFilePath)
          console.error(result.message)
          process.exit(1)
        }

        if (result.kind === 'agent') {
          const exitCode = result.timedOut ? 124 : result.exitCode

          // non-fatal
          const recordErr = await recordHistory(
            {
              timestamp,
              started_at: result.startedAt,
              finished_at: result.finishedAt,
              exit_code: exitCode,
              timed_out: result.timedOut,
              trigger,
              event: trigger === 'dispatch' ? opts.event : undefined,
              ...(result.preflight
                ? {
                    preflight: {
                      exit_code: result.preflight.exit_code,
                      duration_ms: result.preflight.duration_ms,
                      stdout_bytes: Buffer.byteLength(
                        result.preflight.stdout,
                        'utf8',
                      ),
                      stderr_bytes: Buffer.byteLength(
                        result.preflight.stderr,
                        'utf8',
                      ),
                    },
                  }
                : {}),
            },
            {
              task_name: name,
              output: result.output,
              prompt: result.prompt,
              cwd: result.cwd,
              outputPrewritten: true,
            },
          )
          if (recordErr instanceof Error) {
            console.error(recordErr.message)
          }

          if (opts.json) {
            console.log(
              JSON.stringify({
                skipped: false,
                exitCode,
                timedOut: result.timedOut,
                duration_ms:
                  result.finishedAt.getTime() - result.startedAt.getTime(),
              }),
            )
          } else if (result.output) {
            process.stdout.write(result.output)
          }
          process.exit(exitCode)
        }

        // skipped-preflight or preflight-error
        const recordErr = await recordHistory(
          {
            timestamp,
            started_at: result.startedAt,
            finished_at: result.finishedAt,
            status: result.kind,
            trigger,
            event: trigger === 'dispatch' ? opts.event : undefined,
            preflight: {
              exit_code: result.preflight.exit_code,
              duration_ms: result.preflight.duration_ms,
              stdout_bytes: Buffer.byteLength(result.preflight.stdout, 'utf8'),
              stderr_bytes: Buffer.byteLength(result.preflight.stderr, 'utf8'),
              ...(result.preflight.error_reason
                ? { error_reason: result.preflight.error_reason }
                : {}),
            },
          },
          {
            task_name: name,
            output: '',
            prompt: result.prompt,
            cwd: result.cwd,
          },
        )
        if (recordErr instanceof Error) {
          console.error(recordErr.message)
        }
        if (result.kind === 'skipped-preflight') {
          log(
            { event: 'skipped', task: name, reason: 'preflight-skip' },
            logFilePath,
          )
        } else {
          log(
            { event: 'error', task: name, reason: 'preflight-error' },
            logFilePath,
          )
        }
        if (opts.json) {
          console.log(
            JSON.stringify({
              skipped: result.kind === 'skipped-preflight',
              preflight_error: result.kind === 'preflight-error',
              taskName: name,
            }),
          )
        }
        process.exit(0)
      },
    )

  program
    .command('list')
    .description('List all tasks')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const listResult = await listTasks(tasksDir)
      if (listResult instanceof Error) {
        console.error(listResult.message)
        process.exit(1)
      }

      for (const w of listResult.warnings) {
        console.error(`warning: ${w.file}: ${w.error.message}`)
      }

      if (opts.json) {
        console.log(JSON.stringify(listResult.tasks))
      } else {
        for (const task of listResult.tasks) {
          const tag = task.enabled ? 'enabled' : 'disabled'
          const reqs =
            task.requires.length > 0
              ? ` requires:${task.requires.join(',')}`
              : ''
          const executor = task.agent ?? 'custom'
          const trigger =
            'schedule' in task.on ? task.on.schedule : `event:${task.on.event}`
          console.log(`${task.name} ${trigger} ${executor} ${tag}${reqs}`)
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
    .command('history [name]')
    .description(
      'Show run history for a task, or across all tasks if no name given',
    )
    .option('--json', 'Output as JSON')
    .option('--failures', 'Show only failed runs')
    .option('--last <n>', 'Limit to N most recent entries')
    .action(
      async (
        name: string | undefined,
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

        if (name === undefined) {
          const result = await queryGlobalHistory({
            failures: opts.failures,
            last,
          })
          if (result instanceof Error) {
            console.error(result.message)
            process.exit(1)
          }
          if (opts.json) {
            const jsonEntries = result.map(
              ({ output_path: _, ...entry }) => entry,
            )
            console.log(JSON.stringify(jsonEntries))
          } else {
            for (const entry of result) {
              printHistoryEntry(entry, entry.task_name)
            }
          }
          return
        }

        // Check running marker before querying history to adjust --last
        const marker = opts.failures ? null : readRunningMarker(name, locksDir)
        const completedLast =
          last !== undefined && marker ? Math.max(last - 1, 0) : last

        const result = await queryHistory(name, {
          failures: opts.failures,
          last: completedLast,
        })
        if (result instanceof Error) {
          console.error(result.message)
          process.exit(1)
        }

        const display = buildDisplayEntries(result, {
          marker,
          taskName: name,
          configDir,
        })

        if (opts.json) {
          const jsonEntries = display.map(
            ({ output_path: _, ...entry }) => entry,
          )
          console.log(JSON.stringify(jsonEntries))
        } else {
          for (const entry of display) {
            console.log(entry.timestamp)
            if (entry.status === 'running') {
              const elapsed = Date.now() - entry.started_at.getTime()
              console.log(`  status    running (${ms(elapsed)})`)
              console.log(`  output    ${entry.output_path}`)
            } else {
              console.log(`  duration  ${entry.duration_ms}ms`)
              if ('exit_code' in entry) {
                console.log(`  exit_code ${entry.exit_code}`)
              }
              console.log(`  status    ${entry.status}`)
              if (entry.trigger) {
                console.log(`  trigger   ${entry.trigger}`)
              }
              if (entry.event) {
                console.log(`  event     ${entry.event}`)
              }
              if (entry.output_path) {
                console.log(`  output    ${entry.output_path}`)
              }
            }
          }
        }
      },
    )

  program
    .command('logs <name>')
    .description(
      'Show output of a task (live tail if running, last output if completed)',
    )
    .action(async (name: string) => {
      const result = await getTaskLogs(name)
      if (result instanceof Error) {
        console.error(result.message)
        process.exit(1)
      }

      if (result.mode === 'print') {
        process.stdout.write(result.content)
      } else {
        const tail = spawn('tail', ['-f', result.outputPath], {
          stdio: 'inherit',
        })
        const cleanup = () => {
          process.off('SIGINT', cleanup)
          process.off('SIGTERM', cleanup)
          tail.kill()
        }
        process.on('SIGINT', cleanup)
        process.on('SIGTERM', cleanup)
        tail.on('exit', (code, signal) => {
          process.exit(signal ? 130 : (code ?? 0))
        })
      }
    })

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
          const trigger =
            'schedule' in task.on ? task.on.schedule : `event:${task.on.event}`
          console.log(`  trigger   ${trigger}`)
          console.log(`  enabled   ${task.enabled}`)
          if (task.requires.length > 0) {
            console.log(`  requires  ${task.requires.join(', ')}`)
          }
          console.log(`  executor  ${task.agent ?? 'custom'}`)
          if (task.timeout) {
            console.log(`  timeout   ${task.timeout}`)
          }
          if (task.running) {
            console.log(
              `  running   since ${task.running.started_at} (${ms(task.running.duration_ms)})`,
            )
            const outputPath = path.join(
              historyDir,
              task.name,
              `${task.running.timestamp}.output.txt`,
            )
            console.log(`  output    ${outputPath}`)
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
    .option('--dry-run', 'Preview dispatches without executing')
    .action(async (opts: { json?: boolean; dryRun?: boolean }) => {
      const result = await tick({ dryRun: opts.dryRun })
      if (result instanceof Error) {
        console.error(result.message)
        process.exit(1)
      }

      if (opts.json) {
        console.log(JSON.stringify(result))
      } else if (result.dry_run) {
        for (const name of result.dispatched) {
          console.log(`would dispatch ${name}`)
        }
        for (const name of result.skipped) {
          console.log(`skipped        ${name} (already ran)`)
        }
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
    .command('dispatch <event>')
    .description('Dispatch all tasks subscribed to an event')
    .option('--json', 'Output as JSON')
    .action(async (eventName: string, opts: { json?: boolean }) => {
      let payload: string | undefined
      if (!isatty(0)) {
        payload = await Bun.stdin.text()
        if (payload.length === 0) {
          payload = undefined
        }
      }

      const result = await dispatch(eventName, { payload })
      if (result instanceof Error) {
        console.error(result.message)
        process.exit(1)
      }

      if (opts.json) {
        console.log(JSON.stringify(result))
      } else {
        if (result.dispatched.length === 0 && result.skipped.length === 0) {
          console.log(`no tasks subscribe to event '${eventName}'`)
        } else {
          for (const name of result.dispatched) {
            console.log(`dispatched ${name}`)
          }
          for (const entry of result.skipped) {
            console.log(`skipped    ${entry.name} (${entry.reason})`)
          }
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
        const parsed = parseSinceFlag(opts.since)
        if (parsed instanceof Error) {
          console.error(parsed.message)
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

process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  console.error(`tm: unhandled rejection: ${message}`)
  process.exit(1)
})

await main()
