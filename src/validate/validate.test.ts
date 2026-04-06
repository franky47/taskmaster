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
agent: opencode
---

Do something useful.
`

const INVALID_TASK = `---
schedule: 'bad cron'
agent: opencode
timezone: 'Fake/Zone'
---

Bad task.
`

const VALID_RUN_TASK = `---
schedule: '0 8 * * 1-5'
run: 'my-cmd $TM_PROMPT_FILE'
---

Run-based task.
`

const TASK_MISSING_AGENT_AND_RUN = `---
schedule: '0 8 * * 1-5'
---

Missing both agent and run.
`

const TASK_BOTH_AGENT_AND_RUN = `---
schedule: '0 8 * * 1-5'
agent: opencode
run: 'my-cmd $TM_PROMPT_FILE'
---

Has both agent and run.
`

const TASK_ARGS_WITH_RUN = `---
schedule: '0 8 * * 1-5'
run: 'my-cmd $TM_PROMPT_FILE'
args: '--verbose'
---

Args with run is invalid.
`

const TASK_RUN_MISSING_MARKER = `---
schedule: '0 8 * * 1-5'
run: 'my-cmd --flag'
---

Run without TM_PROMPT_FILE.
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
    if (result instanceof Error) throw result
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('bad-task')
    expect(result[0]!.valid).toBe(false)
    if (result[0]!.valid === false) {
      expect(result[0]!.errors.length).toBeGreaterThan(0)
    }
  })

  test('results are sorted alphabetically by name', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'zz-last', VALID_TASK)
    await writeTask(tasksDir, 'aa-first', VALID_TASK)
    await writeTask(tasksDir, 'mm-middle', VALID_TASK)
    const result = await validateTasks(tasksDir)
    if (result instanceof Error) throw result
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
    if (result instanceof Error) throw result
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
    if (result instanceof Error) throw result
    expect(result).toHaveLength(1)
    expect(result[0]!.valid).toBe(false)
    if (result[0]!.valid === false) {
      expect(result[0]!.errors[0]).toContain('Bad_Name')
    }
  })

  test('reports valid for run-based task', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'run-task', VALID_RUN_TASK)
    const result = await validateTasks(tasksDir)
    expect(result).toEqual([{ name: 'run-task', valid: true }])
  })

  test('catches missing agent and run', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'no-executor', TASK_MISSING_AGENT_AND_RUN)
    const result = await validateTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result).toHaveLength(1)
    expect(result[0]!.valid).toBe(false)
    if (result[0]!.valid === false) {
      expect(result[0]!.errors.join('\n')).toContain(
        'exactly one of "agent" or "run"',
      )
    }
  })

  test('catches both agent and run', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'both', TASK_BOTH_AGENT_AND_RUN)
    const result = await validateTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result).toHaveLength(1)
    expect(result[0]!.valid).toBe(false)
    if (result[0]!.valid === false) {
      expect(result[0]!.errors.join('\n')).toContain('not both')
    }
  })

  test('catches args with run', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'args-run', TASK_ARGS_WITH_RUN)
    const result = await validateTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result).toHaveLength(1)
    expect(result[0]!.valid).toBe(false)
    if (result[0]!.valid === false) {
      expect(result[0]!.errors.join('\n')).toContain(
        'can only be used with "agent"',
      )
    }
  })

  test('catches run without TM_PROMPT_FILE', async () => {
    const tasksDir = await makeTmpTasksDir()
    await writeTask(tasksDir, 'no-marker', TASK_RUN_MISSING_MARKER)
    const result = await validateTasks(tasksDir)
    if (result instanceof Error) throw result
    expect(result).toHaveLength(1)
    expect(result[0]!.valid).toBe(false)
    if (result[0]!.valid === false) {
      expect(result[0]!.errors.join('\n')).toContain('TM_PROMPT_FILE')
    }
  })
})
