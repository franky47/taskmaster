---
# tm-5dd1
title: Doctor offline skip diagnostic
status: todo
type: task
priority: normal
tags:
    - doctor
    - diagnostics
created_at: 2026-04-08T10:11:45Z
updated_at: 2026-04-08T10:11:45Z
parent: tm-kgff
blocked_by:
    - tm-38to
---

## What to build

A new doctor diagnostic that surfaces offline connectivity skips from the global event log and guides users toward `enabled: 'always'` for tasks that can run without network.

End-to-end: after a week where a user's laptop was frequently offline, `tm doctor` reports which tasks were skipped due to offline and how many times, with a hint to set `enabled: 'always'` on tasks that use local models.

See parent PRD sections: "Doctor diagnostic".

## Acceptance criteria

- [ ] New finding type for offline connectivity skips
- [ ] Aggregates `{ event: 'skipped', reason: 'offline' }` entries from `readLog(since)`, grouped by task name
- [ ] Emits a `warning`-severity finding for each task with at least 1 offline skip in the time window
- [ ] Warning message includes the task name and skip count
- [ ] Warning includes hint: set `enabled: 'always'` if this task can run without network
- [ ] No finding emitted for tasks with zero offline skips
- [ ] Unit tests for skip aggregation and warning output
- [ ] Unit tests for zero-skip case (no findings)
- [ ] Tests use DI via `DoctorDeps` to inject fake log entries (prior art: existing doctor tests)

## User stories addressed

- User story 4: doctor reports offline skip count per task
- User story 5: doctor suggests `enabled: 'always'`
