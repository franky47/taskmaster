import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import fsa from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runIdSchema } from '#src/history'

import { acquireTaskLock, releaseLock } from './lock'
import { readRunningMarker, writeRunningMarker } from './marker'

async function makeTmpDir(): Promise<string> {
  return fsa.mkdtemp(path.join(os.tmpdir(), 'tm-lock-'))
}

describe('acquireTaskLock', () => {
  test('acquires lock on new file', async () => {
    const dir = await makeTmpDir()
    const result = acquireTaskLock('test-task', dir)

    expect(result).not.toBeInstanceOf(Error)
    expect('fd' in result && result.fd).toBeGreaterThan(0)

    // Cleanup
    if ('fd' in result) releaseLock(result.fd)
  })

  test('second acquire on same task returns contended', async () => {
    const dir = await makeTmpDir()

    const first = acquireTaskLock('my-task', dir)
    expect('fd' in first).toBe(true)

    const second = acquireTaskLock('my-task', dir)
    expect('contended' in second).toBe(true)

    // Cleanup
    if ('fd' in first) releaseLock(first.fd)
  })

  test('release allows re-acquisition', async () => {
    const dir = await makeTmpDir()

    const first = acquireTaskLock('reuse-task', dir)
    expect('fd' in first).toBe(true)
    if ('fd' in first) releaseLock(first.fd)

    const second = acquireTaskLock('reuse-task', dir)
    expect('fd' in second).toBe(true)

    if ('fd' in second) releaseLock(second.fd)
  })

  test('creates locks directory if missing', async () => {
    const base = await makeTmpDir()
    const locksDir = path.join(base, 'nested', 'locks')

    const result = acquireTaskLock('mkdir-task', locksDir)
    expect('fd' in result).toBe(true)
    expect(fs.existsSync(locksDir)).toBe(true)

    if ('fd' in result) releaseLock(result.fd)
  })

  test('creates lock file at correct path', async () => {
    const dir = await makeTmpDir()
    const result = acquireTaskLock('path-check', dir)

    expect(fs.existsSync(path.join(dir, 'path-check.lock'))).toBe(true)

    if ('fd' in result) releaseLock(result.fd)
  })

  test('[Symbol.dispose] releases the lock', async () => {
    const dir = await makeTmpDir()
    const first = acquireTaskLock('dispose-task', dir)
    expect('fd' in first).toBe(true)

    // Dispose should release the lock
    if ('fd' in first && Symbol.dispose in first) {
      first[Symbol.dispose]()
    }

    // Should be re-acquirable after dispose
    const second = acquireTaskLock('dispose-task', dir)
    expect('fd' in second).toBe(true)
    expect('contended' in second).toBe(false)

    if ('fd' in second) releaseLock(second.fd)
  })

  test('different tasks do not contend', async () => {
    const dir = await makeTmpDir()

    const a = acquireTaskLock('task-a', dir)
    const b = acquireTaskLock('task-b', dir)

    expect('fd' in a).toBe(true)
    expect('fd' in b).toBe(true)

    if ('fd' in a) releaseLock(a.fd)
    if ('fd' in b) releaseLock(b.fd)
  })

  test('contending acquire does not wipe the running marker', async () => {
    const dir = await makeTmpDir()
    const taskName = 'long-task'

    // Simulate process A acquiring the lock and writing a marker
    const holder = acquireTaskLock(taskName, dir)
    expect('fd' in holder).toBe(true)
    if (!('fd' in holder)) return

    const marker = {
      pid: process.pid,
      started_at: '2026-04-09T10:00:00.000Z',
      timestamp: runIdSchema.parse('2026-04-09T10.00.00Z'),
    }
    writeRunningMarker(holder.fd, marker)

    // Verify marker is readable before contention
    const before = readRunningMarker(taskName, dir)
    expect(before).toEqual(marker)

    // Simulate process B trying (and failing) to acquire the same lock
    const contender = acquireTaskLock(taskName, dir)
    expect('contended' in contender).toBe(true)

    // The marker written by process A must still be readable
    const after = readRunningMarker(taskName, dir)
    expect(after).toEqual(marker)

    releaseLock(holder.fd)
  })
})
