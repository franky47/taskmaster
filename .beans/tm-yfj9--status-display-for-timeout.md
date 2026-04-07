---
# tm-yfj9
title: Status display for timeout
status: completed
type: task
priority: normal
created_at: 2026-04-07T12:29:25Z
updated_at: 2026-04-07T17:12:15Z
parent: tm-7fv4
blocked_by:
    - tm-lzk7
---

## What to build

Show the configured timeout value in `tm status` output for tasks that have one set. Display the raw human-readable string from frontmatter (e.g. `"5m"`), not the millisecond value.

## Acceptance criteria

- [x] `TaskStatus` type gains optional `timeout` string field
- [x] `tm status` displays timeout when present, omits it when not set
- [x] Tests: status output includes timeout for tasks with the field set
- [x] Tests: status output unchanged for tasks without timeout

## User stories addressed

- User story 10: see the timeout policy at a glance in status output

## Summary of Changes

Added `timeout?: string` to `TaskStatus`, populated by converting the stored millisecond value back to a human-readable duration string via `ms()`. The CLI output shows the timeout line between `enabled` and `last_run` when present.
