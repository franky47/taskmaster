import { describe, expect, test, vi } from 'bun:test'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { AgentNotFoundError } from '#lib/agent'
import { TaskContentionError } from '#lib/lock'
import {
  FrontmatterValidationError,
  TaskFileNameError,
  TaskNotFoundError,
} from '#lib/task'
import { runIdSchema } from '#src/history'

import { CwdNotFoundError } from './cwd'
import type { ExecuteDeps, SpawnAgentDeps } from './run'
import { KILL_GRACE_MS, defaultSpawnAgent, executeTask, runTask } from './run'

// Mock child process for defaultSpawnAgent tests

type MockChild = EventEmitter & {
  pid: number
  exitCode: number | null
  stdout: PassThrough
  stderr: PassThrough
  simulateExit: (code: number) => void
  simulateOutput: (stream: 'stdout' | 'stderr', data: string) => void
}

function createMockChild(pid = 12345): MockChild {
  const emitter = new EventEmitter()
  const stdout = new PassThrough()
  const stderr = new PassThrough()

  const child = Object.assign(emitter, {
    pid,
    exitCode: null as number | null,
    stdout,
    stderr,
    simulateOutput(stream: 'stdout' | 'stderr', data: string) {
      child[stream].write(data)
    },
    simulateExit(code: number) {
      child.exitCode = code
      stdout.end()
      stderr.end()
      child.emit('close', code)
    },
  })

  return child
}

function createMockSpawn(child: MockChild): SpawnAgentDeps['spawn'] {
  return () => child
}

type SpawnResult = {
  exitCode: number
  output: string
  timedOut: boolean
}

function fakeSpawn(
  result: Partial<SpawnResult> = {},
): ExecuteDeps['spawnAgent'] {
  return async () => ({
    exitCode: 0,
    output: '',
    timedOut: false,
    ...result,
  })
}

async function makeConfigDir(): Promise<string> {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tm-run-'))
  await fsPromises.mkdir(path.join(dir, 'tasks'), { recursive: true })
  return dir
}

async function writeTask(
  configDir: string,
  name: string,
  content: string,
): Promise<void> {
  await fsPromises.writeFile(
    path.join(configDir, 'tasks', `${name}.md`),
    content,
  )
}

const agentTask = [
  '---',
  'on:',
  '  schedule: "0 8 * * 1-5"',
  'agent: opencode',
  'args: "--model opus"',
  'env:',
  '  PROJECT: myproject',
  '---',
  'Do the thing.',
].join('\n')

const claudeTaskWithArgs = [
  '---',
  'on:',
  '  schedule: "0 8 * * 1-5"',
  'agent: claude',
  'args: "--model sonnet"',
  '---',
  'Review PRs.',
].join('\n')

const runTask_ = [
  '---',
  'on:',
  '  schedule: "0 8 * * 1-5"',
  'run: "my-agent $TM_PROMPT_FILE"',
  '---',
  'Do the thing.',
].join('\n')

const unknownAgentTask = [
  '---',
  'on:',
  '  schedule: "0 8 * * 1-5"',
  'agent: nonexistent',
  '---',
  'Do the thing.',
].join('\n')

