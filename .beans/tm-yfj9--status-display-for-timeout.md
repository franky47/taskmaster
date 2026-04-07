---
# tm-yfj9
title: Status display for timeout
status: todo
type: task
created_at: 2026-04-07T12:29:25Z
updated_at: 2026-04-07T12:29:25Z
parent: tm-7fv4
blocked_by:
    - tm-lzk7
---

## What to build

Show the configured timeout value in `tm status` output for tasks that have one set. Display the raw human-readable string from frontmatter (e.g. `"5m"`), not the millisecond value.

## Acceptance criteria

- [ ] `TaskStatus` type gains optional `timeout` string field
- [ ] `tm status` displays timeout when present, omits it when not set
- [ ] Tests: status output includes timeout for tasks with the field set
- [ ] Tests: status output unchanged for tasks without timeout

## User stories addressed

- User story 10: see the timeout policy at a glance in status output
