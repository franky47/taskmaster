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
schedule: '0 8 * * 1-5'
---

Do something useful.
`

const DISABLED_TASK = `---
schedule: '30 6 * * *'
enabled: false
---

Disabled task.
`

const TASK_WITH_TIMEZONE = `---
schedule: '0 9 * * 1'
timezone: 'America/New_York'
---

Weekly task.
`

describe('listTasks', () => {
  test('returns empty array for missing tasks directory', async () => {
    const result = await listTasks('/tmp/no-such-dir-ever/tasks')
    expect(result).toEqual([])
  })

  test('returns empty array for empty tasks directory', async () => {
    const tasksDir = await makeTmpTasksDir()
    const result = await listTasks(tasksDir)
    expect(result).toEqual([])
  })

  test('ignores non-.md files', async () => {
    const tasksDir = await makeTmpTasksDir()
    await fs.writeFile(path.join(tasksDir, 'readme.txt'), 'not a task')
    const result = await listTasks(tasksDir)
    expect(result).toEqual([])
  })

  test('returns task entry for valid task', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'my-task', ENABLED_TASK)
    const result = await listTasks(tasksDir)
    expect(result).toEqual([
      { name: 'my-task', schedule: '0 8 * * 1-5', enabled: true },
    ])
  })

  test('includes timezone when present', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'weekly', TASK_WITH_TIMEZONE)
    const result = await listTasks(tasksDir)
    expect(result).toEqual([
      {
        name: 'weekly',
        schedule: '0 9 * * 1',
        timezone: 'America/New_York',
        enabled: true,
      },
    ])
  })

  test('shows disabled status', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'off-task', DISABLED_TASK)
    const result = await listTasks(tasksDir)
    expect(result).toEqual([
      { name: 'off-task', schedule: '30 6 * * *', enabled: false },
    ])
  })

  test('sorts alphabetically by name', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'zz-last', ENABLED_TASK)
    await writeTask(tasksDir, 'aa-first', ENABLED_TASK)
    await writeTask(tasksDir, 'mm-middle', ENABLED_TASK)
    const result = await listTasks(tasksDir)
    expect(result.map((t) => t.name)).toEqual([
      'aa-first',
      'mm-middle',
      'zz-last',
    ])
  })

  test('skips invalid task files', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'good-task', ENABLED_TASK)
    await writeTask(
      tasksDir,
      'bad-task',
      `---
schedule: 'bad cron'
---

Bad.
`,
    )
    const result = await listTasks(tasksDir)
    expect(result).toEqual([
      { name: 'good-task', schedule: '0 8 * * 1-5', enabled: true },
    ])
  })

  test('skips files with invalid names', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'good-task', ENABLED_TASK)
    await writeTask(tasksDir, 'Bad_Name', ENABLED_TASK)
    const result = await listTasks(tasksDir)
    expect(result).toEqual([
      { name: 'good-task', schedule: '0 8 * * 1-5', enabled: true },
    ])
  })
})
