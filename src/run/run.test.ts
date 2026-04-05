import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  FrontmatterValidationError,
  TaskFileNameError,
  TaskNotFoundError,
} from '../task'
import { CwdNotFoundError } from './cwd'
import { runTask } from './run'
import type { RunDeps } from './run'

type SpawnResult = {
  exitCode: number
  stdout: string
  stderr: string
}

function fakeSpawn(result: Partial<SpawnResult> = {}): RunDeps['spawnClaude'] {
  return async () => ({
    exitCode: 0,
    stdout: '',
    stderr: '',
    ...result,
  })
}

async function makeConfigDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-run-'))
  await fs.mkdir(path.join(dir, 'tasks'), { recursive: true })
  return dir
}

async function writeTask(
  configDir: string,
  name: string,
  content: string,
): Promise<void> {
  await fs.writeFile(path.join(configDir, 'tasks', `${name}.md`), content)
}

const validTask = [
  '---',
  'schedule: "0 8 * * 1-5"',
  'args: ["--model", "opus"]',
  'env:',
  '  PROJECT: myproject',
  '---',
  'Do the thing.',
].join('\n')

describe('runTask', () => {
  test('returns TaskNotFoundError for non-existent task', async () => {
    const configDir = await makeConfigDir()
    const result = await runTask('no-such-task', {
      configDir,
      deps: { spawnClaude: fakeSpawn() },
    })
    expect(result).toBeInstanceOf(TaskNotFoundError)
  })

  test('returns TaskFileNameError for invalid task name', async () => {
    const configDir = await makeConfigDir()
    const result = await runTask('INVALID_NAME', {
      configDir,
      deps: { spawnClaude: fakeSpawn() },
    })
    expect(result).toBeInstanceOf(TaskFileNameError)
  })

  test('returns FrontmatterValidationError for invalid frontmatter', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'bad-task', '---\nschedule: "not cron"\n---\nHi')
    const result = await runTask('bad-task', {
      configDir,
      deps: { spawnClaude: fakeSpawn() },
    })
    expect(result).toBeInstanceOf(FrontmatterValidationError)
  })

  test('passes prompt body to spawnClaude', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', validTask)

    let receivedPrompt = ''
    const result = await runTask('my-task', {
      configDir,
      deps: {
        spawnClaude: async (opts) => {
          receivedPrompt = opts.prompt
          return { exitCode: 0, stdout: 'done', stderr: '' }
        },
      },
    })

    expect(receivedPrompt).toBe('Do the thing.')
    if (result instanceof Error) throw result
    expect(result.stdout).toBe('done')
  })

  test('passes args from frontmatter to spawnClaude', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', validTask)

    let receivedArgs: string[] = []
    await runTask('my-task', {
      configDir,
      deps: {
        spawnClaude: async (opts) => {
          receivedArgs = opts.args
          return { exitCode: 0, stdout: '', stderr: '' }
        },
      },
    })

    expect(receivedArgs).toEqual(['--model', 'opus'])
  })

  test('passes per-task env merged with global env', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'my-task', validTask)
    await fs.writeFile(
      path.join(configDir, '.env'),
      'GLOBAL_KEY=global_val\nPROJECT=overridden\n',
    )

    let receivedEnv: Record<string, string> = {}
    await runTask('my-task', {
      configDir,
      deps: {
        spawnClaude: async (opts) => {
          receivedEnv = opts.env
          return { exitCode: 0, stdout: '', stderr: '' }
        },
      },
    })

    // global .env provides GLOBAL_KEY
    expect(receivedEnv.GLOBAL_KEY).toBe('global_val')
    // per-task env overrides global
    expect(receivedEnv.PROJECT).toBe('myproject')
  })

  test('resolves cwd from frontmatter', async () => {
    const cwdDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-cwd-'))
    const configDir = await makeConfigDir()
    const task = [
      '---',
      'schedule: "0 8 * * 1-5"',
      `cwd: "${cwdDir}"`,
      '---',
      'Prompt.',
    ].join('\n')
    await writeTask(configDir, 'cwd-task', task)

    let receivedCwd = ''
    await runTask('cwd-task', {
      configDir,
      deps: {
        spawnClaude: async (opts) => {
          receivedCwd = opts.cwd
          return { exitCode: 0, stdout: '', stderr: '' }
        },
      },
    })

    expect(receivedCwd).toBe(cwdDir)
  })

  test('creates temp dir when cwd omitted', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'no-cwd', '---\nschedule: "0 8 * * *"\n---\nHi')

    let receivedCwd = ''
    await runTask('no-cwd', {
      configDir,
      deps: {
        spawnClaude: async (opts) => {
          receivedCwd = opts.cwd
          return { exitCode: 0, stdout: '', stderr: '' }
        },
      },
    })

    expect(receivedCwd).toContain('taskmaster-')
    const stat = await fs.stat(receivedCwd)
    expect(stat.isDirectory()).toBe(true)
  })

  test('returns CwdNotFoundError when cwd does not exist', async () => {
    const configDir = await makeConfigDir()
    const task = [
      '---',
      'schedule: "0 8 * * 1-5"',
      'cwd: "/nonexistent/dir/xyz"',
      '---',
      'Prompt.',
    ].join('\n')
    await writeTask(configDir, 'bad-cwd', task)

    const result = await runTask('bad-cwd', {
      configDir,
      deps: { spawnClaude: fakeSpawn() },
    })
    expect(result).toBeInstanceOf(CwdNotFoundError)
  })

  test('ignores enabled: false (S3.9)', async () => {
    const configDir = await makeConfigDir()
    const task = [
      '---',
      'schedule: "0 8 * * 1-5"',
      'enabled: false',
      '---',
      'Disabled prompt.',
    ].join('\n')
    await writeTask(configDir, 'disabled', task)

    let ran = false
    await runTask('disabled', {
      configDir,
      deps: {
        spawnClaude: async () => {
          ran = true
          return { exitCode: 0, stdout: '', stderr: '' }
        },
      },
    })

    expect(ran).toBe(true)
  })

  test('propagates exit code from claude (S3.10)', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'fail-task',
      '---\nschedule: "0 * * * *"\n---\nFail',
    )

    const result = await runTask('fail-task', {
      configDir,
      deps: { spawnClaude: fakeSpawn({ exitCode: 42 }) },
    })

    if (result instanceof Error) throw result
    expect(result.exitCode).toBe(42)
  })

  test('captures stdout and stderr', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'output', '---\nschedule: "0 * * * *"\n---\nGo')

    const result = await runTask('output', {
      configDir,
      deps: {
        spawnClaude: fakeSpawn({
          stdout: 'hello out',
          stderr: 'hello err',
        }),
      },
    })

    if (result instanceof Error) throw result
    expect(result.stdout).toBe('hello out')
    expect(result.stderr).toBe('hello err')
  })

  test('includes startedAt and finishedAt timestamps', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'timing', '---\nschedule: "0 * * * *"\n---\nGo')

    const before = new Date()
    const result = await runTask('timing', {
      configDir,
      deps: { spawnClaude: fakeSpawn() },
    })
    const after = new Date()

    if (result instanceof Error) throw result
    expect(result.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(result.finishedAt.getTime()).toBeLessThanOrEqual(after.getTime())
    expect(result.finishedAt.getTime()).toBeGreaterThanOrEqual(
      result.startedAt.getTime(),
    )
  })

  test('includes cwd with isTemp when cwd omitted', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'temp-cwd',
      '---\nschedule: "0 * * * *"\n---\nGo',
    )

    const result = await runTask('temp-cwd', {
      configDir,
      deps: { spawnClaude: fakeSpawn() },
    })

    if (result instanceof Error) throw result
    expect(result.cwd.isTemp).toBe(true)
    expect(result.cwd.path).toContain('taskmaster-')
  })

  test('includes cwd with isTemp=false when cwd specified', async () => {
    const cwdDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-cwd-'))
    const configDir = await makeConfigDir()
    const task = `---\nschedule: "0 * * * *"\ncwd: "${cwdDir}"\n---\nGo`
    await writeTask(configDir, 'explicit-cwd', task)

    const result = await runTask('explicit-cwd', {
      configDir,
      deps: { spawnClaude: fakeSpawn() },
    })

    if (result instanceof Error) throw result
    expect(result.cwd.isTemp).toBe(false)
    expect(result.cwd.path).toBe(cwdDir)
  })

  test('includes prompt body in result', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'prompt-check',
      '---\nschedule: "0 * * * *"\n---\nDo the thing.',
    )

    const result = await runTask('prompt-check', {
      configDir,
      deps: { spawnClaude: fakeSpawn() },
    })

    if (result instanceof Error) throw result
    expect(result.prompt).toBe('Do the thing.')
  })
})
