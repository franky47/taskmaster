import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { readLog } from '#lib/logger'
import { TaskNotFoundError } from '#src/history/query'

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

  const started_at =
    overrides.started_at ?? timestamp.replace(/\./g, ':').replace(/Z$/, '.000Z')
  const duration_ms = overrides.duration_ms ?? 0
  const finished_at =
    overrides.finished_at ??
    new Date(new Date(started_at).getTime() + duration_ms).toISOString()
  const exit_code = overrides.exit_code ?? 0

  const meta = {
    timestamp,
    started_at,
    finished_at,
    duration_ms,
    exit_code,
    success: overrides.success ?? exit_code === 0,
  }

  await fs.writeFile(
    path.join(histDir, `${timestamp}.meta.json`),
    JSON.stringify(meta),
  )
}

// Task at 8am on weekdays
const WEEKDAY_TASK = `---
on:
  schedule: "0 8 * * 1-5"
agent: opencode
---

Weekday morning task.
`

// Task every minute
const EVERY_MINUTE_TASK = `---
on:
  schedule: "* * * * *"
agent: opencode
---

Every minute task.
`

const DISABLED_TASK = `---
on:
  schedule: "* * * * *"
agent: opencode
enabled: false
---

Disabled task.
`

const TIMEZONE_TASK = `---
on:
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
      probes: { network: async () => true },
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
      probes: { network: async () => true },
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
      probes: { network: async () => true },
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
      probes: { network: async () => true },
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
      probes: { network: async () => true },
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
      probes: { network: async () => true },
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
      probes: { network: async () => true },
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
      probes: { network: async () => true },
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
      probes: { network: async () => true },
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
      probes: { network: async () => true },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.dry_run).toBe(false)
    if (result.dry_run) return

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
      probes: { network: async () => true },
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
      probes: { network: async () => true },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(result.skipped).toEqual([])
  })

  test('offline: skips tasks requiring network', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'cloud-task', EVERY_MINUTE_TASK)

    const spawned: Array<{ name: string; timestamp: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      probes: { network: async () => false },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(result.skipped).toEqual(['cloud-task'])
    expect(spawned).toEqual([])
  })

  test('offline: dispatches tasks with no network requirement', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'local-task',
      `---
on:
  schedule: "* * * * *"
agent: opencode
requires: []
---

Local model task.
`,
    )

    const spawned: Array<{ name: string; timestamp: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      probes: { network: async () => false },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['local-task'])
    expect(spawned).toHaveLength(1)
  })

  test('online: dispatches both network-required and no-requirement tasks', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'cloud', EVERY_MINUTE_TASK)
    await writeTask(
      configDir,
      'local',
      `---
on:
  schedule: "* * * * *"
agent: opencode
requires: []
---

Local task.
`,
    )

    const spawned: Array<{ name: string; timestamp: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      probes: { network: async () => true },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['cloud', 'local'])
    expect(spawned).toHaveLength(2)
  })

  test('skips network probe when no due task references it', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'local-only',
      `---
on:
  schedule: "* * * * *"
agent: opencode
requires: []
---

Local only task.
`,
    )

    let probeCalled = false
    const result = await tick({
      configDir,
      now: NOW,
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

    expect(result.dispatched).toEqual(['local-only'])
    expect(probeCalled).toBe(false)
  })

  test('logs unmet-requirement skips to global log', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'cloud-a', EVERY_MINUTE_TASK)
    await writeTask(configDir, 'cloud-b', EVERY_MINUTE_TASK)

    const before = new Date()
    await tick({
      configDir,
      now: NOW,
      spawnRun: () => {},
      probes: { network: async () => false },
    })

    const entries = readLog(before)
    const skips = entries.filter(
      (e) => e.event === 'skipped' && e.reason === 'requirement-unmet',
    )
    expect(skips).toHaveLength(2)
    const names = skips.map((e) => e.task).sort()
    expect(names).toEqual(['cloud-a', 'cloud-b'])
    for (const s of skips) {
      if (s.event !== 'skipped' || s.reason !== 'requirement-unmet') continue
      expect(s.requirement).toEqual(['network'])
    }
  })

  test('on-battery: skips tasks requiring ac-power', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'power-hungry',
      `---
on:
  schedule: "* * * * *"
agent: opencode
requires: ['ac-power']
---

Power-hungry task.
`,
    )

    const spawned: Array<{ name: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name) => spawned.push({ name }),
      probes: {
        network: async () => true,
        'ac-power': async () => false,
      },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(result.skipped).toEqual(['power-hungry'])
    expect(spawned).toEqual([])
  })

  test('on-ac: dispatches tasks requiring ac-power', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'power-hungry',
      `---
on:
  schedule: "* * * * *"
agent: opencode
requires: ['ac-power']
---

Power-hungry task.
`,
    )

    const spawned: Array<{ name: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name) => spawned.push({ name }),
      probes: {
        network: async () => false,
        'ac-power': async () => true,
      },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual(['power-hungry'])
    expect(spawned).toHaveLength(1)
  })

  test('skips combined network+ac-power task if either is unmet, logs all unmet', async () => {
    const configDir = await makeConfigDir()
    await writeTask(
      configDir,
      'cloud-ai',
      `---
on:
  schedule: "* * * * *"
agent: opencode
requires: ['network', 'ac-power']
---

