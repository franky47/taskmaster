import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { HistoryWriteError, recordHistory } from './record'
import type { RecordHistoryInput } from './record'

async function makeConfigDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tm-hist-'))
}

function makeInput(
  configDir: string,
  overrides: Partial<RecordHistoryInput> = {},
): RecordHistoryInput {
  return {
    taskName: 'daily-audit',
    timestamp: '2026-04-04T08.30.00Z',
    startedAt: new Date('2026-04-04T08:30:00Z'),
    finishedAt: new Date('2026-04-04T08:30:15.456Z'),
    exitCode: 0,
    stdout: 'all good',
    stderr: '',
    prompt: 'Run the audit.',
    cwd: { path: '/tmp/fake', isTemp: false },
    ...overrides,
  }
}

describe('recordHistory', () => {
  test('writes meta.json with correct fields', async () => {
    const configDir = await makeConfigDir()
    const input = makeInput(configDir)

    const result = await recordHistory(input, { configDir })
    expect(result).toBeUndefined()

    const metaPath = path.join(
      configDir,
      'history',
      'daily-audit',
      '2026-04-04T08.30.00Z.meta.json',
    )
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'))
    expect(meta.timestamp).toBe('2026-04-04T08.30.00Z')
    expect(meta.started_at).toBe('2026-04-04T08:30:00.000Z')
    expect(meta.finished_at).toBe('2026-04-04T08:30:15.456Z')
    expect(meta.duration_ms).toBe(15456)
    expect(meta.exit_code).toBe(0)
    expect(meta.success).toBe(true)
  })

  test('writes stdout.txt always', async () => {
    const configDir = await makeConfigDir()
    const input = makeInput(configDir)

    await recordHistory(input, { configDir })

    const stdoutPath = path.join(
      configDir,
      'history',
      'daily-audit',
      '2026-04-04T08.30.00Z.stdout.txt',
    )
    expect(await fs.readFile(stdoutPath, 'utf-8')).toBe('all good')
  })

  test('writes stderr.txt when non-empty', async () => {
    const configDir = await makeConfigDir()
    const input = makeInput(configDir, { stderr: 'warning: something' })

    await recordHistory(input, { configDir })

    const stderrPath = path.join(
      configDir,
      'history',
      'daily-audit',
      '2026-04-04T08.30.00Z.stderr.txt',
    )
    expect(await fs.readFile(stderrPath, 'utf-8')).toBe('warning: something')
  })

  test('omits stderr.txt when stderr is empty', async () => {
    const configDir = await makeConfigDir()
    const input = makeInput(configDir, { stderr: '' })

    await recordHistory(input, { configDir })

    const stderrPath = path.join(
      configDir,
      'history',
      'daily-audit',
      '2026-04-04T08.30.00Z.stderr.txt',
    )
    expect(fs.access(stderrPath)).rejects.toThrow()
  })

  test('success is false when exitCode is non-zero', async () => {
    const configDir = await makeConfigDir()
    const input = makeInput(configDir, { exitCode: 1 })

    await recordHistory(input, { configDir })

    const metaPath = path.join(
      configDir,
      'history',
      'daily-audit',
      '2026-04-04T08.30.00Z.meta.json',
    )
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'))
    expect(meta.success).toBe(false)
    expect(meta.exit_code).toBe(1)
  })

  test('creates history directory if it does not exist', async () => {
    const configDir = await makeConfigDir()
    const input = makeInput(configDir, { taskName: 'new-task' })

    await recordHistory(input, { configDir })

    const dir = path.join(configDir, 'history', 'new-task')
    const stat = await fs.stat(dir)
    expect(stat.isDirectory()).toBe(true)
  })

  test('success + temp dir: deletes temp dir', async () => {
    const configDir = await makeConfigDir()
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmaster-'))
    // Put a file in it to verify it gets removed
    await fs.writeFile(path.join(tmpDir, 'artifact.txt'), 'data')

    const input = makeInput(configDir, {
      exitCode: 0,
      cwd: { path: tmpDir, isTemp: true },
    })

    await recordHistory(input, { configDir })

    expect(fs.access(tmpDir)).rejects.toThrow()
  })

  test('failure + temp dir: moves to runs/ with artifacts', async () => {
    const configDir = await makeConfigDir()
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmaster-'))
    await fs.writeFile(path.join(tmpDir, 'work.txt'), 'claude work')

    const input = makeInput(configDir, {
      exitCode: 1,
      stdout: 'partial output',
      stderr: 'error occurred',
      prompt: 'Do the audit.',
      cwd: { path: tmpDir, isTemp: true },
    })

    await recordHistory(input, { configDir })

    const runsPath = path.join(
      configDir,
      'runs',
      'daily-audit',
      '2026-04-04T08.30.00Z',
    )
    // prompt, stdout, stderr preserved in runs dir
    expect(await fs.readFile(path.join(runsPath, 'prompt.md'), 'utf-8')).toBe(
      'Do the audit.',
    )
    expect(await fs.readFile(path.join(runsPath, 'stdout.txt'), 'utf-8')).toBe(
      'partial output',
    )
    expect(await fs.readFile(path.join(runsPath, 'stderr.txt'), 'utf-8')).toBe(
      'error occurred',
    )
    // claude's working files also preserved
    expect(await fs.readFile(path.join(runsPath, 'work.txt'), 'utf-8')).toBe(
      'claude work',
    )
    // original temp dir removed
    expect(fs.access(tmpDir)).rejects.toThrow()
  })

  test('explicit cwd + success: cwd untouched', async () => {
    const configDir = await makeConfigDir()
    const cwdDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-cwd-'))
    await fs.writeFile(path.join(cwdDir, 'keep.txt'), 'keep me')

    const input = makeInput(configDir, {
      cwd: { path: cwdDir, isTemp: false },
    })

    await recordHistory(input, { configDir })

    expect(await fs.readFile(path.join(cwdDir, 'keep.txt'), 'utf-8')).toBe(
      'keep me',
    )
  })

  test('explicit cwd + failure: cwd untouched', async () => {
    const configDir = await makeConfigDir()
    const cwdDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-cwd-'))
    await fs.writeFile(path.join(cwdDir, 'keep.txt'), 'keep me')

    const input = makeInput(configDir, {
      exitCode: 1,
      cwd: { path: cwdDir, isTemp: false },
    })

    await recordHistory(input, { configDir })

    expect(await fs.readFile(path.join(cwdDir, 'keep.txt'), 'utf-8')).toBe(
      'keep me',
    )
  })

  test('returns HistoryWriteError on filesystem failure', async () => {
    const input = makeInput('/nonexistent/path/xyz')

    const result = await recordHistory(input, {
      configDir: '/nonexistent/path/xyz',
    })
    expect(result).toBeInstanceOf(HistoryWriteError)
  })
})
