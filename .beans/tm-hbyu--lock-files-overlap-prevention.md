---
# tm-hbyu
title: Lock files (overlap prevention)
status: todo
type: feature
priority: normal
created_at: 2026-04-04T19:53:56Z
updated_at: 2026-04-04T19:53:56Z
blocked_by:
    - tm-kr4g
---

## What to build

Prevent concurrent execution of the same task using per-task file locks via flock(2) called through bun:ffi on libc. The lock auto-releases on process exit or crash (kernel guarantee).

See PRD Slice 5 for full specification.

## Acceptance criteria

- [ ] tm run acquires a file lock at ~/.config/taskmaster/locks/<task-name>.lock before execution (S5.1)
- [ ] If the lock is already held, tm run exits with code 0 and prints a skip warning to stderr (S5.2)
- [ ] The lock is released after execution completes, whether success or failure (S5.3)
- [ ] If tm run crashes, the OS-level lock is released via flock(2) kernel semantics (not PID files) (S5.4)
- [ ] --json output includes a "skipped": true field when lock contention occurs (S5.5)

## User stories addressed

- As the scheduler, when a task is already running, a second invocation is skipped gracefully
- As a user, I see a warning when a task is skipped due to lock contention