Cloud AI task.
`,
    )

    const before = new Date()
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: () => {},
      probes: {
        network: async () => false,
        'ac-power': async () => false,
      },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.skipped).toEqual(['cloud-ai'])

    const skips = readLog(before).filter(
      (e) => e.event === 'skipped' && e.reason === 'requirement-unmet',
    )
    expect(skips).toHaveLength(1)
    const entry = skips[0]!
    if (entry.event !== 'skipped' || entry.reason !== 'requirement-unmet')
      return
    expect(entry.requirement.sort()).toEqual(['ac-power', 'network'])
  })

  describe('dry-run', () => {
    test('reports due tasks without spawning, writing heartbeat, or purging', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'task-a', EVERY_MINUTE_TASK)
      await writeTask(configDir, 'task-b', EVERY_MINUTE_TASK)

      // Write an old history entry that would normally be purged
      const oldTimestamp = '2025-01-01T00.00.00Z'
      await writeTask(configDir, 'old-task', EVERY_MINUTE_TASK)
      await writeMeta(configDir, 'old-task', oldTimestamp, {
        finished_at: '2025-01-01T00:00:00.000Z',
        success: true,
      })

      const spawned: Array<{ name: string; timestamp: string }> = []
      const result = await tick({
        configDir,
        now: NOW,
        spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
        probes: { network: async () => true },
        dryRun: true,
      })

      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return

      // Tasks reported as would-be-dispatched
      expect(result.dispatched).toContain('task-a')
      expect(result.dispatched).toContain('task-b')
      expect(result.dry_run).toBe(true)

      // No actual side effects
      expect(spawned).toEqual([])
      expect('purged' in result).toBe(false)

      // No heartbeat file written
      const heartbeatExists = await fs
        .access(path.join(configDir, 'heartbeat'))
        .then(() => true)
        .catch(() => false)
      expect(heartbeatExists).toBe(false)

      // Old history entry still present (not purged)
      const files = await fs.readdir(
        path.join(configDir, 'history', 'old-task'),
      )
      expect(files.filter((f) => f.endsWith('.meta.json'))).toHaveLength(1)
    })

    test('returns empty dispatched when no tasks are due', async () => {
      const configDir = await makeConfigDir()
      await writeTask(configDir, 'daily', WEEKDAY_TASK)

      // Sunday — weekday task won't match
      const now = new Date('2026-04-05T08:00:00.000Z')
      const result = await tick({
        configDir,
        now,
        spawnRun: () => {},
        probes: { network: async () => true },
        dryRun: true,
      })

      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return

      expect(result.dispatched).toEqual([])
      expect(result.dry_run).toBe(true)
    })

    test('includes dry_run field in result', async () => {
      const configDir = await makeConfigDir()

      const result = await tick({
        configDir,
        now: NOW,
        spawnRun: () => {},
        probes: { network: async () => true },
        dryRun: true,
      })

      expect(result).not.toBeInstanceOf(Error)
      if (result instanceof Error) return

      expect(result.dry_run).toBe(true)
    })
  })

  test('skips task and logs error when queryHistory fails during dedup', async () => {
    const configDir = await makeConfigDir()
    await writeTask(configDir, 'every-min', EVERY_MINUTE_TASK)

    const spawned: Array<{ name: string; timestamp: string }> = []
    const before = new Date()
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      probes: { network: async () => true },
      queryHistory: async () =>
        new TaskNotFoundError({ taskName: 'every-min' }),
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    // Task should be skipped, not dispatched
    expect(result.dispatched).toEqual([])
    expect(result.skipped).toEqual(['every-min'])
    expect(spawned).toEqual([])

    // Error should be logged
    const entries = readLog(before)
    const errors = entries.filter(
      (e) => e.event === 'error' && e.task === 'every-min',
    )
    expect(errors).toHaveLength(1)
  })

  test('logs error when purgeHistory fails but tick still succeeds', async () => {
    const configDir = await makeConfigDir()

    const before = new Date()
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: () => {},
      probes: { network: async () => true },
      purgeHistory: async () => new Error('purge failed'),
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.dry_run).toBe(false)
    if (result.dry_run) return

    expect(result.purged).toBe(0)

    const entries = readLog(before)
    const errors = entries.filter(
      (e) => e.event === 'error' && e.task === '(purge)',
    )
    expect(errors).toHaveLength(1)
  })

  test('logs error when heartbeat write fails but tick still succeeds', async () => {
    const configDir = await makeConfigDir()
    // Put a directory where the heartbeat file should be — writeFile will fail
    await fs.mkdir(path.join(configDir, 'heartbeat'))

    const before = new Date()
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: () => {},
      probes: { network: async () => true },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return
    expect(result.dry_run).toBe(false)
    if (result.dry_run) return

    // Heartbeat should be empty string indicating failure
    expect(result.heartbeat).toBe('')

    const entries = readLog(before)
    const errors = entries.filter(
      (e) => e.event === 'error' && e.task === '(heartbeat)',
    )
    expect(errors).toHaveLength(1)
  })

  test('logs error when cron parsing throws and does not dispatch', async () => {
    const configDir = await makeConfigDir()
    // Write a task with an intentionally bad timezone to trigger a cron-parser error
    await writeTask(
      configDir,
      'bad-tz',
      `---
on:
  schedule: "* * * * *"
agent: opencode
timezone: "Not/A/Timezone"
---

Bad timezone task.
`,
    )

    const before = new Date()
    const spawned: Array<{ name: string; timestamp: string }> = []
    const result = await tick({
      configDir,
      now: NOW,
      spawnRun: (name, timestamp) => spawned.push({ name, timestamp }),
      probes: { network: async () => true },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(spawned).toEqual([])

    // Error should be logged
    const entries = readLog(before)
    const errors = entries.filter(
      (e) => e.event === 'error' && e.task === 'bad-tz',
    )
    expect(errors).toHaveLength(1)
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
      probes: { network: async () => true },
    })

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) return

    expect(result.dispatched).toEqual([])
    expect(spawned).toEqual([])
  })
})
