import { describe, expect, test } from 'bun:test'

import { defaultSpawnAgent } from './run'

describe('defaultSpawnAgent (integration)', () => {
  test('kills entire process group including child processes', async () => {
    const result = await defaultSpawnAgent({
      command: 'sleep 60 & echo $!; wait',
      cwd: '/tmp',
      env: { PATH: process.env.PATH ?? '' },
      timeoutMs: 1000,
    })

    expect(result.timedOut).toBe(true)

    // Extract grandchild PID from stdout
    const grandchildPid = parseInt(result.stdout.trim())
    expect(grandchildPid).toBeGreaterThan(0)

    // Grandchild should be dead (killed with the process group)
    expect(() => process.kill(grandchildPid, 0)).toThrow()
  })
})
