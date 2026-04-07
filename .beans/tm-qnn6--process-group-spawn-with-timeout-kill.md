---
# tm-qnn6
title: Process group spawn with timeout kill
status: todo
type: task
tags:
    - hitl
created_at: 2026-04-07T12:29:08Z
updated_at: 2026-04-07T12:29:08Z
parent: tm-7fv4
---

## What to build

Rework `defaultSpawnAgent` to spawn the child process in a new process group, and add timeout support. When a timeout is provided and the process exceeds it, send SIGTERM to the entire process group, wait a 10-second grace period (hardcoded `KILL_GRACE_MS = 10_000` constant), then send SIGKILL.

This is the deep module of the timeout feature — all process lifecycle complexity (process group creation, timer racing, graceful-then-forceful kill, timer cleanup on normal exit) is encapsulated behind the `SpawnAgentOpts`/`SpawnAgentResult` interface.

The parent `tm run` process must be in a separate process group and must NOT be affected by the kill signal.

## Acceptance criteria

- [ ] `SpawnAgentOpts` gains `timeout?: number` (milliseconds, undefined = no limit)
- [ ] `SpawnAgentResult` gains `timedOut: boolean`
- [ ] Child process is spawned in a new process group
- [ ] On timeout: SIGTERM sent to process group, 10s grace, then SIGKILL
- [ ] On normal exit before timeout: timer is cancelled, `timedOut: false`
- [ ] Partial stdout/stderr is captured up to the kill point
- [ ] Parent `tm run` process is not affected by the kill signal
- [ ] `KILL_GRACE_MS` is a named constant
- [ ] Tests: fast command with generous timeout completes normally (`timedOut: false`)
- [ ] Tests: slow command (`sleep`) with short timeout is killed (`timedOut: true`)
- [ ] Tests: child processes of the shell are also killed (process group kill verified)

## User stories addressed

- User story 5: entire process tree is killed, not just the shell wrapper
- User story 6: SIGTERM first with grace period before SIGKILL
