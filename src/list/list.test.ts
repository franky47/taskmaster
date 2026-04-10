import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { listTasks } from './list.ts'

async function makeTmpTasksDir(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-list-'))
  const tasksDir = path.join(tmp, 'tasks')
  await fs.mkdir(tasksDir, { recursive: true })
  return tasksDir
}

async function writeTask(tasksDir: string, name: string, content: string) {
  await fs.writeFile(path.join(tasksDir, `${name}.md`), content)
}

const ENABLED_TASK = `---
on:
  schedule: '0 8 * * 1-5'
agent: opencode
---

Do something useful.
`

const DISABLED_TASK = `---
on:
  schedule: '30 6 * * *'
agent: opencode
enabled: false
---

Disabled task.
`

const TASK_WITH_TIMEZONE = `---
on:
  schedule: '0 9 * * 1'
agent: opencode
timezone: 'America/New_York'
---

Weekly task.
`

const TASK_WITH_TIMEOUT = `---
on:
  schedule: '0 8 * * 1-5'
agent: opencode
timeout: '5m'
---

Task with timeout.
`

const RUN_TASK = `---
on:
  schedule: '0 12 * * *'
run: 'my-cmd $TM_PROMPT_FILE'
---

Run-based task.
`

describe('listTasks', () => {
  test('returns empty tasks for missing tasks directory', async () => {
    const result = await listTasks('/tmp/no-such-dir-ever/tasks')
    if (result instanceof Error) throw result
    expect(result.tasks).toEqual([])
    expect(result.warnings).toEqual([])
  })

  test('returns empty tasks for empty tasks directory', async () => {
    const tasksDir = await makeTmpTasksDir()
    const result = await listTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result.tasks).toEqual([])
  })

  test('ignores non-.md files', async () => {
    const tasksDir = await makeTmpTasksDir()
    await fs.writeFile(path.join(tasksDir, 'readme.txt'), 'not a task')
    const result = await listTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result.tasks).toEqual([])
  })

  test('returns task entry for valid task', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'my-task', ENABLED_TASK)
    const result = await listTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result.tasks).toEqual([
      {
        name: 'my-task',
        on: { schedule: '0 8 * * 1-5' },
        enabled: 'when-online',
        timeout: 3_600_000,
        agent: 'opencode',
      },
    ])
  })

  test('includes timezone when present', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'weekly', TASK_WITH_TIMEZONE)
    const result = await listTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result.tasks).toEqual([
      {
        name: 'weekly',
        on: { schedule: '0 9 * * 1' },
        timezone: 'America/New_York',
        enabled: 'when-online',
        timeout: 3_600_000,
        agent: 'opencode',
      },
    ])
  })

  test('shows disabled status', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'off-task', DISABLED_TASK)
    const result = await listTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result.tasks).toEqual([
      {
        name: 'off-task',
        on: { schedule: '30 6 * * *' },
        enabled: false,
        timeout: 3_600_000,
        agent: 'opencode',
      },
    ])
  })

  test('sorts alphabetically by name', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'zz-last', ENABLED_TASK)
    await writeTask(tasksDir, 'aa-first', ENABLED_TASK)
    await writeTask(tasksDir, 'mm-middle', ENABLED_TASK)
    const result = await listTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result.tasks.map((t) => t.name)).toEqual([
      'aa-first',
      'mm-middle',
      'zz-last',
    ])
  })

  test('returns warnings for invalid task files', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'good-task', ENABLED_TASK)
    await writeTask(
      tasksDir,
      'bad-task',
      `---
on:
  schedule: 'bad cron'
---

Bad.
`,
    )
    const result = await listTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result.tasks).toEqual([
      {
        name: 'good-task',
        on: { schedule: '0 8 * * 1-5' },
        enabled: 'when-online',
        timeout: 3_600_000,
        agent: 'opencode',
      },
    ])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]!.file).toBe('bad-task.md')
    expect(result.warnings[0]!.error).toBeInstanceOf(Error)
  })

  test('returns warnings for files with invalid names', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'good-task', ENABLED_TASK)
    await writeTask(tasksDir, 'Bad_Name', ENABLED_TASK)
    const result = await listTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result.tasks).toEqual([
      {
        name: 'good-task',
        on: { schedule: '0 8 * * 1-5' },
        enabled: 'when-online',
        timeout: 3_600_000,
        agent: 'opencode',
      },
    ])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]!.file).toBe('Bad_Name.md')
  })

  test('includes timeout when present', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'timed', TASK_WITH_TIMEOUT)
    const result = await listTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result.tasks).toEqual([
      {
        name: 'timed',
        on: { schedule: '0 8 * * 1-5' },
        enabled: 'when-online',
        timeout: 300_000,
        agent: 'opencode',
      },
    ])
  })

  test('returns task entry for run-based task', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'run-task', RUN_TASK)
    const result = await listTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result.tasks).toEqual([
      {
        name: 'run-task',
        on: { schedule: '0 12 * * *' },
        enabled: 'when-online',
        timeout: 3_600_000,
        run: 'my-cmd $TM_PROMPT_FILE',
      },
    ])
  })

  test('returns task entry for event-driven task', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(
      tasksDir,
      'on-deploy',
      `---
on:
  event: deploy
agent: opencode
---

Post-deploy checks.
`,
    )
    const result = await listTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result.tasks).toEqual([
      {
        name: 'on-deploy',
        on: { event: 'deploy' },
        enabled: 'when-online',
        timeout: 3_600_000,
        agent: 'opencode',
      },
    ])
  })
})
