import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import * as errore from 'errore'

import { log, readLog, serializeError } from './logger'

function makeTempLogFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-logger-'))
  return path.join(dir, 'taskmaster.log')
}

function readLines(logFile: string): Record<string, unknown>[] {
  return fs
    .readFileSync(logFile, 'utf-8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}

describe('serializeError', () => {
  test('includes name, message, and template variables', () => {
    class TestError extends errore.createTaggedError({
      name: 'TestError',
      message: 'broke for $taskName',
    }) {}

    const result = serializeError(new TestError({ taskName: 'my-task' }))

    expect(result).toEqual({
      name: 'TestError',
      message: 'broke for my-task',
      taskName: 'my-task',
    })
  })

  test('excludes _tag, messageTemplate, and stack', () => {
    class TestError extends errore.createTaggedError({
      name: 'TestError',
      message: 'oops',
    }) {}

    const result = serializeError(new TestError())

    expect(result).not.toHaveProperty('_tag')
    expect(result).not.toHaveProperty('messageTemplate')
    expect(result).not.toHaveProperty('stack')
  })

  test('works with plain Error', () => {
    const err = new Error('plain')
    const result = serializeError(err)
    expect(result).toEqual({ name: 'Error', message: 'plain' })
  })
})

describe('log', () => {
  test('writes started event as JSONL', () => {
    const logFile = makeTempLogFile()

    log({ event: 'started', task: 'my-task', trigger: 'manual' }, logFile)

    const lines = readLines(logFile)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      event: 'started',
      task: 'my-task',
      trigger: 'manual',
    })
    expect(lines[0]!['ts']).toBeString()
  })

  test('writes skipped event with contention reason', () => {
    const logFile = makeTempLogFile()

    log({ event: 'skipped', task: 'my-task', reason: 'contention' }, logFile)

    const lines = readLines(logFile)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      event: 'skipped',
      task: 'my-task',
      reason: 'contention',
    })
  })

  test('writes skipped event with offline reason', () => {
    const logFile = makeTempLogFile()

    log({ event: 'skipped', task: 'my-task', reason: 'offline' }, logFile)

    const entries = readLog(new Date(0), logFile)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      event: 'skipped',
      task: 'my-task',
      reason: 'offline',
    })
  })

  test('writes error event with serialized error', () => {
    const logFile = makeTempLogFile()

    class SomeError extends errore.createTaggedError({
      name: 'SomeError',
      message: 'failed for $taskName',
    }) {}

    log(
      {
        event: 'error',
        task: 'my-task',
        error: new SomeError({ taskName: 'my-task' }),
      },
      logFile,
    )

    const lines = readLines(logFile)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      event: 'error',
      task: 'my-task',
      error: {
        name: 'SomeError',
        message: 'failed for my-task',
        taskName: 'my-task',
      },
    })
  })

  test('writes started event with dispatch trigger', () => {
    const logFile = makeTempLogFile()

    log({ event: 'started', task: 'my-task', trigger: 'dispatch' }, logFile)

    const entries = readLog(new Date(0), logFile)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      event: 'started',
      task: 'my-task',
      trigger: 'dispatch',
    })
  })

  test('writes skipped event with disabled reason', () => {
    const logFile = makeTempLogFile()

    log({ event: 'skipped', task: 'my-task', reason: 'disabled' }, logFile)

    const entries = readLog(new Date(0), logFile)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      event: 'skipped',
      task: 'my-task',
      reason: 'disabled',
    })
  })

  test('appends multiple entries', () => {
    const logFile = makeTempLogFile()

    log({ event: 'started', task: 'a', trigger: 'tick' }, logFile)
    log({ event: 'started', task: 'b', trigger: 'manual' }, logFile)

    const lines = readLines(logFile)
    expect(lines).toHaveLength(2)
    expect(lines[0]!['task']).toBe('a')
    expect(lines[1]!['task']).toBe('b')
  })

  test('writes to stderr on unwritable path', () => {
    const stderrChunks: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk))
      return true
    }
    try {
      log(
        { event: 'started', task: 'test', trigger: 'manual' },
        '/proc/nonexistent/impossible/taskmaster.log',
      )
      expect(stderrChunks.join('')).toContain('log write failed')
    } finally {
      process.stderr.write = origWrite
    }
  })
})

