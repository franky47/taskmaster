import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import * as errore from 'errore'

import { log, serializeError } from './logger'

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
    expect(lines[0]!.ts).toBeString()
  })

  test('writes skipped event', () => {
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

  test('appends multiple entries', () => {
    const logFile = makeTempLogFile()

    log({ event: 'started', task: 'a', trigger: 'tick' }, logFile)
    log({ event: 'started', task: 'b', trigger: 'manual' }, logFile)

    const lines = readLines(logFile)
    expect(lines).toHaveLength(2)
    expect(lines[0]!.task).toBe('a')
    expect(lines[1]!.task).toBe('b')
  })

  test('does not throw on unwritable path', () => {
    expect(() => {
      log(
        { event: 'started', task: 'test', trigger: 'manual' },
        '/proc/nonexistent/impossible/taskmaster.log',
      )
    }).not.toThrow()
  })
})
