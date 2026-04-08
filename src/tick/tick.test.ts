import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { readLog } from '../logger'
import { tick } from './tick'

async function makeConfigDir(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-tick-'))
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

async function writeMeta(
  configDir: string,
  taskName: string,
  timestamp: string,
  overrides: Partial<{
    started_at: string
    finished_at: string
    duration_ms: number
    exit_code: number
    success: boolean
  }> = {},
): Promise<void> {
  const histDir = path.join(configDir, 'history', taskName)
  await fs.mkdir(histDir, { recursive: true })

  const meta = {
    timestamp,
    started_at: timestamp.replace(/\./g, ':').replace(/Z$/, '.000Z'),
    finished_at: timestamp.replace(/\./g, ':').replace(/Z$/, '.000Z'),
    duration_ms: 1000,
    exit_code: 0,
    success: true,
    ...overrides,
  }

  await fs.writeFile(
    path.join(histDir, `${timestamp}.meta.json`),
    JSON.stringify(meta),
  )
}

// Task at 8am on weekdays
const WEEKDAY_TASK = `---
schedule: "0 8 * * 1-5"
agent: opencode
---

Weekday morning task.
`

// Task every minute
const EVERY_MINUTE_TASK = `---
schedule: "* * * * *"
agent: opencode
---

Every minute task.
`

const DISABLED_TASK = `---
schedule: "* * * * *"
agent: opencode
enabled: false
---

Disabled task.
`

const TIMEZONE_TASK = `---
schedule: "0 9 * * *"
agent: opencode
timezone: "America/New_York"
---

Task in Eastern time.
`

// Monday 2026-04-06 at 08:00:30 UTC (30 seconds into the minute)
const NOW = new Date('2026-04-06T08:00:30.000Z')
// Floored to minute: 2026-04-06T08:00:00Z → formatted as 2026-04-06T08.00.00Z
const FLOORED_TS = '2026-04-06T08.00.00Z'

describe('tick', () => {
  test('dispatches enabled tasks matching the floored minute (S8.1, S8.2, S8.3)', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily', WEEKDAY_TASK)

    const spawned: Array<{ name: string; timestamp: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['daily'])
    expect(spawned).toEqual([{ name: 'daily', timestamp: FLOORED_TS }])
  })

  test('floors current time to the minute (S8.2)', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'every-min', EVERY_MINUTE_TASK)

    const spawned: Array<{ name: string; timestamp: string }> = []
    // 45 seconds into the minute
    const now = new Date('2026-04-06T14:23:45.789Z')
    const result = await tick({
      configDir,
      now,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(spawned[0]?.timestamp).toBe('2026-04-06T14.23.00Z')
  })

  test('skips disabled tasks (S8.1)', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'disabled', DISABLED_TASK)

    const spawned: Array<{ name: string; timestamp: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(spawned).toEqual([])
  })

  test('skips tasks whose cron does not match (S8.3)', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'daily', WEEKDAY_TASK)

    const spawned: Array<{ name: string; timestamp: string }> = []
    // 09:00 does not match "0 8 * * 1-5"
    const now = new Date('2026-04-06T09:00:00.000Z')
    const result = await tick({
      configDir,
      now,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(spawned).toEqual([])
  })

  test('prevents double-firing for the same floored minute (S8.4)', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'every-min', EVERY_MINUTE_TASK)
    // History entry already exists for this exact floored minute
    await writeMeta(configDir, 'every-min', FLOORED_TS)

    const spawned: Array<{ name: string; timestamp: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(result.skipped).toEqual(['every-min'])
    expect(spawned).toEqual([])
  })

  test('dispatches when history exists but for a different minute (S8.4)', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'every-min', EVERY_MINUTE_TASK)
    // History entry from the previous minute
    await writeMeta(configDir, 'every-min', '2026-04-06T07.59.00Z')

    const spawned: Array<{ name: string; timestamp: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['every-min'])
    expect(spawned).toHaveLength(1)
  })

  test('evaluates cron in task timezone (S8.3)', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'eastern', TIMEZONE_TASK)

    const spawned: Array<{ name: string; timestamp: string }> = []
    // 9am EDT = 13:00 UTC (April = EDT, UTC-4)
    const now = new Date('2026-04-06T13:00:00.000Z')
    const result = await tick({
      configDir,
      now,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['eastern'])
  })

  test('does not dispatch timezone task at wrong UTC time (S8.3)', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'eastern', TIMEZONE_TASK)

    const spawned: Array<{ name: string; timestamp: string }> = []
    // 9am UTC is not 9am EDT
    const now = new Date('2026-04-06T09:00:00.000Z')
    const result = await tick({
      configDir,
      now,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
  })

  test('writes heartbeat file with ISO timestamp (S8.7)', async () => {
    const configDir = await makeConfigDir()

    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: () => {},
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    const heartbeat = await fs.readFile(
      path.join(configDir, 'heartbeat'),
      'utf-8',
    )
    expect(heartbeat).toBe(NOW.toISOString())
  })

  test('runs history purge on every invocation (S8.9)', async () => {
    const configDir = await makeConfigDir()
    // Write an old successful history entry that should be purged
    const oldTimestamp = '2025-01-01T00.00.00Z'
    await writeTask(configDir, 'old-task', EVERY_MINUTE_TASK)
    await writeMeta(configDir, 'old-task', oldTimestamp, {
      finished_at: '2025-01-01T00:00:00.000Z',
      success: true,
    })

    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: () => {},
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.purged).toBeGreaterThan(0)

    // Verify the old meta file was deleted
    const files = await fs.readdir(path.join(configDir, 'history', 'old-task'))
    expect(files.filter((f) => f.endsWith('.meta.json'))).toHaveLength(0)
  })

  test('dispatches multiple matching tasks', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'task-a', EVERY_MINUTE_TASK)
    await writeTask(configDir, 'task-b', EVERY_MINUTE_TASK)
    await writeTask(configDir, 'task-c', DISABLED_TASK)

    const spawned: Array<{ name: string; timestamp: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['task-a', 'task-b'])
    expect(spawned).toHaveLength(2)
  })

  test('returns empty arrays when no tasks exist', async () => {
    const configDir = await makeConfigDir()

    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: () => {},
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(result.skipped).toEqual([])
  })

  test("offline: skips 'when-online' tasks", async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'cloud-task', EVERY_MINUTE_TASK) // defaults to 'when-online'

    const spawned: Array<{ name: string; timestamp: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      isOnline: async () => false,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(result.skipped).toEqual(['cloud-task'])
    expect(spawned).toEqual([])
  })

  test("offline: dispatches 'always' tasks normally", async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'local-task',
      `---
schedule: "* * * * *"
agent: opencode
enabled: 'always'
---

Local model task.
`,
    )

    const spawned: Array<{ name: string; timestamp: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      isOnline: async () => false,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['local-task'])
    expect(spawned).toHaveLength(1)
  })

  test("online: dispatches both 'when-online' and 'always' tasks", async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'cloud', EVERY_MINUTE_TASK) // defaults to 'when-online'
    await writeTask(
      configDir,
      'local',
      `---
schedule: "* * * * *"
agent: opencode
enabled: 'always'
---

Local task.
`,
    )

    const spawned: Array<{ name: string; timestamp: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['cloud', 'local'])
    expect(spawned).toHaveLength(2)
  })

  test("skips DNS probe when all due tasks are 'always'", async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'local-only',
      `---
schedule: "* * * * *"
agent: opencode
enabled: 'always'
---

Local only task.
`,
    )

    let probeCalled = false
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: () => {},
      isOnline: async () => {
        probeCalled = true
        return false
      },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['local-only'])
    expect(probeCalled).toBe(false)
  })

  test('logs offline-skipped tasks to global log', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'cloud-a', EVERY_MINUTE_TASK)
    await writeTask(configDir, 'cloud-b', EVERY_MINUTE_TASK)

    const before = new Date()
    await tick({
      configDir,
      now: NOW,
      spawnRun: () => {},
      isOnline: async () => false,
    })

    const entries = readLog(before)
    const offlineSkips = entries.filter(
      (e) => e.event === 'skipped' && e.reason === 'offline',
    )
    expect(offlineSkips).toHaveLength(2)
    const names = offlineSkips.map((e) => e.task).sort()
    expect(names).toEqual(['cloud-a', 'cloud-b'])
  })

  test('does not dispatch on weekends for weekday-only schedule', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'weekday', WEEKDAY_TASK)

    const spawned: Array<{ name: string; timestamp: string }> = []
    // Sunday 2026-04-05 at 08:00
    const now = new Date('2026-04-05T08:00:00.000Z')
    const result = await tick({
      configDir,
      now,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      isOnline: async () => true,
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(spawned).toEqual([])
  })
})
