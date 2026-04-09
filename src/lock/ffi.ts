import { dlopen, read } from 'bun:ffi'

// flock(2) constants — same on macOS and Linux
export const LOCK_EX = 2
export const LOCK_NB = 4

// EWOULDBLOCK differs by platform
export const EWOULDBLOCK = process.platform === 'darwin' ? 35 : 11

const libcName =
  process.platform === 'darwin' ? 'libSystem.B.dylib' : 'libc.so.6'

const flockLib = dlopen(libcName, {
  flock: { args: ['i32', 'i32'], returns: 'i32' },
})

// Thread-local errno access differs by platform: macOS exposes __error(),
// Linux exposes __errno_location(). Per-platform branches keep symbols
// properly typed without computed keys or type assertions.
function makeGetErrno(): () => number {
  if (process.platform === 'darwin') {
    const lib = dlopen('libSystem.B.dylib', {
      __error: { args: [], returns: 'ptr' },
    })
    return () => {
      const ptr = lib.symbols.__error()
      if (ptr === null) return -1
      return read.i32(ptr)
    }
  }
  const lib = dlopen('libc.so.6', {
    __errno_location: { args: [], returns: 'ptr' },
  })
  return () => {
    const ptr = lib.symbols.__errno_location()
    if (ptr === null) return -1
    return read.i32(ptr)
  }
}

export function flock(fd: number, operation: number): number {
  return flockLib.symbols.flock(fd, operation)
}

export const getErrno = makeGetErrno()
