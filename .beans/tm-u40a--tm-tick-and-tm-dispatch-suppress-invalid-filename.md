---
# tm-u40a
title: tm tick and tm dispatch suppress invalid-filename warnings
status: completed
type: feature
priority: normal
created_at: 2026-05-02T18:13:04Z
updated_at: 2026-05-02T18:35:28Z
parent: tm-rrzs
blocked_by:
    - tm-gegb
---

## What to build

Adapt `tm tick` and `tm dispatch` to the recursive walker via `listTasks`.
Both commands silently drop invalid-filename warnings (those belong to
`tm validate`) but continue to log parse and frontmatter failures so a
typoed schedule on an otherwise-valid task still produces a visible error
in the JSONL log.

See parent PRD `tm-rrzs` for the warning policy split between validate and
tick/dispatch.

## Acceptance criteria

- [x] `tm tick` and `tm dispatch` discover nested tasks via the walker.
- [x] Invalid-filename warnings produced by the walker are silently dropped
      in tick and dispatch.
- [x] Parse and frontmatter failure warnings continue to be logged in the
      JSONL log with their existing event shape.
- [x] Test fixtures cover: a nested valid task, a nested invalid-segment
      file, and a nested file with broken frontmatter — confirming only the
      frontmatter failure appears in tick/dispatch logs.

## User stories addressed

- User story 9
- User story 10

## Summary of Changes

- Added a shared `isInvalidFilenameWarning(warning: TaskListWarning)` predicate in `src/list/list.ts` (alongside the warning type itself) so tick and dispatch can drop walker-produced filename warnings without duplicating the logic. The `TaskListWarning.error` is currently always either a `TaskNameError` (walker) or a parser/frontmatter error; the predicate matches the former.
- Wired the filter into `src/tick/tick.ts` and `src/dispatch/dispatch.ts` warning loops. Parse/frontmatter failures continue to log unchanged so a typoed schedule on a real task still produces a visible JSONL error.
- Added an integration-style test to `tick.test.ts` and `dispatch.test.ts` with three nested fixtures (valid task, invalid-segment file, broken-frontmatter file). Asserts only the frontmatter-failure entry appears in the JSONL log and that the nested valid task is dispatched. The tick variant stubs `queryHistory` because nested-canonical history lookups are scoped to tm-48a2.
