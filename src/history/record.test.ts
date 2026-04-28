import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { RecordArtifacts } from './record'
import { HistoryWriteError, recordHistory } from './record'
import type { HistoryMetaInput } from './schema'
import { runIdSchema } from './timestamp'

async function makeConfigDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tm-hist-'))
}

function makeMeta(overrides: Partial<HistoryMetaInput> = {}): HistoryMetaInput {
  return {
    timestamp: runIdSchema.parse('2026-04-04T08.30.00Z'),
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
    output: 'all good',
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

  test('writes output.txt', async () => {
    const configDir = await makeConfigDir()

    await recordHistory(makeMeta(), makeArtifacts(), { configDir })

    const outputPath = path.join(
      configDir,
      'history',
      'daily-audit',
      '2026-04-04T08.30.00Z.output.txt',
    )
    expect(await fs.readFile(outputPath, 'utf-8')).toBe('all good')
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

  test('skipped-preflight + temp dir: deletes temp dir, no runs/ archive', async () => {
    const configDir = await makeConfigDir()
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmaster-'))
    await fs.writeFile(path.join(tmpDir, 'artifact.txt'), 'data')

    await recordHistory(
      {
        timestamp: runIdSchema.parse('2026-04-04T08.30.00Z'),
        started_at: new Date('2026-04-04T08:30:00.000Z'),
        finished_at: new Date('2026-04-04T08:30:00.050Z'),
        status: 'skipped-preflight',
        preflight: {
          exit_code: 1,
          duration_ms: 50,
          stdout_bytes: 0,
          stderr_bytes: 0,
        },
      },
      makeArtifacts({ cwd: { path: tmpDir, is_temp: true } }),
      { configDir },
    )

    expect(fs.access(tmpDir)).rejects.toThrow()
    expect(
      fs.access(path.join(configDir, 'runs', 'daily-audit')),
    ).rejects.toThrow()
  })

  test('preflight-error + temp dir: deletes temp dir, no runs/ archive', async () => {
    const configDir = await makeConfigDir()
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmaster-'))

    await recordHistory(
      {
        timestamp: runIdSchema.parse('2026-04-04T08.30.00Z'),
        started_at: new Date('2026-04-04T08:30:00.000Z'),
        finished_at: new Date('2026-04-04T08:30:00.050Z'),
        status: 'preflight-error',
        preflight: {
          exit_code: 2,
          duration_ms: 50,
          stdout_bytes: 0,
          stderr_bytes: 0,
          error_reason: 'nonzero',
        },
      },
      makeArtifacts({ cwd: { path: tmpDir, is_temp: true } }),
      { configDir },
    )

    expect(fs.access(tmpDir)).rejects.toThrow()
    expect(
      fs.access(path.join(configDir, 'runs', 'daily-audit')),
    ).rejects.toThrow()
  })

  test('failure + temp dir: moves to runs/ with artifacts', async () => {
    const configDir = await makeConfigDir()
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taskmaster-'))
    await fs.writeFile(path.join(tmpDir, 'work.txt'), 'claude work')

    await recordHistory(
      makeMeta({ exit_code: 1 }),
      makeArtifacts({
        output: 'partial output\nerror occurred',
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
    expect(await fs.readFile(path.join(runsPath, 'output.txt'), 'utf-8')).toBe(
      'partial output\nerror occurred',
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

  test('skips writing output.txt when outputPrewritten is true', async () => {
    const configDir = await makeConfigDir()
    const histDir = path.join(configDir, 'history', 'daily-audit')
    await fs.mkdir(histDir, { recursive: true })

    // Pre-write the output file (simulating fd passthrough)
    const outputPath = path.join(histDir, '2026-04-04T08.30.00Z.output.txt')
    await fs.writeFile(outputPath, 'streamed content')

    await recordHistory(makeMeta(), makeArtifacts({ outputPrewritten: true }), {
      configDir,
    })

    // Output file should still have the pre-written content, not be overwritten
    expect(await fs.readFile(outputPath, 'utf-8')).toBe('streamed content')

    // Meta file should still be written
    const metaPath = path.join(histDir, '2026-04-04T08.30.00Z.meta.json')
    const disk = JSON.parse(await fs.readFile(metaPath, 'utf-8'))
    expect(disk.timestamp).toBe('2026-04-04T08.30.00Z')
  })

  test('returns HistoryWriteError on filesystem failure', async () => {
    const result = await recordHistory(makeMeta(), makeArtifacts(), {
      configDir: '/nonexistent/path/xyz',
    })
    expect(result).toBeInstanceOf(HistoryWriteError)
  })
})
