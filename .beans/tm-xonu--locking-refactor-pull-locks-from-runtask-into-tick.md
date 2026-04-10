---
# tm-xonu
title: 'Locking refactor: pull locks from runTask into tick'
status: completed
type: task
priority: high
created_at: 2026-04-10T08:35:56Z
updated_at: 2026-04-10T09:33:15Z
parent: tm-k9xd
---

## What to build

Move lock acquisition out of `runTask()` and into the tick dispatcher. `runTask()` becomes lock-unaware — it always runs when called. The tick path acquires the lock before calling `runTask()` and releases it after. `tm run` (manual) and the future `tm dispatch` both call `runTask()` directly without locking.

This makes locking a tick-only concern, with no conditionals or branching in the task runner.

## Acceptance criteria

- [x] `runTask()` no longer calls `acquireTaskLock()` or handles contention
- [x] Tick dispatcher acquires lock before calling `runTask()` and releases after
- [x] `tm run <name>` executes without locking (always runs)
- [x] Concurrent `tm run` invocations of the same task are allowed
- [x] Tick still skips contended tasks with a "contention" log entry
- [x] Running marker write/clear still works for tick-dispatched tasks

## TDD approach

This refactors existing code. Follow TDD:

1. Update existing run and tick tests first to reflect the new lock boundaries (run tests should not expect locking, tick tests should expect lock acquisition at the tick level).
2. Verify the updated tests fail — if they pass, it reveals a coverage gap that should be investigated.
3. Change the implementation to make the tests pass.

## User stories addressed

- User story 6 (dispatched tasks always run, no contention)

## Summary of Changes

Stripped lock/marker logic from runTask() — it now delegates directly to executeTask(). Lock acquisition, running marker lifecycle, and contention handling moved to the tm run CLI handler in main.ts, scoped to tick-dispatched runs (--timestamp flag). Manual runs always execute without locking. try/finally ensures marker cleanup even on thrown exceptions.