describe('executeTask', () => {
  test('returns TaskNotFoundError for non-existent task', async () => {
    const configDir = await makeConfigDir()
    const result = await executeTask('no-such-task', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })
    expect(result).toBeInstanceOf(TaskNotFoundError)
  })

  test('returns TaskFileNameError for invalid task name', async () => {
    const configDir = await makeConfigDir()
    const result = await executeTask('INVALID_NAME', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })
    expect(result).toBeInstanceOf(TaskFileNameError)
  })

  test('returns FrontmatterValidationError for invalid frontmatter', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'bad-task',
      '---\non:\n  schedule: "not cron"\n---\nHi',
    )
    const result = await executeTask('bad-task', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })
    expect(result).toBeInstanceOf(FrontmatterValidationError)
  })

  // AC1: agent: claude + args → correct sh -c command
  test('builds correct command for agent task with args', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'claude-task', claudeTaskWithArgs)

    let receivedCommand = ''
    await executeTask('claude-task', {
      configDir,
      deps: {
        spawnAgent: async (opts) => {
          receivedCommand = opts.command
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    expect(receivedCommand).toBe('claude -p < $TM_PROMPT_FILE --model sonnet')
  })

  // AC2: run: path → correct sh -c command (no args appended)
  test('builds correct command for run task', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'run-task', runTask_)

    let receivedCommand = ''
    await executeTask('run-task', {
      configDir,
      deps: {
        spawnAgent: async (opts) => {
          receivedCommand = opts.command
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    expect(receivedCommand).toBe('my-agent $TM_PROMPT_FILE')
  })

  // AC3: TM_PROMPT_FILE is set in spawned process env
  test('sets TM_PROMPT_FILE in spawned env', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'env-task', agentTask)

    let receivedEnv: Record<string, string> = {}
    await executeTask('env-task', {
      configDir,
      deps: {
        spawnAgent: async (opts) => {
          receivedEnv = opts.env
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    expect(receivedEnv['TM_PROMPT_FILE']).toMatch(/^\/tmp\/tm-.*\.prompt\.md$/)
  })

  // AC4: Prompt file written before spawn, cleaned up after
  test('prompt file exists during spawn and is cleaned up after', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'prompt-lifecycle', agentTask)

    let promptPath = ''
    let existedDuringSpawn = false
    const result = await executeTask('prompt-lifecycle', {
      configDir,
      deps: {
        spawnAgent: async (opts) => {
          promptPath = opts.env['TM_PROMPT_FILE'] ?? ''
          existedDuringSpawn = fs.existsSync(promptPath)
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    if (result instanceof Error) throw result
    expect(existedDuringSpawn).toBe(true)
    expect(fs.existsSync(promptPath)).toBe(false)
  })

  // AC5: Prompt file cleaned up on agent failure (non-zero exit)
  test('prompt file cleaned up even on non-zero exit', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'fail-cleanup', agentTask)

    let promptPath = ''
    const result = await executeTask('fail-cleanup', {
      configDir,
      deps: {
        spawnAgent: async (opts) => {
          promptPath = opts.env['TM_PROMPT_FILE'] ?? ''
          return { exitCode: 1, output: 'boom', timedOut: false }
        },
      },
    })

    if (result instanceof Error) throw result
    if (result.kind !== 'agent') throw new Error('expected agent result')
    expect(result.exitCode).toBe(1)
    expect(fs.existsSync(promptPath)).toBe(false)
  })

  // AC6: Agent registry errors propagate
  test('returns AgentNotFoundError for unknown agent', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'unknown-agent', unknownAgentTask)

    const result = await executeTask('unknown-agent', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })

    expect(result).toBeInstanceOf(AgentNotFoundError)
  })

  test('passes per-task env merged with global env', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', agentTask)
    await fsPromises.writeFile(
      path.join(configDir, '.env'),
      'GLOBAL_KEY=global_val\nPROJECT=overridden\n',
    )

    let receivedEnv: Record<string, string> = {}
    await executeTask('my-task', {
      configDir,
      deps: {
        spawnAgent: async (opts) => {
          receivedEnv = opts.env
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    expect(receivedEnv['GLOBAL_KEY']).toBe('global_val')
    expect(receivedEnv['PROJECT']).toBe('myproject')
  })

  test('resolves cwd from frontmatter', async () => {
    const cwdDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tm-cwd-'))
    const configDir = await makeConfigDir()
    const task = [
      '---',
      'on:',
      '  schedule: "0 8 * * 1-5"',
      'agent: opencode',
      `cwd: "${cwdDir}"`,
      '---',
      'Prompt.',
    ].join('\n')
    await writeTask(configDir, 'cwd-task', task)

    let receivedCwd = ''
    await executeTask('cwd-task', {
      configDir,
      deps: {
        spawnAgent: async (opts) => {
          receivedCwd = opts.cwd
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    expect(receivedCwd).toBe(cwdDir)
  })

  test('creates temp dir when cwd omitted', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'no-cwd',
      '---\non:\n  schedule: "0 8 * * *"\nagent: opencode\n---\nHi',
    )

    let receivedCwd = ''
    await executeTask('no-cwd', {
      configDir,
      deps: {
        spawnAgent: async (opts) => {
          receivedCwd = opts.cwd
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    expect(receivedCwd).toContain('taskmaster-')
    const stat = await fsPromises.stat(receivedCwd)
    expect(stat.isDirectory()).toBe(true)
  })

  test('returns CwdNotFoundError when cwd does not exist', async () => {
    const configDir = await makeConfigDir()
    const task = [
      '---',
      'on:',
      '  schedule: "0 8 * * 1-5"',
      'agent: opencode',
      'cwd: "/nonexistent/dir/xyz"',
      '---',
      'Prompt.',
    ].join('\n')
    await writeTask(configDir, 'bad-cwd', task)

    const result = await executeTask('bad-cwd', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })
    expect(result).toBeInstanceOf(CwdNotFoundError)
  })

  test('ignores enabled: false (S3.9)', async () => {
    const configDir = await makeConfigDir()
    const task = [
      '---',
      'on:',
      '  schedule: "0 8 * * 1-5"',
      'agent: opencode',
      'enabled: false',
      '---',
      'Disabled prompt.',
    ].join('\n')
    await writeTask(configDir, 'disabled', task)

    let ran = false
    await executeTask('disabled', {
      configDir,
      deps: {
        spawnAgent: async () => {
          ran = true
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    expect(ran).toBe(true)
  })

  test('propagates exit code from agent (S3.10)', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'fail-task',
      '---\non:\n  schedule: "0 * * * *"\nagent: opencode\n---\nFail',
    )

    const result = await executeTask('fail-task', {
      configDir,
      deps: { spawnAgent: fakeSpawn({ exitCode: 42 }) },
    })

    if (result instanceof Error) throw result
    if (result.kind !== 'agent') throw new Error('expected agent result')
    expect(result.exitCode).toBe(42)
  })

  test('captures output', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'output',
      '---\non:\n  schedule: "0 * * * *"\nagent: opencode\n---\nGo',
    )

    const result = await executeTask('output', {
      configDir,
      deps: {
        spawnAgent: fakeSpawn({
          output: 'hello out\nhello err',
        }),
      },
    })

    if (result instanceof Error) throw result
    if (result.kind !== 'agent') throw new Error('expected agent result')
    expect(result.output).toBe('hello out\nhello err')
  })

  test('includes startedAt and finishedAt timestamps', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'timing',
      '---\non:\n  schedule: "0 * * * *"\nagent: opencode\n---\nGo',
    )

    const before = new Date()
    const result = await executeTask('timing', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })
    const after = new Date()

    if (result instanceof Error) throw result
    expect(result.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(result.finishedAt.getTime()).toBeLessThanOrEqual(after.getTime())
    expect(result.finishedAt.getTime()).toBeGreaterThanOrEqual(
      result.startedAt.getTime(),
    )
  })

  test('includes cwd with is_temp when cwd omitted', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'temp-cwd',
      '---\non:\n  schedule: "0 * * * *"\nagent: opencode\n---\nGo',
    )

    const result = await executeTask('temp-cwd', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })

    if (result instanceof Error) throw result
    expect(result.cwd.is_temp).toBe(true)
    expect(result.cwd.path).toContain('taskmaster-')
  })

  test('includes cwd with is_temp=false when cwd specified', async () => {
    const cwdDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tm-cwd-'))
    const configDir = await makeConfigDir()
    const task = `---\non:\n  schedule: "0 * * * *"\nagent: opencode\ncwd: "${cwdDir}"\n---\nGo`
    await writeTask(configDir, 'explicit-cwd', task)

    const result = await executeTask('explicit-cwd', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })

    if (result instanceof Error) throw result
    expect(result.cwd.is_temp).toBe(false)
    expect(result.cwd.path).toBe(cwdDir)
  })

  test('includes prompt body in result', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'prompt-check',
      '---\non:\n  schedule: "0 * * * *"\nagent: opencode\n---\nDo the thing.',
    )

    const result = await executeTask('prompt-check', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })

    if (result instanceof Error) throw result
    expect(result.prompt).toBe('Do the thing.')
  })

  test('passes timeout from frontmatter to spawnAgent', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'timeout-task',
      '---\non:\n  schedule: "0 * * * *"\nagent: opencode\ntimeout: "30s"\n---\nGo',
    )

    let receivedTimeoutMs: number | undefined
    await executeTask('timeout-task', {
      configDir,
      deps: {
        spawnAgent: async (opts) => {
          receivedTimeoutMs = opts.timeoutMs
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    expect(receivedTimeoutMs).toBe(30_000)
  })

  test('uses default timeout when frontmatter omits it', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'no-timeout',
      '---\non:\n  schedule: "0 * * * *"\nagent: opencode\n---\nGo',
    )

    let receivedTimeoutMs: number | undefined
    await executeTask('no-timeout', {
      configDir,
      deps: {
        spawnAgent: async (opts) => {
          receivedTimeoutMs = opts.timeoutMs
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    // Hourly schedule → default timeout = min(1h - 10s, 1h) = 3_590_000
    expect(receivedTimeoutMs).toBe(3_590_000)
  })

  test('threads timedOut from spawnAgent into RunResult', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'timed-out',
      '---\non:\n  schedule: "0 * * * *"\nagent: opencode\ntimeout: "5s"\n---\nGo',
    )

    const result = await executeTask('timed-out', {
      configDir,
      deps: { spawnAgent: fakeSpawn({ timedOut: true, exitCode: 1 }) },
    })

    if (result instanceof Error) throw result
    if (result.kind !== 'agent') throw new Error('expected agent result')
    expect(result.timedOut).toBe(true)
  })

  test('passes outputPath to spawnAgent when timestamp provided', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'fd-test',
      '---\non:\n  schedule: "0 * * * *"\nagent: opencode\n---\nGo',
    )

    let receivedOutputPath: string | undefined
    await executeTask('fd-test', {
      configDir,
      timestamp: runIdSchema.parse('2026-04-09T10.00.00Z'),
      deps: {
        spawnAgent: async (opts) => {
          receivedOutputPath = opts.outputPath
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    expect(receivedOutputPath).toBe(
      path.join(
        configDir,
        'history',
        'fd-test',
        '2026-04-09T10.00.00Z.output.txt',
      ),
    )
  })

  test('creates history directory before spawning when timestamp provided', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'dir-create',
      '---\non:\n  schedule: "0 * * * *"\nagent: opencode\n---\nGo',
    )

    let histDirExisted = false
    await executeTask('dir-create', {
      configDir,
      timestamp: runIdSchema.parse('2026-04-09T10.00.00Z'),
      deps: {
        spawnAgent: async () => {
          const histDir = path.join(configDir, 'history', 'dir-create')
          histDirExisted = fs.existsSync(histDir)
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    expect(histDirExisted).toBe(true)
  })

  test('does not pass outputPath when timestamp not provided', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'no-ts',
      '---\non:\n  schedule: "0 * * * *"\nagent: opencode\n---\nGo',
    )

    let receivedOutputPath: string | undefined
    await executeTask('no-ts', {
      configDir,
      deps: {
        spawnAgent: async (opts) => {
          receivedOutputPath = opts.outputPath
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    expect(receivedOutputPath).toBeUndefined()
  })

  test('does not append payload to prompt when body has no <PAYLOAD/> token', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'no-payload-token',
      '---\non:\n  event: deploy\nagent: opencode\n---\nBase prompt.',
    )

    let promptContent = ''
    const result = await executeTask('no-payload-token', {
      configDir,
      payload: Buffer.from('deploy context here'),
      deps: {
        spawnAgent: async (opts) => {
          promptContent = fs.readFileSync(opts.env['TM_PROMPT_FILE']!, 'utf-8')
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    if (result instanceof Error) throw result
    expect(promptContent).toBe('Base prompt.')
    expect(promptContent).not.toContain('---')
    expect(result.prompt).toBe('Base prompt.')
  })

  test('does not write a separator when payload is absent', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'no-payload',
      '---\non:\n  event: deploy\nagent: opencode\n---\nBase prompt.',
    )

    let promptContent = ''
    const result = await executeTask('no-payload', {
      configDir,
      deps: {
        spawnAgent: async (opts) => {
          promptContent = fs.readFileSync(opts.env['TM_PROMPT_FILE']!, 'utf-8')
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    if (result instanceof Error) throw result
    expect(promptContent).toBe('Base prompt.')
    expect(result.prompt).toBe('Base prompt.')
  })

  describe('<PAYLOAD/> substitution', () => {
    const payloadTask = [
      '---',
      'on:',
      '  event: deploy',
      'agent: opencode',
      '---',
      'Header.',
      '<PAYLOAD/>',
      'Footer.',
    ].join('\n')

    test('substitutes <PAYLOAD/> with provided payload bytes', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pay-sub', payloadTask)

      const result = await executeTask('pay-sub', {
        configDir,
        payload: Buffer.from('PAYLOAD-VALUE'),
        deps: { spawnAgent: fakeSpawn() },
      })

      if (result instanceof Error) throw result
      if (result.kind !== 'agent') throw new Error('expected agent result')
      expect(result.prompt).toBe('Header.\nPAYLOAD-VALUE\nFooter.')
    })

    test('trims payload before substitution', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pay-trim', payloadTask)

      const result = await executeTask('pay-trim', {
        configDir,
        payload: Buffer.from('\n\n  hi\nyou  \n\n'),
        deps: { spawnAgent: fakeSpawn() },
      })

      if (result instanceof Error) throw result
      if (result.kind !== 'agent') throw new Error('expected agent result')
      expect(result.prompt).toBe('Header.\nhi\nyou\nFooter.')
    })

    test('substitutes <PAYLOAD/> to empty when no payload provided', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pay-empty', payloadTask)

      const result = await executeTask('pay-empty', {
        configDir,
        deps: { spawnAgent: fakeSpawn() },
      })

      if (result instanceof Error) throw result
      if (result.kind !== 'agent') throw new Error('expected agent result')
      expect(result.prompt).toBe('Header.\n\nFooter.')
    })

    test('payload value containing <PREFLIGHT/> is not re-substituted', async () => {
      const configDir = await makeConfigDir()
      const dualToken = [
        '---',
        'on:',
        '  event: deploy',
        'agent: opencode',
        "preflight: 'echo'",
        '---',
        'pre=<PREFLIGHT/> pay=<PAYLOAD/>',
      ].join('\n')
      await writeTask(configDir, 'pay-cross', dualToken)

      const result = await executeTask('pay-cross', {
        configDir,
        payload: Buffer.from('<PREFLIGHT/>'),
        deps: {
          spawnPreflight: async () => ({
            exit_code: 0,
            duration_ms: 5,
            stdout: 'real-pf',
            stderr: '',
            timed_out: false,
            signaled: false,
            stdout_bytes: 7,
            stderr_bytes: 0,
          }),
          spawnAgent: fakeSpawn(),
        },
      })

      if (result instanceof Error) throw result
      if (result.kind !== 'agent') throw new Error('expected agent result')
      expect(result.prompt).toBe('pre=real-pf pay=<PREFLIGHT/>')
    })

    test('writes <ts>.prompt.txt when PAYLOAD substitution produced non-empty content', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pay-prompt-file', payloadTask)
      const ts = runIdSchema.parse('2026-04-08T08.30.00Z')

      await executeTask('pay-prompt-file', {
        configDir,
        timestamp: ts,
        payload: Buffer.from('SOMETHING'),
        deps: { spawnAgent: fakeSpawn() },
      })

      const promptPath = path.join(
        configDir,
        'history',
        'pay-prompt-file',
        `${ts}.prompt.txt`,
      )
      const body = await fsPromises.readFile(promptPath, 'utf-8')
      expect(body).toBe('Header.\nSOMETHING\nFooter.')
    })

    test('oversize payload returns payload-error and skips agent', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pay-big', payloadTask)

      let agentSpawned = false
      const result = await executeTask('pay-big', {
        configDir,
        payload: Buffer.alloc(1024 * 1024 + 1, 'a'),
        deps: {
          spawnAgent: async () => {
            agentSpawned = true
            return { exitCode: 0, output: '', timedOut: false }
          },
        },
      })

      if (result instanceof Error) throw result
      expect(agentSpawned).toBe(false)
      expect(result.kind).toBe('payload-error')
      if (result.kind !== 'payload-error') return
      expect(result.payload.error_reason).toBe('oversize')
      expect(result.payload.bytes).toBe(1024 * 1024 + 1)
    })

    test('invalid-utf8 payload returns payload-error and skips agent', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pay-bad-utf8', payloadTask)

      let agentSpawned = false
      const result = await executeTask('pay-bad-utf8', {
        configDir,
        payload: Buffer.from([0xc3, 0x28]),
        deps: {
          spawnAgent: async () => {
            agentSpawned = true
            return { exitCode: 0, output: '', timedOut: false }
          },
        },
      })

      if (result instanceof Error) throw result
      expect(agentSpawned).toBe(false)
      expect(result.kind).toBe('payload-error')
      if (result.kind !== 'payload-error') return
      expect(result.payload.error_reason).toBe('invalid-utf8')
    })
  })

  test('timedOut is false for normal completion', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'normal',
      '---\non:\n  schedule: "0 * * * *"\nagent: opencode\n---\nGo',
    )

    const result = await executeTask('normal', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })

    if (result instanceof Error) throw result
    if (result.kind !== 'agent') throw new Error('expected agent result')
    expect(result.timedOut).toBe(false)
  })

  describe('preflight', () => {
    const preflightTask = [
      '---',
      'on:',
      '  schedule: "0 8 * * 1-5"',
      'agent: opencode',
      "preflight: 'true'",
      '---',
      'Do thing.',
    ].join('\n')

    function fakePreflight(
      result: Partial<{
        exit_code: number
        stdout: string
        stderr: string
        timed_out: boolean
        signaled: boolean
        duration_ms: number
        stdout_oversize: boolean
        stdout_invalid_utf8: boolean
        stdout_bytes: number
        stderr_bytes: number
      }> = {},
    ): ExecuteDeps['spawnPreflight'] {
      const merged = {
        exit_code: 0,
        stdout: '',
        stderr: '',
        timed_out: false,
        signaled: false,
        duration_ms: 5,
        ...result,
      }
      return async () => ({
        ...merged,
        stdout_bytes:
          result.stdout_bytes ?? Buffer.byteLength(merged.stdout, 'utf8'),
        stderr_bytes:
          result.stderr_bytes ?? Buffer.byteLength(merged.stderr, 'utf8'),
      })
    }

    test('invokes preflight before agent on exit 0 and proceeds', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf', preflightTask)

      const calls: string[] = []
      const result = await executeTask('pf', {
        configDir,
        deps: {
          spawnPreflight: async () => {
            calls.push('preflight')
            return {
              exit_code: 0,
              stdout: '',
              stderr: '',
              timed_out: false,
              signaled: false,
              duration_ms: 5,
              stdout_bytes: 0,
              stderr_bytes: 0,
            }
          },
          spawnAgent: async () => {
            calls.push('agent')
            return { exitCode: 0, output: '', timedOut: false }
          },
        },
      })

      if (result instanceof Error) throw result
      expect(calls).toEqual(['preflight', 'agent'])
      expect(result.kind).toBe('agent')
    })

    test('exit 1 skips agent and returns skipped-preflight result', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'skip-pf', preflightTask)

      const calls: string[] = []
      const result = await executeTask('skip-pf', {
        configDir,
        deps: {
          spawnPreflight: fakePreflight({ exit_code: 1 }),
          spawnAgent: async () => {
            calls.push('agent')
            return { exitCode: 0, output: '', timedOut: false }
          },
        },
      })

      if (result instanceof Error) throw result
      expect(calls).toEqual([])
      expect(result.kind).toBe('skipped-preflight')
      if (result.kind !== 'skipped-preflight') return
      expect(result.preflight.exit_code).toBe(1)
      expect(result.preflight.error_reason).toBeUndefined()
    })

    test('exit 2+ returns preflight-error with error_reason: nonzero', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'err-pf', preflightTask)

      const result = await executeTask('err-pf', {
        configDir,
        deps: {
          spawnPreflight: fakePreflight({
            exit_code: 2,
            stderr: 'crash',
          }),
          spawnAgent: fakeSpawn(),
        },
      })

      if (result instanceof Error) throw result
      expect(result.kind).toBe('preflight-error')
      if (result.kind !== 'preflight-error') return
      expect(result.preflight.error_reason).toBe('nonzero')
      expect(result.preflight.stderr).toBe('crash')
    })

    test('timeout returns preflight-error with error_reason: timeout', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-timeout', preflightTask)

      const result = await executeTask('pf-timeout', {
        configDir,
        deps: {
          spawnPreflight: fakePreflight({
            exit_code: 124,
            timed_out: true,
          }),
          spawnAgent: fakeSpawn(),
        },
      })

      if (result instanceof Error) throw result
      expect(result.kind).toBe('preflight-error')
      if (result.kind !== 'preflight-error') return
      expect(result.preflight.error_reason).toBe('timeout')
      expect(result.preflight.timed_out).toBe(true)
    })

    test('timed_out wins over exit_code 0 (killed process reaped as 0)', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-killed-zero', preflightTask)

      const result = await executeTask('pf-killed-zero', {
        configDir,
        deps: {
          spawnPreflight: fakePreflight({
            exit_code: 0,
            timed_out: true,
          }),
          spawnAgent: fakeSpawn(),
        },
      })

      if (result instanceof Error) throw result
      expect(result.kind).toBe('preflight-error')
      if (result.kind !== 'preflight-error') return
      expect(result.preflight.error_reason).toBe('timeout')
    })

    test('signal exit returns preflight-error with error_reason: signal', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-signal', preflightTask)

      const result = await executeTask('pf-signal', {
        configDir,
        deps: {
          spawnPreflight: fakePreflight({
            exit_code: 1,
            signaled: true,
          }),
          spawnAgent: fakeSpawn(),
        },
      })

      if (result instanceof Error) throw result
      expect(result.kind).toBe('preflight-error')
      if (result.kind !== 'preflight-error') return
      expect(result.preflight.error_reason).toBe('signal')
    })

    test('passes 60s timeout to preflight spawn', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-timeout-cap', preflightTask)

      let observedTimeout = 0
      await executeTask('pf-timeout-cap', {
        configDir,
        deps: {
          spawnPreflight: async (opts) => {
            observedTimeout = opts.timeoutMs
            return {
              exit_code: 0,
              duration_ms: 5,
              stdout: '',
              stderr: '',
              timed_out: false,
              signaled: false,
              stdout_bytes: 0,
              stderr_bytes: 0,
            }
          },
          spawnAgent: fakeSpawn(),
        },
      })

      expect(observedTimeout).toBe(60_000)
    })

    test('exposes TM_TASK_NAME and TM_TRIGGER to preflight', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-env', preflightTask)

      let preflightEnv: Record<string, string> = {}
      await executeTask('pf-env', {
        configDir,
        trigger: 'tick',
        deps: {
          spawnPreflight: async (opts) => {
            preflightEnv = opts.env
            return {
              exit_code: 0,
              duration_ms: 5,
              stdout: '',
              stderr: '',
              timed_out: false,
              signaled: false,
              stdout_bytes: 0,
              stderr_bytes: 0,
            }
          },
          spawnAgent: fakeSpawn(),
        },
      })

      expect(preflightEnv['TM_TASK_NAME']).toBe('pf-env')
      expect(preflightEnv['TM_TRIGGER']).toBe('tick')
    })

    test('exposes TM_EVENT_NAME and TM_EVENT_PAYLOAD_FILE on dispatch trigger', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-dispatch', preflightTask)

      let preflightEnv: Record<string, string> = {}
      await executeTask('pf-dispatch', {
        configDir,
        trigger: 'dispatch',
        event: 'deploy',
        payloadFile: '/tmp/payload-123',
        deps: {
          spawnPreflight: async (opts) => {
            preflightEnv = opts.env
            return {
              exit_code: 0,
              duration_ms: 5,
              stdout: '',
              stderr: '',
              timed_out: false,
              signaled: false,
              stdout_bytes: 0,
              stderr_bytes: 0,
            }
          },
          spawnAgent: fakeSpawn(),
        },
      })

      expect(preflightEnv['TM_EVENT_NAME']).toBe('deploy')
      expect(preflightEnv['TM_EVENT_PAYLOAD_FILE']).toBe('/tmp/payload-123')
    })

    test('exposes TM_* env vars to agent run as well as preflight', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'agent-env', preflightTask)

      let agentEnv: Record<string, string> = {}
      await executeTask('agent-env', {
        configDir,
        trigger: 'manual',
        timestamp: runIdSchema.parse('2026-04-04T08.30.00Z'),
        deps: {
          spawnPreflight: fakePreflight(),
          spawnAgent: async (opts) => {
            agentEnv = opts.env
            return { exitCode: 0, output: '', timedOut: false }
          },
        },
      })

      expect(agentEnv['TM_TASK_NAME']).toBe('agent-env')
      expect(agentEnv['TM_TRIGGER']).toBe('manual')
      expect(agentEnv['TM_RUN_TIMESTAMP']).toBe('2026-04-04T08.30.00Z')
    })

    test('omits agent stage when preflight skips', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'no-agent', preflightTask)

      let agentSpawnCount = 0
      await executeTask('no-agent', {
        configDir,
        deps: {
          spawnPreflight: fakePreflight({ exit_code: 1 }),
          spawnAgent: async () => {
            agentSpawnCount++
            return { exitCode: 0, output: '', timedOut: false }
          },
        },
      })

      expect(agentSpawnCount).toBe(0)
    })

    test('attaches preflight outcome to agent result on exit 0', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'attach-pf', preflightTask)

      const result = await executeTask('attach-pf', {
        configDir,
        deps: {
          spawnPreflight: fakePreflight({
            exit_code: 0,
            stdout: 'inbox has 5 items',
            duration_ms: 42,
          }),
          spawnAgent: fakeSpawn(),
        },
      })

      if (result instanceof Error) throw result
      if (result.kind !== 'agent') throw new Error('expected agent result')
      expect(result.preflight?.exit_code).toBe(0)
      expect(result.preflight?.stdout).toBe('inbox has 5 items')
      expect(result.preflight?.duration_ms).toBe(42)
    })

    test('writes <ts>.preflight.txt to history dir when timestamp provided', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-file', preflightTask)
      const ts = runIdSchema.parse('2026-04-04T08.30.00Z')

      await executeTask('pf-file', {
        configDir,
        timestamp: ts,
        deps: {
          spawnPreflight: fakePreflight({
            exit_code: 1,
            stdout: 'no work',
            stderr: 'noisy',
          }),
          spawnAgent: fakeSpawn(),
        },
      })

      const preflightPath = path.join(
        configDir,
        'history',
        'pf-file',
        `${ts}.preflight.txt`,
      )
      const body = await fsPromises.readFile(preflightPath, 'utf-8')
      expect(body).toContain('no work')
      expect(body).toContain('noisy')
    })

    test('preflight.txt is written even on exit 0 (agent ran)', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-success-file', preflightTask)
      const ts = runIdSchema.parse('2026-04-05T08.30.00Z')

      await executeTask('pf-success-file', {
        configDir,
        timestamp: ts,
        deps: {
          spawnPreflight: fakePreflight({
            exit_code: 0,
            stdout: 'all good',
          }),
          spawnAgent: fakeSpawn(),
        },
      })

      const preflightPath = path.join(
        configDir,
        'history',
        'pf-success-file',
        `${ts}.preflight.txt`,
      )
      const body = await fsPromises.readFile(preflightPath, 'utf-8')
      expect(body).toContain('all good')
    })

    test('does not write preflight.txt when no preflight field declared', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'no-pf-file', agentTask)
      const ts = runIdSchema.parse('2026-04-06T08.30.00Z')

      await executeTask('no-pf-file', {
        configDir,
        timestamp: ts,
        deps: {
          spawnPreflight: fakePreflight(),
          spawnAgent: fakeSpawn(),
        },
      })

      const preflightPath = path.join(
        configDir,
        'history',
        'no-pf-file',
        `${ts}.preflight.txt`,
      )
      expect(fs.existsSync(preflightPath)).toBe(false)
    })

    const preflightTokenTask = [
      '---',
      'on:',
      '  schedule: "0 8 * * 1-5"',
      'agent: opencode',
      "preflight: 'echo data'",
      '---',
      'Header.',
      '<PREFLIGHT/>',
      'Footer.',
    ].join('\n')

    test('substitutes <PREFLIGHT/> with preflight stdout in resolved prompt', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-sub', preflightTokenTask)

      let promptFileContents = ''
      const result = await executeTask('pf-sub', {
        configDir,
        deps: {
          spawnPreflight: fakePreflight({ stdout: 'INJECTED-VALUE' }),
          spawnAgent: async (opts) => {
            const p = opts.env['TM_PROMPT_FILE'] ?? ''
            promptFileContents = fs.readFileSync(p, 'utf-8')
            return { exitCode: 0, output: '', timedOut: false }
          },
        },
      })

      if (result instanceof Error) throw result
      if (result.kind !== 'agent') throw new Error('expected agent result')
      expect(result.prompt).toBe('Header.\nINJECTED-VALUE\nFooter.')
      expect(promptFileContents).toBe('Header.\nINJECTED-VALUE\nFooter.')
    })

    test('trims leading/trailing whitespace from preflight stdout before substitution', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-trim', preflightTokenTask)

      const result = await executeTask('pf-trim', {
        configDir,
        deps: {
          spawnPreflight: fakePreflight({
            stdout: '\n\n  hello\nworld  \n\n',
          }),
          spawnAgent: fakeSpawn(),
        },
      })

      if (result instanceof Error) throw result
      if (result.kind !== 'agent') throw new Error('expected agent result')
      expect(result.prompt).toBe('Header.\nhello\nworld\nFooter.')
    })

    test('substitutes all occurrences of <PREFLIGHT/>', async () => {
      const configDir = await makeConfigDir()
      const multiToken = [
        '---',
        'on:',
        '  schedule: "0 8 * * 1-5"',
        'agent: opencode',
        "preflight: 'echo'",
        '---',
        '<PREFLIGHT/> and <PREFLIGHT/>',
      ].join('\n')
      await writeTask(configDir, 'pf-multi', multiToken)

      const result = await executeTask('pf-multi', {
        configDir,
        deps: {
          spawnPreflight: fakePreflight({ stdout: 'X' }),
          spawnAgent: fakeSpawn(),
        },
      })

      if (result instanceof Error) throw result
      if (result.kind !== 'agent') throw new Error('expected agent result')
      expect(result.prompt).toBe('X and X')
    })

    test('writes <ts>.prompt.txt when substitution produced non-empty content', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-prompt-file', preflightTokenTask)
      const ts = runIdSchema.parse('2026-04-07T08.30.00Z')

      await executeTask('pf-prompt-file', {
        configDir,
        timestamp: ts,
        deps: {
          spawnPreflight: fakePreflight({ stdout: 'INJECTED' }),
          spawnAgent: fakeSpawn(),
        },
      })

      const promptPath = path.join(
        configDir,
        'history',
        'pf-prompt-file',
        `${ts}.prompt.txt`,
      )
      const body = await fsPromises.readFile(promptPath, 'utf-8')
      expect(body).toBe('Header.\nINJECTED\nFooter.')
    })

    test('does not write <ts>.prompt.txt when body has no token', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-no-token', preflightTask)
      const ts = runIdSchema.parse('2026-04-07T09.30.00Z')

      await executeTask('pf-no-token', {
        configDir,
        timestamp: ts,
        deps: {
          spawnPreflight: fakePreflight({ stdout: 'unused' }),
          spawnAgent: fakeSpawn(),
        },
      })

      const promptPath = path.join(
        configDir,
        'history',
        'pf-no-token',
        `${ts}.prompt.txt`,
      )
      expect(fs.existsSync(promptPath)).toBe(false)
    })

    test('does not write <ts>.prompt.txt when stdout trims to empty', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-empty', preflightTokenTask)
      const ts = runIdSchema.parse('2026-04-07T10.30.00Z')

      await executeTask('pf-empty', {
        configDir,
        timestamp: ts,
        deps: {
          spawnPreflight: fakePreflight({ stdout: '   \n  ' }),
          spawnAgent: fakeSpawn(),
        },
      })

      const promptPath = path.join(
        configDir,
        'history',
        'pf-empty',
        `${ts}.prompt.txt`,
      )
      expect(fs.existsSync(promptPath)).toBe(false)
    })

    test('oversize-stdout flag returns preflight-error with no agent spawn', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-oversize', preflightTask)

      let agentSpawned = false
      const result = await executeTask('pf-oversize', {
        configDir,
        deps: {
          spawnPreflight: fakePreflight({
            exit_code: 0,
            stdout_oversize: true,
          }),
          spawnAgent: async () => {
            agentSpawned = true
            return { exitCode: 0, output: '', timedOut: false }
          },
        },
      })

      if (result instanceof Error) throw result
      expect(agentSpawned).toBe(false)
      expect(result.kind).toBe('preflight-error')
      if (result.kind !== 'preflight-error') return
      expect(result.preflight.error_reason).toBe('oversize-stdout')
    })

    test('invalid-utf8 flag returns preflight-error with no agent spawn', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'pf-invalid-utf8', preflightTask)

      let agentSpawned = false
      const result = await executeTask('pf-invalid-utf8', {
        configDir,
        deps: {
          spawnPreflight: fakePreflight({
            exit_code: 0,
            stdout_invalid_utf8: true,
          }),
          spawnAgent: async () => {
            agentSpawned = true
            return { exitCode: 0, output: '', timedOut: false }
          },
        },
      })

      if (result instanceof Error) throw result
      expect(agentSpawned).toBe(false)
      expect(result.kind).toBe('preflight-error')
      if (result.kind !== 'preflight-error') return
      expect(result.preflight.error_reason).toBe('invalid-utf8')
    })

    test('tasks without preflight skip the preflight stage entirely', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'no-pf', agentTask)

      let preflightCalled = false
      const result = await executeTask('no-pf', {
        configDir,
        deps: {
          spawnPreflight: async () => {
            preflightCalled = true
            return {
              exit_code: 0,
              duration_ms: 0,
              stdout: '',
              stderr: '',
              timed_out: false,
              signaled: false,
              stdout_bytes: 0,
              stderr_bytes: 0,
            }
          },
          spawnAgent: fakeSpawn(),
        },
      })

      if (result instanceof Error) throw result
      expect(preflightCalled).toBe(false)
      expect(result.kind).toBe('agent')
      if (result.kind !== 'agent') return
      expect(result.preflight).toBeUndefined()
    })
  })
})

