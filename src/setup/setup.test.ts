import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  SchedulerCommandError,
  UnsupportedPlatformError,
  isSchedulerInstalled,
  setup,
  teardown,
} from './setup'
import type { ExecFn, ExecResult } from './setup'

const PLIST_LABEL = 'com.47ng.taskmaster.tick'
const PLIST_FILENAME = `${PLIST_LABEL}.plist`
const TM_COMMAND = ['/usr/local/bin/tm']

function ok(exitCode = 0, stdout = '', stderr = ''): ExecResult {
  return { exitCode, stdout, stderr }
}

function recorder(): {
  calls: Array<{ cmd: string; args: string[]; stdin?: string }>
  exec: ExecFn
} {
  const calls: Array<{ cmd: string; args: string[]; stdin?: string }> = []
  const exec: ExecFn = async (cmd, args, stdin) => {
    calls.push({ cmd, args, stdin })
    return ok()
  }
  return { calls, exec }
}

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tm-setup-'))
}

// -- macOS setup --

describe('setup (macOS)', () => {
  test('creates plist with StartCalendarInterval and RunAtLoad (S9.1)', async () => {
    const dir = await makeTmpDir()
    const { exec } = recorder()

    const result = await setup({
      platform: 'darwin',
      tmCommand: TM_COMMAND,
      launchAgentsDir: dir,
      exec,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const plist = await fs.readFile(path.join(dir, PLIST_FILENAME), 'utf-8')
    expect(plist).toContain('<key>StartCalendarInterval</key>')
    expect(plist).toContain('<key>Second</key>')
    expect(plist).toContain('<integer>0</integer>')
    expect(plist).toContain('<key>RunAtLoad</key>')
    expect(plist).toContain('<true/>')
    expect(plist).toContain(`<string>${PLIST_LABEL}</string>`)
  })

  test('loads plist via launchctl (S9.2)', async () => {
    const dir = await makeTmpDir()
    const { calls, exec } = recorder()

    await setup({
      platform: 'darwin',
      tmCommand: TM_COMMAND,
      launchAgentsDir: dir,
      exec,
    })

    const loadCall = calls.find(
      (c) => c.cmd === 'launchctl' && c.args[0] === 'load',
    )
    expect(loadCall).toBeDefined()
    expect(loadCall!.args[1]).toBe(path.join(dir, PLIST_FILENAME))
  })

  test('is idempotent: running twice does not re-load (S9.4)', async () => {
    const dir = await makeTmpDir()
    const { calls, exec } = recorder()

    const first = await setup({
      platform: 'darwin',
      tmCommand: TM_COMMAND,
      launchAgentsDir: dir,
      exec,
    })
    expect(first).not.toBeInstanceOf(Error)
    if (first instanceof Error) return
    expect(first.installed).toBe(true)

    const second = await setup({
      platform: 'darwin',
      tmCommand: TM_COMMAND,
      launchAgentsDir: dir,
      exec,
    })
    expect(second).not.toBeInstanceOf(Error)
    if (second instanceof Error) return
    expect(second.installed).toBe(false)

    // launchctl load should only have been called once
    const loadCalls = calls.filter(
      (c) => c.cmd === 'launchctl' && c.args[0] === 'load',
    )
    expect(loadCalls).toHaveLength(1)
  })

  test('resolves tm binary path in plist ProgramArguments (S9.8)', async () => {
    const dir = await makeTmpDir()
    const { exec } = recorder()

    await setup({
      platform: 'darwin',
      tmCommand: ['/usr/local/bin/bun', '/home/user/taskmaster/src/main.ts'],
      launchAgentsDir: dir,
      exec,
    })

    const plist = await fs.readFile(path.join(dir, PLIST_FILENAME), 'utf-8')
    expect(plist).toContain('<string>/usr/local/bin/bun</string>')
    expect(plist).toContain(
      '<string>/home/user/taskmaster/src/main.ts</string>',
    )
    expect(plist).toContain('<string>tick</string>')
  })

  test('escapes XML special characters in paths (S9.8)', async () => {
    const dir = await makeTmpDir()
    const { exec } = recorder()

    await setup({
      platform: 'darwin',
      tmCommand: ['/home/Tom & Jerry/bin/tm'],
      launchAgentsDir: dir,
      exec,
    })

    const plist = await fs.readFile(path.join(dir, PLIST_FILENAME), 'utf-8')
    expect(plist).toContain('<string>/home/Tom &amp; Jerry/bin/tm</string>')
    expect(plist).not.toContain('Tom & Jerry')
  })

  test('returns method: launchd', async () => {
    const dir = await makeTmpDir()
    const { exec } = recorder()

    const result = await setup({
      platform: 'darwin',
      tmCommand: TM_COMMAND,
      launchAgentsDir: dir,
      exec,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.method).toBe('launchd')
  })

  test('returns SchedulerCommandError when launchctl load fails', async () => {
    const dir = await makeTmpDir()
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'launchctl' && args[0] === 'load') {
        return ok(1, '', 'Could not load plist')
      }
      return ok()
    }

    const result = await setup({
      platform: 'darwin',
      tmCommand: TM_COMMAND,
      launchAgentsDir: dir,
      exec,
    })

    expect(result).toBeInstanceOf(SchedulerCommandError)
  })

  test('returns UnsupportedPlatformError for unknown platform', async () => {
    const { exec } = recorder()
    const result = await setup({
      // @ts-expect-error — intentionally passing invalid platform to test error path
      platform: 'freebsd',
      tmCommand: TM_COMMAND,
      exec,
    })
    expect(result).toBeInstanceOf(UnsupportedPlatformError)
  })
})

// -- Linux setup --

describe('setup (Linux)', () => {
  test('adds crontab entry (S9.3)', async () => {
    const { calls, exec } = recorder()

    const result = await setup({
      platform: 'linux',
      tmCommand: TM_COMMAND,
      exec,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    // Should read existing crontab, then write new one
    const readCall = calls.find(
      (c) => c.cmd === 'crontab' && c.args.includes('-l'),
    )
    expect(readCall).toBeDefined()

    const writeCall = calls.find(
      (c) => c.cmd === 'crontab' && c.args.includes('-'),
    )
    expect(writeCall).toBeDefined()
    expect(writeCall!.stdin).toContain('* * * * * /usr/local/bin/tm tick')
  })

  test('is idempotent: entry already exists (S9.4)', async () => {
    const existingCrontab = `# some stuff\n* * * * * /usr/local/bin/tm tick\n`
    const calls: Array<{ cmd: string; args: string[]; stdin?: string }> = []
    const exec: ExecFn = async (cmd, args, stdin) => {
      calls.push({ cmd, args, stdin })
      if (cmd === 'crontab' && args.includes('-l')) {
        return ok(0, existingCrontab)
      }
      return ok()
    }

    const result = await setup({
      platform: 'linux',
      tmCommand: TM_COMMAND,
      exec,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.installed).toBe(false)

    // Should NOT write a new crontab
    const writeCalls = calls.filter(
      (c) => c.cmd === 'crontab' && c.args.includes('-'),
    )
    expect(writeCalls).toHaveLength(0)
  })

  test('preserves existing crontab entries when adding (S9.3)', async () => {
    const existingCrontab = `0 5 * * * /usr/bin/backup\n`
    const calls: Array<{ cmd: string; args: string[]; stdin?: string }> = []
    const exec: ExecFn = async (cmd, args, stdin) => {
      calls.push({ cmd, args, stdin })
      if (cmd === 'crontab' && args.includes('-l')) {
        return ok(0, existingCrontab)
      }
      return ok()
    }

    await setup({
      platform: 'linux',
      tmCommand: TM_COMMAND,
      exec,
    })

    const writeCall = calls.find(
      (c) => c.cmd === 'crontab' && c.args.includes('-'),
    )
    expect(writeCall).toBeDefined()
    expect(writeCall!.stdin).toContain('0 5 * * * /usr/bin/backup')
    expect(writeCall!.stdin).toContain('* * * * * /usr/local/bin/tm tick')
  })

  test('handles empty crontab (no existing entries)', async () => {
    const calls: Array<{ cmd: string; args: string[]; stdin?: string }> = []
    const exec: ExecFn = async (cmd, args, stdin) => {
      calls.push({ cmd, args, stdin })
      if (cmd === 'crontab' && args.includes('-l')) {
        // crontab -l exits with 1 when there's no crontab
        return ok(1, '', 'no crontab for user')
      }
      return ok()
    }

    const result = await setup({
      platform: 'linux',
      tmCommand: TM_COMMAND,
      exec,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.installed).toBe(true)

    const writeCall = calls.find(
      (c) => c.cmd === 'crontab' && c.args.includes('-'),
    )
    expect(writeCall!.stdin).toContain('* * * * * /usr/local/bin/tm tick')
  })

  test('resolves tm binary path in crontab entry (S9.8)', async () => {
    const { calls, exec } = recorder()

    await setup({
      platform: 'linux',
      tmCommand: ['/usr/local/bin/bun', '/home/user/src/main.ts'],
      exec,
    })

    const writeCall = calls.find(
      (c) => c.cmd === 'crontab' && c.args.includes('-'),
    )
    expect(writeCall!.stdin).toContain(
      '* * * * * /usr/local/bin/bun /home/user/src/main.ts tick',
    )
  })

  test('shell-quotes paths with spaces in crontab entry', async () => {
    const { calls, exec } = recorder()

    await setup({
      platform: 'linux',
      tmCommand: ['/home/my user/bin/tm'],
      exec,
    })

    const writeCall = calls.find(
      (c) => c.cmd === 'crontab' && c.args.includes('-'),
    )
    expect(writeCall!.stdin).toContain("'/home/my user/bin/tm'")
  })

  test('returns SchedulerCommandError when crontab write fails', async () => {
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'crontab' && args.includes('-l')) {
        return ok(1, '', 'no crontab for user')
      }
      if (cmd === 'crontab' && args.includes('-')) {
        return ok(1, '', 'permission denied')
      }
      return ok()
    }

    const result = await setup({
      platform: 'linux',
      tmCommand: TM_COMMAND,
      exec,
    })

    expect(result).toBeInstanceOf(SchedulerCommandError)
  })

  test('returns method: crontab', async () => {
    const { exec } = recorder()

    const result = await setup({
      platform: 'linux',
      tmCommand: TM_COMMAND,
      exec,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.method).toBe('crontab')
  })
})

// -- macOS teardown --

describe('teardown (macOS)', () => {
  test('unloads and removes plist (S9.5)', async () => {
    const dir = await makeTmpDir()
    const { calls, exec } = recorder()

    // First set up
    await setup({
      platform: 'darwin',
      tmCommand: TM_COMMAND,
      launchAgentsDir: dir,
      exec,
    })

    // Verify plist exists
    const plistPath = path.join(dir, PLIST_FILENAME)
    expect(await fileExists(plistPath)).toBe(true)

    const result = await teardown({
      platform: 'darwin',
      launchAgentsDir: dir,
      exec,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.removed).toBe(true)

    // Should have called launchctl unload
    const unloadCall = calls.find(
      (c) => c.cmd === 'launchctl' && c.args[0] === 'unload',
    )
    expect(unloadCall).toBeDefined()
    expect(unloadCall!.args[1]).toBe(plistPath)

    // Plist file should be removed
    expect(await fileExists(plistPath)).toBe(false)
  })

  test('is idempotent: plist does not exist (S9.7)', async () => {
    const dir = await makeTmpDir()
    const { calls, exec } = recorder()

    const result = await teardown({
      platform: 'darwin',
      launchAgentsDir: dir,
      exec,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.removed).toBe(false)

    // Should NOT call launchctl
    const launchctlCalls = calls.filter((c) => c.cmd === 'launchctl')
    expect(launchctlCalls).toHaveLength(0)
  })

  test('returns method: launchd', async () => {
    const dir = await makeTmpDir()
    const { exec } = recorder()

    const result = await teardown({
      platform: 'darwin',
      launchAgentsDir: dir,
      exec,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.method).toBe('launchd')
  })
})

// -- Linux teardown --

describe('teardown (Linux)', () => {
  test('removes crontab entry (S9.6)', async () => {
    const existingCrontab = `0 5 * * * /usr/bin/backup\n* * * * * /usr/local/bin/tm tick\n`
    const calls: Array<{ cmd: string; args: string[]; stdin?: string }> = []
    const exec: ExecFn = async (cmd, args, stdin) => {
      calls.push({ cmd, args, stdin })
      if (cmd === 'crontab' && args.includes('-l')) {
        return ok(0, existingCrontab)
      }
      return ok()
    }

    const result = await teardown({
      platform: 'linux',
      tmCommand: TM_COMMAND,
      exec,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.removed).toBe(true)

    const writeCall = calls.find(
      (c) => c.cmd === 'crontab' && c.args.includes('-'),
    )
    expect(writeCall).toBeDefined()
    // Should preserve backup entry but remove our entry
    expect(writeCall!.stdin).toContain('0 5 * * * /usr/bin/backup')
    expect(writeCall!.stdin).not.toContain('tm tick')
  })

  test('is idempotent: entry does not exist (S9.7)', async () => {
    const existingCrontab = `0 5 * * * /usr/bin/backup\n`
    const calls: Array<{ cmd: string; args: string[]; stdin?: string }> = []
    const exec: ExecFn = async (cmd, args, stdin) => {
      calls.push({ cmd, args, stdin })
      if (cmd === 'crontab' && args.includes('-l')) {
        return ok(0, existingCrontab)
      }
      return ok()
    }

    const result = await teardown({
      platform: 'linux',
      tmCommand: TM_COMMAND,
      exec,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.removed).toBe(false)

    // Should NOT write a new crontab
    const writeCalls = calls.filter(
      (c) => c.cmd === 'crontab' && c.args.includes('-'),
    )
    expect(writeCalls).toHaveLength(0)
  })

  test('handles no existing crontab (S9.7)', async () => {
    const calls: Array<{ cmd: string; args: string[]; stdin?: string }> = []
    const exec: ExecFn = async (cmd, args, stdin) => {
      calls.push({ cmd, args, stdin })
      if (cmd === 'crontab' && args.includes('-l')) {
        return ok(1, '', 'no crontab for user')
      }
      return ok()
    }

    const result = await teardown({
      platform: 'linux',
      tmCommand: TM_COMMAND,
      exec,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.removed).toBe(false)
  })

  test('returns method: crontab', async () => {
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'crontab' && args.includes('-l')) {
        return ok(1, '', 'no crontab for user')
      }
      return ok()
    }

    const result = await teardown({
      platform: 'linux',
      tmCommand: TM_COMMAND,
      exec,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.method).toBe('crontab')
  })
})

// -- isSchedulerInstalled --

describe('isSchedulerInstalled (Linux)', () => {
  test('returns false when crontab line is a superset of expected entry', async () => {
    const supersetCrontab = `* * * * * /usr/local/bin/tm tick --extra-flag\n`
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'crontab' && args.includes('-l')) {
        return ok(0, supersetCrontab)
      }
      return ok()
    }

    const result = await isSchedulerInstalled({
      platform: 'linux',
      tmCommand: TM_COMMAND,
      exec,
    })

    expect(result).toBe(false)
  })

  test('returns true when crontab has exact entry', async () => {
    const exactCrontab = `0 5 * * * /usr/bin/backup\n* * * * * /usr/local/bin/tm tick\n`
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'crontab' && args.includes('-l')) {
        return ok(0, exactCrontab)
      }
      return ok()
    }

    const result = await isSchedulerInstalled({
      platform: 'linux',
      tmCommand: TM_COMMAND,
      exec,
    })

    expect(result).toBe(true)
  })
})

// -- Helpers --

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
