import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { dispatch } from './dispatch'

async function makeConfigDir(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-dispatch-'))
  await fs.mkdir(path.join(tmp, 'tasks'), { recursive: true })
  return tmp
}

async function writeTask(
  configDir: string,
  name: string,
  content: string,
): Promise<void> {
  await fs.writeFile(path.join(configDir, 'tasks', `${name}.md`), content)
}

const EVENT_TASK = `---
on:
  event: deploy
agent: opencode
---

Deploy task prompt.
`

const EVENT_TASK_B = `---
on:
  event: deploy
agent: opencode
---

Another deploy task.
`

const DIFFERENT_EVENT = `---
on:
  event: build
agent: opencode
---

Build task.
`

const DISABLED_EVENT = `---
on:
  event: deploy
agent: opencode
enabled: false
---

Disabled deploy task.
`

const ALWAYS_EVENT = `---
on:
  event: deploy
agent: opencode
requires: []
---

Always-on deploy task.
`

const SCHEDULE_TASK = `---
on:
  schedule: "0 8 * * 1-5"
agent: opencode
---

Scheduled task.
`

describe('dispatch', () => {
  test('dispatches tasks matching the event name', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'deploy-task', EVENT_TASK)

    const spawned: Array<{ name: string; timestamp: string; args: string[] }> =
      []
    const result = await dispatch('deploy', {
      configDir,
      spawnRun: (name, timestamp, args) =>
        spawned.push({ name, timestamp, args }),
      probes: { network: async () => true },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.event).toBe('deploy')
    expect(result.dispatched).toEqual(['deploy-task'])
    expect(spawned).toHaveLength(1)
    expect(spawned[0]!.name).toBe('deploy-task')
  })

  test('dispatches multiple tasks subscribing to the same event', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'deploy-a', EVENT_TASK)
    await writeTask(configDir, 'deploy-b', EVENT_TASK_B)

    const spawned: Array<{ name: string }> = []
    const result = await dispatch('deploy', {
      configDir,
      spawnRun: (name) => spawned.push({ name }),
      probes: { network: async () => true },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['deploy-a', 'deploy-b'])
    expect(spawned).toHaveLength(2)
  })

  test('does not dispatch tasks with a different event', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'build-task', DIFFERENT_EVENT)

    const spawned: Array<{ name: string }> = []
    const result = await dispatch('deploy', {
      configDir,
      spawnRun: (name) => spawned.push({ name }),
      probes: { network: async () => true },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(result.skipped).toEqual([])
    expect(spawned).toEqual([])
  })

  test('does not dispatch schedule tasks', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'cron-task', SCHEDULE_TASK)

    const spawned: Array<{ name: string }> = []
    const result = await dispatch('deploy', {
      configDir,
      spawnRun: (name) => spawned.push({ name }),
      probes: { network: async () => true },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(spawned).toEqual([])
  })

  test('skips disabled tasks with reason', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'disabled-deploy', DISABLED_EVENT)

    const spawned: Array<{ name: string }> = []
    const result = await dispatch('deploy', {
      configDir,
      spawnRun: (name) => spawned.push({ name }),
      probes: { network: async () => true },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(result.skipped).toEqual([
      { name: 'disabled-deploy', reason: 'disabled' },
    ])
    expect(spawned).toEqual([])
  })

  test('skips network-requiring tasks when offline', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'cloud-deploy', EVENT_TASK) // defaults to requires: ['network']

    const spawned: Array<{ name: string }> = []
    const result = await dispatch('deploy', {
      configDir,
      spawnRun: (name) => spawned.push({ name }),
      probes: { network: async () => false },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(result.skipped).toEqual([
      {
        name: 'cloud-deploy',
        reason: 'requirement-unmet',
        requirement: ['network'],
      },
    ])
    expect(spawned).toEqual([])
  })

  test('dispatches tasks with no network requirement even when offline', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'always-deploy', ALWAYS_EVENT)

    const spawned: Array<{ name: string }> = []
    const result = await dispatch('deploy', {
      configDir,
      spawnRun: (name) => spawned.push({ name }),
      probes: { network: async () => false },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['always-deploy'])
    expect(result.skipped).toEqual([])
    expect(spawned).toHaveLength(1)
  })

  test('skips network probe when no matching task requires network', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'always-deploy', ALWAYS_EVENT)

    let probeCalled = false
    const result = await dispatch('deploy', {
      configDir,
      spawnRun: () => {},
      probes: {
        network: async () => {
          probeCalled = true
          return false
        },
      },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['always-deploy'])
    expect(probeCalled).toBe(false)
  })

  test('returns empty result for event with no subscribers (not an error)', async () => {
    const configDir = await makeConfigDir()

    const result = await dispatch('nonexistent', {
      configDir,
      spawnRun: () => {},
      probes: { network: async () => true },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.event).toBe('nonexistent')
    expect(result.dispatched).toEqual([])
    expect(result.skipped).toEqual([])
  })

  test('passes --trigger dispatch and --event flags via extra args', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'deploy-task', EVENT_TASK)

    const spawned: Array<{ name: string; args: string[] }> = []
    await dispatch('deploy', {
      configDir,
      spawnRun: (name, _ts, args) => spawned.push({ name, args }),
      probes: { network: async () => true },
    })

    expect(spawned).toHaveLength(1)
    expect(spawned[0]!.args).toContain('--trigger')
    expect(spawned[0]!.args).toContain('dispatch')
    expect(spawned[0]!.args).toContain('--event')
    expect(spawned[0]!.args).toContain('deploy')
  })

  test('passes --payload-file flag when payload provided', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'deploy-task', EVENT_TASK)

    const spawned: Array<{ name: string; args: string[] }> = []
    await dispatch('deploy', {
      configDir,
      payload: 'deployment context',
      spawnRun: (name, _ts, args) => spawned.push({ name, args }),
      probes: { network: async () => true },
    })

    expect(spawned).toHaveLength(1)
    const args = spawned[0]!.args
    const payloadIdx = args.indexOf('--payload-file')
    expect(payloadIdx).toBeGreaterThanOrEqual(0)

    // Verify the payload file was written with correct content
    const payloadPath = args[payloadIdx + 1]!
    const content = await fs.readFile(payloadPath, 'utf-8')
    expect(content).toBe('deployment context')
  })

  test('writes a separate payload file per dispatched task', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'deploy-a', EVENT_TASK)
    await writeTask(configDir, 'deploy-b', EVENT_TASK_B)

    const spawned: Array<{ name: string; args: string[] }> = []
    await dispatch('deploy', {
      configDir,
      payload: 'shared context',
      spawnRun: (name, _ts, args) => spawned.push({ name, args }),
      probes: { network: async () => true },
    })

    expect(spawned).toHaveLength(2)

    const payloadPaths = spawned.map((s) => {
      const idx = s.args.indexOf('--payload-file')
      expect(idx).toBeGreaterThanOrEqual(0)
      return s.args[idx + 1]!
    })

    // Each task must get its own file so children can safely unlink
    expect(payloadPaths[0]).not.toBe(payloadPaths[1])

    // Both files should contain the same payload
    for (const p of payloadPaths) {
      const content = await fs.readFile(p, 'utf-8')
      expect(content).toBe('shared context')
    }
  })

  test('does not pass --payload-file when no payload', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'deploy-task', EVENT_TASK)

    const spawned: Array<{ args: string[] }> = []
    await dispatch('deploy', {
      configDir,
      spawnRun: (_name, _ts, args) => spawned.push({ args }),
      probes: { network: async () => true },
    })

    expect(spawned).toHaveLength(1)
    expect(spawned[0]!.args).not.toContain('--payload-file')
  })

  test('mixed: dispatches enabled, skips disabled', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'active-deploy', EVENT_TASK)
    await writeTask(configDir, 'disabled-deploy', DISABLED_EVENT)

    const spawned: Array<{ name: string }> = []
    const result = await dispatch('deploy', {
      configDir,
      spawnRun: (name) => spawned.push({ name }),
      probes: { network: async () => true },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['active-deploy'])
    expect(result.skipped).toEqual([
      { name: 'disabled-deploy', reason: 'disabled' },
    ])
    expect(spawned).toHaveLength(1)
  })

  test('mixed offline: dispatches no-requirement tasks, skips network-required', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'always-task', ALWAYS_EVENT)
    await writeTask(configDir, 'online-task', EVENT_TASK)

    const spawned: Array<{ name: string }> = []
    const result = await dispatch('deploy', {
      configDir,
      spawnRun: (name) => spawned.push({ name }),
      probes: { network: async () => false },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['always-task'])
    expect(result.skipped).toEqual([
      {
        name: 'online-task',
        reason: 'requirement-unmet',
        requirement: ['network'],
      },
    ])
  })
})