describe('runTask', () => {
  test('delegates to executeTask (no locking)', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'simple', agentTask)

    const result = await runTask('simple', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })

    if (result instanceof Error) throw result
    if (result.kind !== 'agent') throw new Error('expected agent result')
    expect(result.exitCode).toBe(0)
  })

  test('allows concurrent invocations of the same task', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'concurrent', agentTask)

    // Both should succeed — no lock contention
    const [a, b] = await Promise.all([
      runTask('concurrent', {
        configDir,
        deps: { spawnAgent: fakeSpawn() },
      }),
      runTask('concurrent', {
        configDir,
        deps: { spawnAgent: fakeSpawn() },
      }),
    ])

    expect(a).not.toBeInstanceOf(Error)
    expect(b).not.toBeInstanceOf(Error)
  })

  test('preflight does not run when lock is contended', async () => {
    const configDir = await makeConfigDir()
    const preflightLockTask = [
      '---',
      'on:',
      '  schedule: "0 8 * * 1-5"',
      'agent: opencode',
      "preflight: 'true'",
      '---',
      'Body.',
    ].join('\n')
    await writeTask(configDir, 'pf-lock', preflightLockTask)

    let preflightCalls = 0
    const blockingAgent: ExecuteDeps['spawnAgent'] = () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({ exitCode: 0, output: '', timedOut: false })
        }, 50)
      })

    // Hold lock with a slow agent run
    const slow = runTask('pf-lock', {
      configDir,
      lock: true,
      deps: {
        spawnPreflight: async () => {
          preflightCalls++
          return {
            exit_code: 0,
            duration_ms: 1,
            stdout: '',
            stderr: '',
            timed_out: false,
            signaled: false,
            stdout_bytes: 0,
            stderr_bytes: 0,
          }
        },
        spawnAgent: blockingAgent,
      },
    })

    // Wait long enough for the slow run to grab the lock
    await new Promise((r) => setTimeout(r, 10))

    const contended = await runTask('pf-lock', {
      configDir,
      lock: true,
      deps: {
        spawnPreflight: async () => {
          preflightCalls++
          return {
            exit_code: 0,
            duration_ms: 1,
            stdout: '',
            stderr: '',
            timed_out: false,
            signaled: false,
            stdout_bytes: 0,
            stderr_bytes: 0,
          }
        },
        spawnAgent: fakeSpawn(),
      },
    })

    expect(contended).toBeInstanceOf(TaskContentionError)
    await slow
    // Only the first run's preflight ran; the contended one bailed before preflight
    expect(preflightCalls).toBe(1)
  })
})

