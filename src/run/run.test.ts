import { describe, expect, test, vi } from 'bun:test'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { AgentNotFoundError } from '#src/agent'
import { TaskContentionError, acquireTaskLock, releaseLock } from '#src/lock'
import { type RunningMarker, readRunningMarker } from '#src/lock/marker'
import {
  FrontmatterValidationError,
  TaskFileNameError,
  TaskNotFoundError,
} from '#src/task'

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
  'schedule: "0 8 * * 1-5"',
  'agent: opencode',
  'args: "--model opus"',
  'env:',
  '  PROJECT: myproject',
  '---',
  'Do the thing.',
].join('\n')

const claudeTaskWithArgs = [
  '---',
  'schedule: "0 8 * * 1-5"',
  'agent: claude',
  'args: "--model sonnet"',
  '---',
  'Review PRs.',
].join('\n')

const runTask_ = [
  '---',
  'schedule: "0 8 * * 1-5"',
  'run: "my-agent $TM_PROMPT_FILE"',
  '---',
  'Do the thing.',
].join('\n')

const unknownAgentTask = [
  '---',
  'schedule: "0 8 * * 1-5"',
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
    await writeTask(configDir, 'bad-task', '---\nschedule: "not cron"\n---\nHi')
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
      'schedule: "0 8 * * 1-5"',
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
      '---\nschedule: "0 8 * * *"\nagent: opencode\n---\nHi',
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
      'schedule: "0 8 * * 1-5"',
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
      'schedule: "0 8 * * 1-5"',
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
      '---\nschedule: "0 * * * *"\nagent: opencode\n---\nFail',
    )

    const result = await executeTask('fail-task', {
      configDir,
      deps: { spawnAgent: fakeSpawn({ exitCode: 42 }) },
    })

    if (result instanceof Error) throw result
    expect(result.exitCode).toBe(42)
  })

  test('captures output', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'output',
      '---\nschedule: "0 * * * *"\nagent: opencode\n---\nGo',
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
    expect(result.output).toBe('hello out\nhello err')
  })

  test('includes startedAt and finishedAt timestamps', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'timing',
      '---\nschedule: "0 * * * *"\nagent: opencode\n---\nGo',
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
      '---\nschedule: "0 * * * *"\nagent: opencode\n---\nGo',
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
    const task = `---\nschedule: "0 * * * *"\nagent: opencode\ncwd: "${cwdDir}"\n---\nGo`
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
      '---\nschedule: "0 * * * *"\nagent: opencode\n---\nDo the thing.',
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
      '---\nschedule: "0 * * * *"\nagent: opencode\ntimeout: "30s"\n---\nGo',
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
      '---\nschedule: "0 * * * *"\nagent: opencode\n---\nGo',
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
      '---\nschedule: "0 * * * *"\nagent: opencode\ntimeout: "5s"\n---\nGo',
    )

    const result = await executeTask('timed-out', {
      configDir,
      deps: { spawnAgent: fakeSpawn({ timedOut: true, exitCode: 1 }) },
    })

    if (result instanceof Error) throw result
    expect(result.timedOut).toBe(true)
  })

  test('passes outputPath to spawnAgent when timestamp provided', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'fd-test',
      '---\nschedule: "0 * * * *"\nagent: opencode\n---\nGo',
    )

    let receivedOutputPath: string | undefined
    await executeTask('fd-test', {
      configDir,
      timestamp: '2026-04-09T10.00.00Z',
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
      '---\nschedule: "0 * * * *"\nagent: opencode\n---\nGo',
    )

    let histDirExisted = false
    await executeTask('dir-create', {
      configDir,
      timestamp: '2026-04-09T10.00.00Z',
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
      '---\nschedule: "0 * * * *"\nagent: opencode\n---\nGo',
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

  test('timedOut is false for normal completion', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'normal',
      '---\nschedule: "0 * * * *"\nagent: opencode\n---\nGo',
    )

    const result = await executeTask('normal', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })

    if (result instanceof Error) throw result
    expect(result.timedOut).toBe(false)
  })
})

