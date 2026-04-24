import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import fsa from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runIdSchema } from '#src/history'

import {
  type RunningMarker,
  RunningMarkerSchema,
  readRunningMarker,
} from './marker'

async function makeTmpDir(): Promise<string> {
  return fsa.mkdtemp(path.join(os.tmpdir(), 'tm-marker-'))
}

function writeLockFile(
  locksDir: string,
  taskName: string,
  content: string,
): void {
  fs.mkdirSync(locksDir, { recursive: true })
  fs.writeFileSync(path.join(locksDir, `${taskName}.lock`), content)
}

const validMarker: RunningMarker = {
  pid: process.pid,
  started_at: '2026-04-09T10:00:00.000Z',
  timestamp: runIdSchema.parse('2026-04-09T10.00.00Z'),
}

describe('RunningMarkerSchema', () => {
  test('parses valid marker', () => {
    const result = RunningMarkerSchema.safeParse(validMarker)
    expect(result.success).toBe(true)
  })

  test('rejects missing pid', () => {
    const result = RunningMarkerSchema.safeParse({
      started_at: '2026-04-09T10:00:00.000Z',
      timestamp: '2026-04-09T10.00.00Z',
    })
    expect(result.success).toBe(false)
  })

  test('rejects non-ISO started_at', () => {
    const result = RunningMarkerSchema.safeParse({
      pid: 123,
      started_at: 'not-a-date',
      timestamp: '2026-04-09T10.00.00Z',
    })
    expect(result.success).toBe(false)
  })

  test('rejects missing timestamp', () => {
    const result = RunningMarkerSchema.safeParse({
      pid: 123,
      started_at: '2026-04-09T10:00:00.000Z',
    })
    expect(result.success).toBe(false)
  })

  test('rejects malformed timestamp (ISO with colons)', () => {
    const result = RunningMarkerSchema.safeParse({
      pid: 123,
      started_at: '2026-04-09T10:00:00.000Z',
      timestamp: '2026-04-09T10:00:00Z',
    })
    expect(result.success).toBe(false)
  })
})

describe('readRunningMarker', () => {
  test('returns marker when lock file contains valid JSON and PID is alive', async () => {
    const dir = await makeTmpDir()
    writeLockFile(dir, 'my-task', JSON.stringify(validMarker))

    const result = readRunningMarker('my-task', dir)
    expect(result).toEqual(validMarker)
  })

  test('returns null when lock file does not exist', async () => {
    const dir = await makeTmpDir()
    const result = readRunningMarker('no-such-task', dir)
    expect(result).toBeNull()
  })

  test('returns null when lock file is empty', async () => {
    const dir = await makeTmpDir()
    writeLockFile(dir, 'empty-task', '')

    const result = readRunningMarker('empty-task', dir)
    expect(result).toBeNull()
  })

  test('returns null on invalid JSON (partial write)', async () => {
    const dir = await makeTmpDir()
    writeLockFile(dir, 'corrupt', '{"pid":12')

    const result = readRunningMarker('corrupt', dir)
    expect(result).toBeNull()
  })

  test('returns null when JSON does not match schema', async () => {
    const dir = await makeTmpDir()
    writeLockFile(dir, 'bad-schema', JSON.stringify({ foo: 'bar' }))

    const result = readRunningMarker('bad-schema', dir)
    expect(result).toBeNull()
  })

  test('returns null when PID is dead (stale marker)', async () => {
    const dir = await makeTmpDir()
    const staleMarker = { ...validMarker, pid: 999999 }
    writeLockFile(dir, 'stale', JSON.stringify(staleMarker))

    const result = readRunningMarker('stale', dir, {
      isProcessAlive: () => false,
    })
    expect(result).toBeNull()
  })

  test('uses injected isProcessAlive for PID check', async () => {
    const dir = await makeTmpDir()
    writeLockFile(dir, 'alive-check', JSON.stringify(validMarker))

    const checkedPids: number[] = []
    const result = readRunningMarker('alive-check', dir, {
      isProcessAlive: (pid) => {
        checkedPids.push(pid)
        return true
      },
    })

    expect(result).toEqual(validMarker)
    expect(checkedPids).toEqual([process.pid])
  })

  test('returns null when locksDir does not exist', async () => {
    const result = readRunningMarker('task', '/nonexistent/dir/locks')
    expect(result).toBeNull()
  })
})
