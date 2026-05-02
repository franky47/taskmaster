import fs from 'node:fs/promises'
import path from 'node:path'

import * as errore from 'errore'

import { TaskNameError, normalizeWalkRelativePath } from './name.ts'

const MAX_DEPTH = 10

export class TasksDirReadError extends errore.createTaggedError({
  name: 'TasksDirReadError',
  message: 'Failed to read tasks directory $path',
}) {}

type WalkEntry = {
  canonical: string
  filePath: string
  relativePath: string
}

type WalkWarning = {
  relativePath: string
  error: TaskNameError
}

type WalkResult = {
  entries: WalkEntry[]
  warnings: WalkWarning[]
}

export async function walkTasksDir(
  tasksDir: string,
): Promise<TasksDirReadError | WalkResult> {
  const rootReal = await fs.realpath(tasksDir).catch((e: unknown) => {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
      return null
    }
    return new TasksDirReadError({ path: tasksDir, cause: e })
  })
  if (rootReal instanceof Error) return rootReal
  if (rootReal === null) return { entries: [], warnings: [] }

  const entries: WalkEntry[] = []
  const warnings: WalkWarning[] = []
  const visited = new Set<string>([rootReal])

  const err = await walk(tasksDir, '', 0, visited, tasksDir, {
    entries,
    warnings,
  })
  if (err) return err

  entries.sort((a, b) => a.canonical.localeCompare(b.canonical))
  warnings.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return { entries, warnings }
}

type WalkAcc = {
  entries: WalkEntry[]
  warnings: WalkWarning[]
}

async function walk(
  absDir: string,
  relPrefix: string,
  depth: number,
  visited: Set<string>,
  tasksDir: string,
  acc: WalkAcc,
): Promise<TasksDirReadError | undefined> {
  if (depth > MAX_DEPTH) return undefined

  const dirents = await fs
    .readdir(absDir, { withFileTypes: true })
    .catch((e: unknown) => new TasksDirReadError({ path: tasksDir, cause: e }))
  if (dirents instanceof Error) return dirents

  for (const d of dirents) {
    if (d.name.startsWith('.')) continue
    const abs = path.join(absDir, d.name)
    const rel = relPrefix ? path.join(relPrefix, d.name) : d.name

    let isDir = d.isDirectory()
    let isFile = d.isFile()

    if (d.isSymbolicLink()) {
      const real = await fs.realpath(abs).catch(() => null)
      if (real === null) continue
      const stat = await fs.stat(real).catch(() => null)
      if (stat === null) continue
      isDir = stat.isDirectory()
      isFile = stat.isFile()
    }

    if (isDir) {
      // Always resolve the directory's realpath so cycle detection works
      // even when a parent in the path has been followed via symlink.
      const real = await fs.realpath(abs).catch(() => null)
      if (real === null) continue
      if (visited.has(real)) continue
      visited.add(real)
      const err = await walk(abs, rel, depth + 1, visited, tasksDir, acc)
      if (err) return err
      continue
    }

    if (!isFile) continue
    // The filesystem entry name is what becomes the leaf segment; a symlink
    // whose link name lacks `.md` is not a task even if its target is `.md`.
    if (!d.name.endsWith('.md')) continue

    const normalized = normalizeWalkRelativePath(rel, tasksDir)
    if (normalized instanceof TaskNameError) {
      acc.warnings.push({ relativePath: rel, error: normalized })
      continue
    }
    acc.entries.push({
      canonical: normalized.canonical,
      filePath: abs,
      relativePath: rel,
    })
  }
  return undefined
}
