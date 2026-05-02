import path from 'node:path'

import * as errore from 'errore'

const SEGMENT_RE = /^[a-z0-9-]+$/

export class TaskNameError extends errore.createTaggedError({
  name: 'TaskNameError',
  message: 'Invalid task name "$input": $reason',
}) {}

type NormalizedTaskName = {
  canonical: string
  filePath: string
  segments: readonly string[]
}

export function normalizeTaskName(
  input: string,
  tasksDir: string,
): NormalizedTaskName | TaskNameError {
  if (input.length === 0) {
    return new TaskNameError({ input, reason: 'empty input' })
  }
  const stripped = input.endsWith('.md') ? input.slice(0, -'.md'.length) : input
  if (stripped.length === 0) {
    return new TaskNameError({ input, reason: 'empty input' })
  }

  // Slash form is canonical when present; mixed input like `foo/bar_baz` is
  // rejected because `bar_baz` then fails the per-segment regex (no `_` allowed).
  const segments = stripped.includes('/')
    ? stripped.split('/')
    : stripped.split('_')

  return buildNormalized(input, segments, tasksDir)
}

// Walker-only entry: relative file path uses '/' as the only separator. A
// flat `foo_bar.md` thus resolves to a single segment `foo_bar`, which fails
// the segment regex — preserving the bijection between canonical names and
// source paths (a flat underscore basename has no canonical preimage).
export function normalizeWalkRelativePath(
  relativePath: string,
  tasksDir: string,
): NormalizedTaskName | TaskNameError {
  if (relativePath.length === 0) {
    return new TaskNameError({ input: relativePath, reason: 'empty input' })
  }
  const stripped = relativePath.endsWith('.md')
    ? relativePath.slice(0, -'.md'.length)
    : relativePath
  if (stripped.length === 0) {
    return new TaskNameError({ input: relativePath, reason: 'empty input' })
  }
  return buildNormalized(relativePath, stripped.split('/'), tasksDir)
}

function buildNormalized(
  input: string,
  segments: string[],
  tasksDir: string,
): NormalizedTaskName | TaskNameError {
  for (const seg of segments) {
    if (seg.length === 0) {
      return new TaskNameError({ input, reason: 'empty segment' })
    }
    if (!SEGMENT_RE.test(seg)) {
      return new TaskNameError({
        input,
        reason: `segment "${seg}" must match [a-z0-9-]+`,
      })
    }
  }
  const canonical = segments.join('_')
  const filePath = `${path.join(tasksDir, ...segments)}.md`
  return { canonical, filePath, segments }
}

export function toDisplayForm(canonical: string): string {
  return canonical.replaceAll('_', '/')
}

// Maps a canonical underscore-joined task name to its source file path
// under `tasksDir`. The bijection (each `_` is a path-separator hop) is
// load-bearing: the walker enforces no `_` inside a segment, so this
// mapping is unambiguous.
export function taskFilePath(canonical: string, tasksDir: string): string {
  return `${path.join(tasksDir, ...canonical.split('_'))}.md`
}
