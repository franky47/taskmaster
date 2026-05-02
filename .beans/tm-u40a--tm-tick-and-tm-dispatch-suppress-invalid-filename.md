---
# tm-u40a
title: tm tick and tm dispatch suppress invalid-filename warnings
status: todo
type: feature
created_at: 2026-05-02T18:13:04Z
updated_at: 2026-05-02T18:13:04Z
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

- [ ] `tm tick` and `tm dispatch` discover nested tasks via the walker.
- [ ] Invalid-filename warnings produced by the walker are silently dropped
      in tick and dispatch.
- [ ] Parse and frontmatter failure warnings continue to be logged in the
      JSONL log with their existing event shape.
- [ ] Test fixtures cover: a nested valid task, a nested invalid-segment
      file, and a nested file with broken frontmatter — confirming only the
      frontmatter failure appears in tick/dispatch logs.

## User stories addressed

- User story 9
- User story 10