// -- defaultSpawnAgent --

describe('defaultSpawnAgent', () => {
  test('runs command and captures output', async () => {
    const result = await defaultSpawnAgent({
      command: 'echo hello',
      cwd: '/tmp',
      env: { PATH: process.env['PATH'] ?? '' },
    })
    expect(result.exitCode).toBe(0)
    expect(result.output.trim()).toBe('hello')
    expect(result.timedOut).toBe(false)
  })

  test('merges stdout and stderr into output', async () => {
    const result = await defaultSpawnAgent({
      command: 'echo out && echo err >&2',
      cwd: '/tmp',
      env: { PATH: process.env['PATH'] ?? '' },
    })
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('out')
    expect(result.output).toContain('err')
  })

  test('sends SIGTERM to process group on timeout', async () => {
    vi.useFakeTimers()

    const child = createMockChild(9999)
    const kills: Array<{ pid: number; signal: NodeJS.Signals }> = []

    const promise = defaultSpawnAgent(
      {
        command: 'ignored',
        cwd: '/tmp',
        env: {},
        timeoutMs: 5000,
      },
      {
        spawn: createMockSpawn(child),
        killProcessGroup: (pid, signal) => {
          kills.push({ pid, signal })
          // Simulate process dying from SIGTERM
          child.simulateExit(143)
        },
      },
    )

    vi.advanceTimersByTime(5000)
    const result = await promise

    expect(result.timedOut).toBe(true)
    expect(kills).toEqual([{ pid: 9999, signal: 'SIGTERM' }])

    vi.useRealTimers()
  })

  test('sends SIGKILL after grace period if process ignores SIGTERM', async () => {
    vi.useFakeTimers()

    const child = createMockChild(9999)
    const kills: Array<{ pid: number; signal: NodeJS.Signals }> = []

    const promise = defaultSpawnAgent(
      {
        command: 'ignored',
        cwd: '/tmp',
        env: {},
        timeoutMs: 5000,
      },
      {
        spawn: createMockSpawn(child),
        killProcessGroup: (pid, signal) => {
          kills.push({ pid, signal })
          // Only die on SIGKILL
          if (signal === 'SIGKILL') child.simulateExit(137)
        },
      },
    )

    // Fire timeout → SIGTERM
    vi.advanceTimersByTime(5000)
    expect(kills).toEqual([{ pid: 9999, signal: 'SIGTERM' }])

    // Fire grace period → SIGKILL
    vi.advanceTimersByTime(KILL_GRACE_MS)
    const result = await promise

    expect(kills).toEqual([
      { pid: 9999, signal: 'SIGTERM' },
      { pid: 9999, signal: 'SIGKILL' },
    ])
    expect(result.timedOut).toBe(true)

    vi.useRealTimers()
  })

  test('does not send SIGKILL if process exits during grace period', async () => {
    vi.useFakeTimers()

    const child = createMockChild(9999)
    const kills: Array<{ pid: number; signal: NodeJS.Signals }> = []

    const promise = defaultSpawnAgent(
      {
        command: 'ignored',
        cwd: '/tmp',
        env: {},
        timeoutMs: 5000,
      },
      {
        spawn: createMockSpawn(child),
        killProcessGroup: (pid, signal) => kills.push({ pid, signal }),
      },
    )

    // Fire timeout → SIGTERM
    vi.advanceTimersByTime(5000)
    expect(kills).toHaveLength(1)

    // Process exits during grace period (responds to SIGTERM)
    child.simulateExit(143)
    const result = await promise

    // Advance past grace period — SIGKILL should NOT fire
    vi.advanceTimersByTime(KILL_GRACE_MS)

    expect(kills).toHaveLength(1)
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBe(143)

    vi.useRealTimers()
  })

  test('captures partial output before timeout', async () => {
    vi.useFakeTimers()

    const child = createMockChild(9999)

    const promise = defaultSpawnAgent(
      {
        command: 'ignored',
        cwd: '/tmp',
        env: {},
        timeoutMs: 5000,
      },
      {
        spawn: createMockSpawn(child),
        killProcessGroup: (_pid, _signal) => child.simulateExit(143),
      },
    )

    // Process emits some output before timeout
    child.simulateOutput('stdout', 'partial output\n')

    vi.advanceTimersByTime(5000)
    const result = await promise

    expect(result.output).toBe('partial output\n')
    expect(result.timedOut).toBe(true)

    vi.useRealTimers()
  })

  test('normal exit before timeout clears timer', async () => {
    vi.useFakeTimers()

    const child = createMockChild(9999)
    const kills: Array<{ pid: number; signal: NodeJS.Signals }> = []

    const promise = defaultSpawnAgent(
      {
        command: 'ignored',
        cwd: '/tmp',
        env: {},
        timeoutMs: 60_000,
      },
      {
        spawn: createMockSpawn(child),
        killProcessGroup: (pid, signal) => kills.push({ pid, signal }),
      },
    )

    // Process exits before timeout fires
    child.simulateOutput('stdout', 'done\n')
    child.simulateExit(0)
    const result = await promise

    // Advance past the timeout — should not fire
    vi.advanceTimersByTime(60_000)

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe('done\n')
    expect(kills).toHaveLength(0)

    vi.useRealTimers()
  })

  test('writes output to file and reads it back when outputPath provided', async () => {
    const outputPath = path.join(
      await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tm-fd-')),
      'output.txt',
    )

    const result = await defaultSpawnAgent({
      command: 'echo hello && echo world >&2',
      cwd: '/tmp',
      env: { PATH: process.env['PATH'] ?? '' },
      outputPath,
    })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('hello')
    expect(result.output).toContain('world')
    expect(result.timedOut).toBe(false)

    // Verify the file exists on disk with the same content
    const onDisk = await fsPromises.readFile(outputPath, 'utf-8')
    expect(onDisk).toBe(result.output)
  })

  test('falls back to pipe collection when outputPath not provided', async () => {
    const result = await defaultSpawnAgent({
      command: 'echo pipe-mode',
      cwd: '/tmp',
      env: { PATH: process.env['PATH'] ?? '' },
    })

    expect(result.output.trim()).toBe('pipe-mode')
  })

  test('returns exit code 127 and diagnostic output when spawn fails (pid undefined)', async () => {
    const result = await defaultSpawnAgent(
      {
        command: 'nonexistent-command',
        cwd: '/tmp',
        env: {},
      },
      {
        spawn: () => ({
          pid: undefined,
          exitCode: null,
          stdout: null,
          stderr: null,
          on: () => {},
        }),
        killProcessGroup: () => {},
      },
    )

    expect(result.exitCode).toBe(127)
    expect(result.output).toBe('Failed to spawn process: nonexistent-command')
    expect(result.timedOut).toBe(false)
  })

  test('skips kill if process already exited when timeout fires', async () => {
    vi.useFakeTimers()

    const child = createMockChild(9999)
    const kills: Array<{ pid: number; signal: NodeJS.Signals }> = []

    // Set exitCode before timeout fires (simulates race)
    child.exitCode = 0

    const promise = defaultSpawnAgent(
      {
        command: 'ignored',
        cwd: '/tmp',
        env: {},
        timeoutMs: 1000,
      },
      {
        spawn: createMockSpawn(child),
        killProcessGroup: (pid, signal) => kills.push({ pid, signal }),
      },
    )

    vi.advanceTimersByTime(1000)

    // Timeout fired but guard prevented kill
    expect(kills).toHaveLength(0)

    // Now close the process
    child.simulateExit(0)
    const result = await promise

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(0)

    vi.useRealTimers()
  })
})
