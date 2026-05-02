import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { TaskNameError } from './name.ts'
import { TasksDirReadError, walkTasksDir } from './walk.ts'

async function makeTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function makeTasksDir(): Promise<string> {
  const root = await makeTmp('tm-walk-')
  const tasks = path.join(root, 'tasks')
  await fs.mkdir(tasks, { recursive: true })
  return tasks
}

const TASK_BODY = `---
on:
  schedule: '0 8 * * *'
agent: opencode
---

Body.
`

async function writeFile(file: string, body = TASK_BODY): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)
}

describe('walkTasksDir', () => {
  test('returns empty result for missing directory', async () => {
    const result = await walkTasksDir('/tmp/no-such-dir-ever/tasks')
    if (result instanceof Error) throw result
    expect(result.entries).toEqual([])
    expect(result.warnings).toEqual([])
  })

  test('yields flat .md file as a single-segment entry', async () => {
    const tasks = await makeTasksDir()
    await writeFile(path.join(tasks, 'foo.md'))
    const result = await walkTasksDir(tasks)
    if (result instanceof Error) throw result
    expect(result.entries).toEqual([
      {
        canonical: 'foo',
        filePath: path.join(tasks, 'foo.md'),
        relativePath: 'foo.md',
      },
    ])
    expect(result.warnings).toEqual([])
  })

  test('yields nested .md file with underscore-joined canonical', async () => {
    const tasks = await makeTasksDir()
    await writeFile(path.join(tasks, 'group', 'task.md'))
    const result = await walkTasksDir(tasks)
    if (result instanceof Error) throw result
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toEqual({
      canonical: 'group_task',
      filePath: path.join(tasks, 'group', 'task.md'),
      relativePath: path.join('group', 'task.md'),
    })
  })

  test('discovers multiple files at multiple depths', async () => {
    const tasks = await makeTasksDir()
    await writeFile(path.join(tasks, 'flat.md'))
    await writeFile(path.join(tasks, 'a', 'one.md'))
    await writeFile(path.join(tasks, 'a', 'b', 'two.md'))
    const result = await walkTasksDir(tasks)
    if (result instanceof Error) throw result
    const canonicals = result.entries.map((e) => e.canonical).sort()
    expect(canonicals).toEqual(['a_b_two', 'a_one', 'flat'])
  })

  test('skips non-.md files silently', async () => {
    const tasks = await makeTasksDir()
    await writeFile(path.join(tasks, 'real.md'))
    await fs.writeFile(path.join(tasks, 'README'), 'docs')
    await fs.writeFile(path.join(tasks, 'notes.txt'), 'notes')
    const result = await walkTasksDir(tasks)
    if (result instanceof Error) throw result
    expect(result.entries.map((e) => e.canonical)).toEqual(['real'])
    expect(result.warnings).toEqual([])
  })

  test('skips dotfiles and dot-directories silently', async () => {
    const tasks = await makeTasksDir()
    await writeFile(path.join(tasks, 'real.md'))
    await fs.writeFile(path.join(tasks, '.DS_Store'), '')
    await fs.mkdir(path.join(tasks, '.git'))
    await fs.writeFile(path.join(tasks, '.git', 'config'), '')
    await fs.mkdir(path.join(tasks, '.obsidian'))
    await writeFile(path.join(tasks, '.obsidian', 'hidden.md'))
    const result = await walkTasksDir(tasks)
    if (result instanceof Error) throw result
    expect(result.entries.map((e) => e.canonical)).toEqual(['real'])
    expect(result.warnings).toEqual([])
  })

  test('emits warning for invalid segment in filename', async () => {
    const tasks = await makeTasksDir()
    await writeFile(path.join(tasks, 'good.md'))
    await writeFile(path.join(tasks, 'Bad_Name.md'))
    const result = await walkTasksDir(tasks)
    if (result instanceof Error) throw result
    expect(result.entries.map((e) => e.canonical)).toEqual(['good'])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.relativePath).toBe('Bad_Name.md')
    expect(result.warnings[0]?.error).toBeInstanceOf(TaskNameError)
  })

  test('emits warning for invalid segment in nested directory name', async () => {
    const tasks = await makeTasksDir()
    await writeFile(path.join(tasks, 'Bad_Dir', 'task.md'))
    const result = await walkTasksDir(tasks)
    if (result instanceof Error) throw result
    expect(result.entries).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.relativePath).toBe(
      path.join('Bad_Dir', 'task.md'),
    )
  })

  test('follows symlinked subdirectory', async () => {
    const root = await makeTmp('tm-walk-sym-')
    const tasks = path.join(root, 'tasks')
    const external = path.join(root, 'external')
    await fs.mkdir(tasks, { recursive: true })
    await fs.mkdir(external, { recursive: true })
    await writeFile(path.join(external, 'remote.md'))
    await fs.symlink(external, path.join(tasks, 'linked'))
    const result = await walkTasksDir(tasks)
    if (result instanceof Error) throw result
    expect(result.entries.map((e) => e.canonical)).toEqual(['linked_remote'])
  })

  test('follows symlinked .md file leaf', async () => {
    const root = await makeTmp('tm-walk-leaf-')
    const tasks = path.join(root, 'tasks')
    const external = path.join(root, 'external')
    await fs.mkdir(tasks, { recursive: true })
    await fs.mkdir(external, { recursive: true })
    await writeFile(path.join(external, 'src.md'))
    await fs.symlink(path.join(external, 'src.md'), path.join(tasks, 'leaf.md'))
    const result = await walkTasksDir(tasks)
    if (result instanceof Error) throw result
    expect(result.entries.map((e) => e.canonical)).toEqual(['leaf'])
  })

  test('breaks on symlink directory cycle', async () => {
    const root = await makeTmp('tm-walk-cycle-')
    const tasks = path.join(root, 'tasks')
    await fs.mkdir(tasks, { recursive: true })
    await writeFile(path.join(tasks, 'one.md'))
    await fs.symlink(tasks, path.join(tasks, 'loop'))
    const result = await walkTasksDir(tasks)
    if (result instanceof Error) throw result
    expect(result.entries.map((e) => e.canonical)).toEqual(['one'])
  })

  test('returns TasksDirReadError when tasksDir is a file', async () => {
    const root = await makeTmp('tm-walk-err-')
    const file = path.join(root, 'not-a-dir')
    await fs.writeFile(file, '')
    const result = await walkTasksDir(file)
    expect(result).toBeInstanceOf(TasksDirReadError)
  })
})
