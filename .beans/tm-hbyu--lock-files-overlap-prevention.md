---
# tm-hbyu
title: Lock files (overlap prevention)
status: completed
type: feature
priority: normal
created_at: 2026-04-04T19:53:56Z
updated_at: 2026-04-06T08:36:48Z
parent: tm-we5m
blocked_by:
    - tm-kr4g
---

## What to build

Prevent concurrent execution of the same task using per-task file locks via flock(2) called through bun:ffi on libc. The lock auto-releases on process exit or crash (kernel guarantee).

See PRD Slice 5 for full specification.

## Acceptance criteria

- [x] tm run acquires a file lock at ~/.config/taskmaster/locks/<task-name>.lock before execution (S5.1)
- [x] If the lock is already held, tm run exits with code 0 and prints a skip warning to stderr (S5.2)
- [x] The lock is released after execution completes, whether success or failure (S5.3)
- [x] If tm run crashes, the OS-level lock is released via flock(2) kernel semantics (not PID files) (S5.4)
- [x] --json output includes a "skipped": true field when lock contention occurs (S5.5)

## User stories addressed

- As the scheduler, when a task is already running, a second invocation is skipped gracefully
- As a user, I see a warning when a task is skipped due to lock contention

## Summary of Changes

Implemented per-task file locking using flock(2) via bun:ffi. Lock is acquired in `runTask` wrapper around `executeTask` (clean separation). Contention returns `TaskContentionError` — unified error pattern, no special `RunSkipped` type. Lock auto-releases via `DisposableStack` on every exit path, and kernel guarantees release on crash.
