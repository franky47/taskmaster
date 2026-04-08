---
# tm-38to
title: Tick connectivity filter + skip logging
status: todo
type: task
priority: normal
tags:
    - tick
    - logging
created_at: 2026-04-08T10:11:34Z
updated_at: 2026-04-08T10:11:34Z
parent: tm-kgff
blocked_by:
    - tm-yqrq
    - tm-4mwg
---

## What to build

Wire the DNS connectivity probe into the tick dispatch pipeline and log tasks that are skipped due to offline connectivity. This is the core scheduling behavior change.

End-to-end: when `tm tick` runs on an offline machine, tasks with `enabled: 'when-online'` are skipped (not dispatched), each skip is logged to the global event log with `reason: 'offline'`, and tasks with `enabled: 'always'` are dispatched normally. The DNS probe is skipped entirely when it cannot affect the outcome.

See parent PRD sections: "Tick pipeline changes", "Logger extension", "Manual execution".

## Acceptance criteria

- [ ] Tick pipeline checks connectivity via `isOnline()` after the dedup stage
- [ ] When offline, `enabled: 'when-online'` tasks are filtered out (not dispatched)
- [ ] When offline, `enabled: 'always'` tasks are dispatched normally
- [ ] When online, all enabled tasks are dispatched regardless of `enabled` value
- [ ] Logger `reason` field extended from `z.literal('contention')` to `z.enum(['contention', 'offline'])`
- [ ] Each offline-skipped task logs `{ event: 'skipped', task: name, reason: 'offline' }` to the global log
- [ ] DNS probe is skipped when no remaining tasks have `enabled: 'when-online'`
- [ ] DNS probe is skipped when task list is empty after any prior filter stage
- [ ] Pipeline exits early at each stage when the task list empties
- [ ] `tm run <name>` is unaffected — no connectivity check on manual execution
- [ ] Unit tests for online/offline filtering behavior
- [ ] Unit tests for DNS probe skip optimization
- [ ] Unit tests for offline skip log entries
- [ ] Unit tests for early exit at each pipeline stage

## User stories addressed

- User story 1: network-dependent tasks skipped when offline
- User story 2: `enabled: 'always'` tasks run when offline
- User story 8: manual execution unaffected
- User story 13: offline skips logged
- User story 14: DNS probe skipped when all tasks are `always`
- User story 15: DNS probe skipped when no tasks are due
