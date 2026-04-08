---
# tm-38to
title: Tick connectivity filter + skip logging
status: completed
type: task
priority: normal
tags:
    - tick
    - logging
created_at: 2026-04-08T10:11:34Z
updated_at: 2026-04-08T11:00:09Z
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

- [x] Tick pipeline checks connectivity via `isOnline()` after the dedup stage
- [x] When offline, `enabled: 'when-online'` tasks are filtered out (not dispatched)
- [x] When offline, `enabled: 'always'` tasks are dispatched normally
- [x] When online, all enabled tasks are dispatched regardless of `enabled` value
- [x] Logger `reason` field extended from `z.literal('contention')` to `z.enum(['contention', 'offline'])`
- [x] Each offline-skipped task logs `{ event: 'skipped', task: name, reason: 'offline' }` to the global log
- [x] DNS probe is skipped when no remaining tasks have `enabled: 'when-online'`
- [x] DNS probe is skipped when task list is empty after any prior filter stage
- [x] Pipeline exits early at each stage when the task list empties
- [x] `tm run <name>` is unaffected — no connectivity check on manual execution
- [x] Unit tests for online/offline filtering behavior
- [x] Unit tests for DNS probe skip optimization
- [x] Unit tests for offline skip log entries
- [x] Unit tests for early exit at each pipeline stage

## User stories addressed

- User story 1: network-dependent tasks skipped when offline
- User story 2: `enabled: 'always'` tasks run when offline
- User story 8: manual execution unaffected
- User story 13: offline skips logged
- User story 14: DNS probe skipped when all tasks are `always`
- User story 15: DNS probe skipped when no tasks are due

## Summary of Changes

Restructured the tick pipeline into staged processing: cron+dedup collection, then connectivity filter, then dispatch. Extended the logger reason enum to accept 'offline'. Offline-skipped tasks are both logged and included in TickResult.skipped.
