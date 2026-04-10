import fs from 'node:fs'
import path from 'node:path'

import * as errore from 'errore'

import * as ffi from './ffi'

// Types --

type LockAcquired = {
  fd: number
  [Symbol.dispose](): void
}

type LockContended = {
  contended: true
}

// Errors --

export class LockAcquireError extends errore.createTaggedError({
  name: 'LockAcquireError',
  message: 'Failed to acquire lock for task "$taskName": $reason',
}) {}

export class TaskContentionError extends errore.createTaggedError({
  name: 'TaskContentionError',
  message: 'Task "$taskName" is already running',
}) {}

// Public API --

function acquireLock(
  lockPath: string,
): LockAcquireError | LockContended | LockAcquired {
  const fd = fs.openSync(lockPath, 'w')

  const result = ffi.flock(fd, ffi.LOCK_EX | ffi.LOCK_NB)
  if (result === 0) {
    return {
      fd,
      [Symbol.dispose]() {
        fs.closeSync(fd)
      },
    }
  }

  // flock returned -1: check errno
  const errno = ffi.getErrno()
  fs.closeSync(fd)

  if (errno === ffi.EWOULDBLOCK) {
    return { contended: true }
  }

  return new LockAcquireError({
    taskName: path.basename(lockPath, '.lock'),
    reason: `flock failed with errno ${errno}`,
  })
}

export function acquireTaskLock(
  taskName: string,
  locksDir: string,
): LockAcquireError | LockContended | LockAcquired {
  fs.mkdirSync(locksDir, { recursive: true })
  return acquireLock(path.join(locksDir, `${taskName}.lock`))
}

export function releaseLock(fd: number): void {
  fs.closeSync(fd)
}