describe('runTask', () => {
  test('returns TaskContentionError when lock is contended', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'locked', agentTask)

    const locksDir = path.join(configDir, 'locks')
    const lock = acquireTaskLock('locked', locksDir)
    if (lock instanceof Error || 'contended' in lock)
      throw new Error('test setup failed')

    const result = await runTask('locked', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })

    expect(result).toBeInstanceOf(TaskContentionError)
    releaseLock(lock.fd)
  })

  test('holds lock during execution, not just at start', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'hold-lock', agentTask)
    const locksDir = path.join(configDir, 'locks')

    let lockHeldDuringExecution = false
    const result = await runTask('hold-lock', {
      configDir,
      deps: {
        spawnAgent: async () => {
          const probe = acquireTaskLock('hold-lock', locksDir)
          lockHeldDuringExecution = 'contended' in probe
          if ('fd' in probe) releaseLock(probe.fd)
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    if (result instanceof Error) throw result
    expect(lockHeldDuringExecution).toBe(true)
  })

  test('releases lock after successful run (re-acquire succeeds)', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'release-ok', agentTask)

    const result = await runTask('release-ok', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })

    if (result instanceof Error) throw result

    const locksDir = path.join(configDir, 'locks')
    const lock = acquireTaskLock('release-ok', locksDir)
    expect('fd' in lock).toBe(true)
    if ('fd' in lock) releaseLock(lock.fd)
  })

  test('releases lock even when execution fails', async () => {
    const configDir = await makeConfigDir()
    const task = [
      '---',
      'schedule: "0 8 * * 1-5"',
      'agent: opencode',
      'cwd: "/nonexistent/dir/xyz"',
      '---',
      'Prompt.',
    ].join('\n')
    await writeTask(configDir, 'fail-lock', task)

    const result = await runTask('fail-lock', {
      configDir,
      deps: { spawnAgent: fakeSpawn() },
    })

    expect(result).toBeInstanceOf(CwdNotFoundError)

    const locksDir = path.join(configDir, 'locks')
    const lock = acquireTaskLock('fail-lock', locksDir)
    expect('fd' in lock).toBe(true)
    if ('fd' in lock) releaseLock(lock.fd)
  })

  test('writes running marker to lock file during execution', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'marker-write', agentTask)
    const locksDir = path.join(configDir, 'locks')
    const timestamp = '2026-04-09T10.00.00Z'

    let markerDuringExec: RunningMarker | null = null
    const result = await runTask('marker-write', {
      configDir,
      timestamp,
      deps: {
        spawnAgent: async () => {
          markerDuringExec = readRunningMarker('marker-write', locksDir)
          return { exitCode: 0, output: '', timedOut: false }
        },
      },
    })

    if (result instanceof Error) throw result
    expect(markerDuringExec).not.toBeNull()
    expect(markerDuringExec!.pid).toBe(process.pid)
    expect(markerDuringExec!.timestamp).toBe(timestamp)
    expect(markerDuringExec!.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('truncates running marker from lock file after completion', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'marker-clear', agentTask)
    const locksDir = path.join(configDir, 'locks')
    const timestamp = '2026-04-09T10.00.00Z'

    const result = await runTask('marker-clear', {
      configDir,
      timestamp,
      deps: { spawnAgent: fakeSpawn() },
    })

    if (result instanceof Error) throw result

    const lockContent = fs.readFileSync(
      path.join(locksDir, 'marker-clear.lock'),
      'utf-8',
    )
    expect(lockContent).toBe('')
  })

  test('truncates running marker even when execution fails', async () => {
    const configDir = await makeConfigDir()
    const task = [
      '---',
      'schedule: "0 8 * * 1-5"',
      'agent: opencode',
      'cwd: "/nonexistent/dir/xyz"',
      '---',
      'Prompt.',
    ].join('\n')
    await writeTask(configDir, 'marker-fail', task)
    const locksDir = path.join(configDir, 'locks')
    const timestamp = '2026-04-09T10.00.00Z'

    const result = await runTask('marker-fail', {
      configDir,
      timestamp,
      deps: { spawnAgent: fakeSpawn() },
    })

    expect(result).toBeInstanceOf(CwdNotFoundError)

    const lockContent = fs.readFileSync(
      path.join(locksDir, 'marker-fail.lock'),
      'utf-8',
    )
    expect(lockContent).toBe('')
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
