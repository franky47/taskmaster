---
# tm-q7pz
title: tm status shows running state
status: completed
type: task
priority: normal
created_at: 2026-04-09T10:38:01Z
updated_at: 2026-04-09T12:54:33Z
parent: tm-zaph
blocked_by:
    - tm-fu5m
---

## What to build

Enhance `getTaskStatuses` to detect and report currently running tasks by reading the lock file marker.

End-to-end: `getTaskStatuses` calls `readRunningMarker(taskName, locksDir)` for each task → if marker found (PID alive), adds `running` field to `TaskStatus` → CLI displays `running since <ISO> (<duration>)` and the output file path → `--json` includes `running` object with `started_at`, `timestamp`, `pid`, `duration_ms`.

See parent PRD (tm-zaph) for full context on the status display format.

## Acceptance criteria

- [x] `TaskStatus` type gains optional `running` field: `{ started_at: string, timestamp: string, pid: number, duration_ms: number }`
- [x] `getTaskStatuses` calls `readRunningMarker` for each task
- [x] CLI plain output shows `running   since <started_at> (<human duration>)` when running
- [x] CLI plain output shows `output    <path to .output.txt>` when running
- [x] `--json` output includes `running` object (or `null`/absent when not running)
- [x] Tests: status includes running state when marker present and PID alive
- [x] Tests: status omits running state when no marker or PID dead

## User stories addressed

- User story 1 (see running tasks in tm status)
- User story 2 (see how long a task has been running)
- User story 3 (see output file path for manual tail)
- User story 12 (JSON output with running state fields)