describe('readLog', () => {
  test('parses valid JSONL entries', () => {
    const logFile = makeTempLogFile()

    log({ event: 'started', task: 'my-task', trigger: 'manual' }, logFile)
    log({ event: 'skipped', task: 'my-task', reason: 'contention' }, logFile)
    log(
      {
        event: 'error',
        task: 'my-task',
        error: new Error('boom'),
      },
      logFile,
    )

    const entries = readLog(new Date(0), logFile)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({
      event: 'started',
      task: 'my-task',
      trigger: 'manual',
    })
    expect(entries[1]).toMatchObject({
      event: 'skipped',
      task: 'my-task',
      reason: 'contention',
    })
    const errorEntry = entries[2]!
    expect(errorEntry).toMatchObject({ event: 'error', task: 'my-task' })
    expect(errorEntry.ts).toBeString()
    if (errorEntry.event === 'error') {
      expect(errorEntry.error['message']).toBe('boom')
    }
  })

  test('filters entries by time window', () => {
    const logFile = makeTempLogFile()

    // Write entries with known timestamps by writing raw JSONL
    const old = JSON.stringify({
      ts: '2026-01-01T00:00:00.000Z',
      event: 'started',
      task: 'old',
      trigger: 'tick',
    })
    const recent = JSON.stringify({
      ts: '2026-04-01T00:00:00.000Z',
      event: 'started',
      task: 'recent',
      trigger: 'tick',
    })
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    fs.writeFileSync(logFile, old + '\n' + recent + '\n')

    const entries = readLog(new Date('2026-03-01T00:00:00.000Z'), logFile)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.task).toBe('recent')
  })

  test('rejects non-ISO timestamp', () => {
    const logFile = makeTempLogFile()
    fs.mkdirSync(path.dirname(logFile), { recursive: true })

    const nonIso = JSON.stringify({
      ts: 'last Tuesday',
      event: 'started',
      task: 'bad-ts',
      trigger: 'manual',
    })
    const valid = JSON.stringify({
      ts: '2026-04-01T00:00:00.000Z',
      event: 'started',
      task: 'ok',
      trigger: 'manual',
    })
    fs.writeFileSync(logFile, [nonIso, valid].join('\n') + '\n')

    const entries = readLog(new Date(0), logFile)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.task).toBe('ok')
  })

  test('skips malformed lines', () => {
    const logFile = makeTempLogFile()
    fs.mkdirSync(path.dirname(logFile), { recursive: true })

    const valid = JSON.stringify({
      ts: '2026-04-01T00:00:00.000Z',
      event: 'started',
      task: 'ok',
      trigger: 'manual',
    })
    fs.writeFileSync(
      logFile,
      [
        'not json at all',
        '{"partial": true}',
        valid,
        '{"event": "started", "task": "missing-ts", "trigger": "tick"}',
      ].join('\n') + '\n',
    )

    const entries = readLog(new Date(0), logFile)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.task).toBe('ok')
  })

  test('returns empty array for missing file (ENOENT)', () => {
    const entries = readLog(new Date(0), '/tmp/nonexistent-tm-log.jsonl')
    expect(entries).toHaveLength(0)
  })

  test('warns on stderr for non-ENOENT read errors', () => {
    // Use a directory path — readFileSync on a directory throws EISDIR
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-logger-'))
    const stderrChunks: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrChunks.push(String(chunk))
      return true
    }
    try {
      const entries = readLog(new Date(0), dir)
      expect(entries).toHaveLength(0)
      expect(stderrChunks.join('')).toContain('log read failed')
    } finally {
      process.stderr.write = origWrite
    }
  })

  test('returns empty array for empty file', () => {
    const logFile = makeTempLogFile()
    fs.mkdirSync(path.dirname(logFile), { recursive: true })
    fs.writeFileSync(logFile, '')

    const entries = readLog(new Date(0), logFile)
    expect(entries).toHaveLength(0)
  })
})
