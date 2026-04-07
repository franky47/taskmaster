---
# tm-c7ng
title: End-to-end wiring + history recording
status: completed
type: task
priority: normal
created_at: 2026-04-07T12:29:19Z
updated_at: 2026-04-07T19:14:29Z
parent: tm-7fv4
blocked_by:
    - tm-lzk7
    - tm-qnn6
---

## What to build

Wire the timeout field end-to-end: `executeTask` reads `task.timeout` from the parsed frontmatter and passes it to `spawnAgent`, then threads `timedOut` from the spawn result into `RunResult`.

Add `timed_out` boolean field to the history metadata schema (defaulting to `false` for backwards compatibility with existing records). When `timedOut` is true, override the exit code to 124 (GNU timeout convention) and set `success: false`. Partial stdout/stderr from timed-out runs is preserved in the failed-run artifact directory (this works for free since timed-out runs are failures).

## Acceptance criteria

- [x] `RunResult` gains `timedOut: boolean`
- [x] `executeTask` threads `task.timeout` into spawn opts and `timedOut` into the result
- [x] `timed_out` boolean added to history metadata Zod schema with `.default(false)`
- [x] History recording sets `timed_out: true` and `exit_code: 124` for timed-out runs
- [x] Existing history records without `timed_out` parse correctly (backwards compat)
- [x] CLI output distinguishes timeouts from regular failures
- [x] Lock is released after a timeout kill (existing `DisposableStack` cleanup)
- [x] Tests: full run-and-record path for a timed-out task
- [x] Tests: history schema parses records with and without `timed_out`

## User stories addressed

- User story 1: set a maximum run duration that is enforced
- User story 7: timed-out runs recorded with `timed_out` flag
- User story 8: exit code 124
- User story 9: partial stdout/stderr preserved
- User story 11: works for both agent and run variants
- User story 12: lock released after timeout kill
