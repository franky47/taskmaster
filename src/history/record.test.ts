import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { RecordArtifacts } from './record'
import { HistoryWriteError, recordHistory } from './record'
import type { HistoryMetaInput } from './schema'

async function makeConfigDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tm-hist-'))
}

function makeMeta(overrides: Partial<HistoryMetaInput> = {}): HistoryMetaInput {
  return {
    timestamp: '2026-04-04T08.30.00Z',
    started_at: new Date('2026-04-04T08:30:00.000Z'),
    finished_at: new Date('2026-04-04T08:30:15.456Z'),
    exit_code: 0,
    timed_out: false,
    ...overrides,
  }
}

function makeArtifacts(
  overrides: Partial<RecordArtifacts> = {},
): RecordArtifacts {
  return {
    task_name: 'daily-audit',
    stdout: 'all good',
    stderr: '',
    prompt: 'Run the audit.',
    cwd: { path: '/tmp/fake', is_temp: false },
    ...overrides,
  }
}

describe('recordHistory', () => {
  test('writes meta.json with correct fields', async () => {
    const configDir = await makeConfigDir()
    const meta = makeMeta()
    const artifacts = makeArtifacts()

    const result = await recordHistory(meta, artifacts, { configDir })
    expect(result).toBeUndefined()

    const metaPath = path.join(
      configDir,
      'history',
      'daily-audit',
      '2026-04-04T08.30.00Z.meta.json',
    )
    const disk = JSON.parse(await fs.readFile(metaPath, 'utf-8'))
    expect(disk.timestamp).toBe('2026-04-04T08.30.00Z')
    expect(disk.started_at).toBe('2026-04-04T08:30:00.000Z')
    expect(disk.finished_at).toBe('2026-04-04T08:30:15.456Z')
    expect(disk.duration_ms).toBe(15456)
    expect(disk.exit_code).toBe(0)
    expect(disk.success).toBe(true)
  })

  test('computes success from exit_code', async () => {
    const configDir = await makeConfigDir()
    const meta = makeMeta({ exit_code: 1 })
    const artifacts = makeArtifacts()

    await recordHistory(meta, artifacts, { configDir })

    const metaPath = path.join(
      configDir,
      'history',
      'daily-audit',
      '2026-04-04T08.30.00Z.meta.json',
    )
    const disk = JSON.parse(await fs.readFile(metaPath, 'utf-8'))
    expect(disk.success).toBe(false)
    expect(disk.exit_code).toBe(1)
  })

  test('computes duration_ms from started_at and finished_at', async () => {
    const configDir = await makeConfigDir()
    const meta = makeMeta({
      started_at: new Date('2026-04-04T08:30:00.000Z'),
      finished_at: new Date('2026-04-04T08:30:42.123Z'),
    })
    const artifacts = makeArtifacts()

    await recordHistory(meta, artifacts, { configDir })

    const metaPath = path.join(
      configDir,
      'history',
      'daily-audit',
      '2026-04-04T08.30.00Z.meta.json',
    )
    const disk = JSON.parse(await fs.readFile(metaPath, 'utf-8'))
    expect(disk.duration_ms).toBe(42123)
  })

  test('writes stdout.txt always', async () => {
    const configDir = await makeConfigDir()

    await recordHistory(makeMeta(), makeArtifacts(), { configDir })

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

    await recordHistory(
      makeMeta(),
      makeArtifacts({ stderr: 'warning: something' }),
      { configDir },
    )

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

    await recordHistory(makeMeta(), makeArtifacts({ stderr: '' }), {
      configDir,
    })

    const stderrPath = path.join(
      configDir,
      'history',
      'daily-audit',
      '2026-04-04T08.30.00Z.stderr.txt',
    )
    expect(fs.access(stderrPath)).rejects.toThrow()
  })

  test('creates history directory if it does not exist', async () => {
    const configDir = await makeConfigDir()

    await recordHistory(makeMeta(), makeArtifacts({ task_name: 'new-task' }), {
      configDir,
    })

    const dir = path.join(configDir, 'history', 'new-task')
    const stat = await fs.stat(dir)
    expect(stat.isDirectory()).toBe(true)
  })

  test('success + temp dir: deletes temp dir', async () => {
    const configDir = await makeConfigDir()
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmaster-'))
    await fs.writeFile(path.join(tmpDir, 'artifact.txt'), 'data')

    await recordHistory(
      makeMeta({ exit_code: 0 }),
      makeArtifacts({ cwd: { path: tmpDir, is_temp: true } }),
      { configDir },
    )

    expect(fs.access(tmpDir)).rejects.toThrow()
  })

  test('failure + temp dir: moves to runs/ with artifacts', async () => {
    const configDir = await makeConfigDir()
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmaster-'))
    await fs.writeFile(path.join(tmpDir, 'work.txt'), 'claude work')

    await recordHistory(
      makeMeta({ exit_code: 1 }),
      makeArtifacts({
        stdout: 'partial output',
        stderr: 'error occurred',
        prompt: 'Do the audit.',
        cwd: { path: tmpDir, is_temp: true },
      }),
      { configDir },
    )

    const runsPath = path.join(
      configDir,
      'runs',
      'daily-audit',
      '2026-04-04T08.30.00Z',
    )
    expect(await fs.readFile(path.join(runsPath, 'prompt.md'), 'utf-8')).toBe(
      'Do the audit.',
    )
    expect(await fs.readFile(path.join(runsPath, 'stdout.txt'), 'utf-8')).toBe(
      'partial output',
    )
    expect(await fs.readFile(path.join(runsPath, 'stderr.txt'), 'utf-8')).toBe(
      'error occurred',
    )
    expect(await fs.readFile(path.join(runsPath, 'work.txt'), 'utf-8')).toBe(
      'claude work',
    )
    expect(fs.access(tmpDir)).rejects.toThrow()
  })

  test('explicit cwd + success: cwd untouched', async () => {
    const configDir = await makeConfigDir()
    const cwdDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-cwd-'))
    await fs.writeFile(path.join(cwdDir, 'keep.txt'), 'keep me')

    await recordHistory(
      makeMeta(),
      makeArtifacts({ cwd: { path: cwdDir, is_temp: false } }),
      { configDir },
    )

    expect(await fs.readFile(path.join(cwdDir, 'keep.txt'), 'utf-8')).toBe(
      'keep me',
    )
  })

  test('explicit cwd + failure: cwd untouched', async () => {
    const configDir = await makeConfigDir()
    const cwdDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-cwd-'))
    await fs.writeFile(path.join(cwdDir, 'keep.txt'), 'keep me')

    await recordHistory(
      makeMeta({ exit_code: 1 }),
      makeArtifacts({ cwd: { path: cwdDir, is_temp: false } }),
      { configDir },
    )

    expect(await fs.readFile(path.join(cwdDir, 'keep.txt'), 'utf-8')).toBe(
      'keep me',
    )
  })

  test('timed-out run records timed_out: true and exit_code: 124', async () => {
    const configDir = await makeConfigDir()

    await recordHistory(
      makeMeta({ exit_code: 124, timed_out: true }),
      makeArtifacts(),
      { configDir },
    )

    const metaPath = path.join(
      configDir,
      'history',
      'daily-audit',
      '2026-04-04T08.30.00Z.meta.json',
    )
    const disk = JSON.parse(await fs.readFile(metaPath, 'utf-8'))
    expect(disk.timed_out).toBe(true)
    expect(disk.exit_code).toBe(124)
    expect(disk.success).toBe(false)
  })

  test('non-timed-out run records timed_out: false', async () => {
    const configDir = await makeConfigDir()

    await recordHistory(makeMeta({ exit_code: 0 }), makeArtifacts(), {
      configDir,
    })

    const metaPath = path.join(
      configDir,
      'history',
      'daily-audit',
      '2026-04-04T08.30.00Z.meta.json',
    )
    const disk = JSON.parse(await fs.readFile(metaPath, 'utf-8'))
    expect(disk.timed_out).toBe(false)
    expect(disk.exit_code).toBe(0)
    expect(disk.success).toBe(true)
  })

  test('returns HistoryWriteError on filesystem failure', async () => {
    const result = await recordHistory(makeMeta(), makeArtifacts(), {
      configDir: '/nonexistent/path/xyz',
    })
    expect(result).toBeInstanceOf(HistoryWriteError)
  })
})
