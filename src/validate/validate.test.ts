import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { validateTasks } from './validate.ts'

async function makeTmpTasksDir(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-validate-'))
  const tasksDir = path.join(tmp, 'tasks')
  await fs.mkdir(tasksDir, { recursive: true })
  return tasksDir
}

async function writeTask(tasksDir: string, name: string, content: string) {
  await fs.writeFile(path.join(tasksDir, `${name}.md`), content)
}

const VALID_TASK = `---
schedule: '0 8 * * 1-5'
---

Do something useful.
`

const INVALID_TASK = `---
schedule: 'bad cron'
timezone: 'Fake/Zone'
---

Bad task.
`

describe('validateTasks', () => {
  test('returns empty array for missing tasks directory', async () => {
    const result = await validateTasks('/tmp/no-such-dir-ever/tasks')
    expect(result).toEqual([])
  })

  test('returns empty array for empty tasks directory', async () => {
    const tasksDir = await makeTmpTasksDir()
    const result = await validateTasks(tasksDir)
    expect(result).toEqual([])
  })

  test('ignores non-.md files', async () => {
    const tasksDir = await makeTmpTasksDir()
    await fs.writeFile(path.join(tasksDir, 'readme.txt'), 'not a task')
    const result = await validateTasks(tasksDir)
    expect(result).toEqual([])
  })

  test('reports valid task', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'my-task', VALID_TASK)
    const result = await validateTasks(tasksDir)
    expect(result).toEqual([{ name: 'my-task', valid: true }])
  })

  test('reports invalid task with errors', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'bad-task', INVALID_TASK)
    const result = await validateTasks(tasksDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('bad-task')
    expect(result[0].valid).toBe(false)
    if (result[0].valid === false) {
      expect(result[0].errors.length).toBeGreaterThan(0)
    }
  })

  test('results are sorted alphabetically by name', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'zz-last', VALID_TASK)
    await writeTask(tasksDir, 'aa-first', VALID_TASK)
    await writeTask(tasksDir, 'mm-middle', VALID_TASK)
    const result = await validateTasks(tasksDir)
    expect(result.map((r) => r.name)).toEqual([
      'aa-first',
      'mm-middle',
      'zz-last',
    ])
  })

  test('mixes valid and invalid tasks', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'good-task', VALID_TASK)
    await writeTask(tasksDir, 'bad-task', INVALID_TASK)
    const result = await validateTasks(tasksDir)
    expect(result).toHaveLength(2)
    const good = result.find((r) => r.name === 'good-task')
    const bad = result.find((r) => r.name === 'bad-task')
    expect(good?.valid).toBe(true)
    expect(bad?.valid).toBe(false)
  })

  test('reports filename validation errors', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'Bad_Name', VALID_TASK)
    const result = await validateTasks(tasksDir)
    expect(result).toHaveLength(1)
    expect(result[0].valid).toBe(false)
    if (result[0].valid === false) {
      expect(result[0].errors[0]).toContain('Bad_Name')
    }
  })
})
