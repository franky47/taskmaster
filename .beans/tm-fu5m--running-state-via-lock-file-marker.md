---
# tm-fu5m
title: Running state via lock file marker
status: todo
type: task
created_at: 2026-04-09T10:37:38Z
updated_at: 2026-04-09T10:37:38Z
parent: tm-zaph
---

## What to build

After acquiring the exclusive flock in `runTask`, write JSON metadata into the lock file itself so that other processes can detect a running task. Truncate the content before releasing the lock on completion.

End-to-end: `runTask` acquires lock → writes `{pid, started_at, timestamp}` via `fs.writeSync(fd, ...)` → task executes → `fs.ftruncateSync(fd, 0)` before `releaseLock` → marker gone. A new `readRunningMarker(taskName, locksDir)` helper reads the lock file, parses JSON (Zod-validated), validates PID liveness via `process.kill(pid, 0)`, and returns the marker or null.

This requires threading the `timestamp` string into `runTask` via its options, since the marker includes the timestamp of the run being executed.

See parent PRD (tm-zaph) for full context on the lock file reuse pattern and PID-based liveness detection.

## Acceptance criteria

- [ ] Zod schema for running marker: `{ pid: number, started_at: string (ISO datetime), timestamp: string }`
- [ ] `runTask` writes marker JSON to lock file fd after acquiring the lock
- [ ] `runTask` truncates lock file content before releasing the lock (via `DisposableStack.defer`)
- [ ] `timestamp` added to `runTask`/`executeTask` options and threaded from `main.ts`
- [ ] `readRunningMarker(taskName, locksDir)` returns parsed marker or null
- [ ] Stale marker detection: if PID is dead, returns null (and optionally logs)
- [ ] JSON parse failure treated as "not running" (handles partial writes)
- [ ] Unit tests: marker readable during execution, absent after completion
- [ ] Unit tests: stale marker detected when PID is dead

## User stories addressed

- User story 11 (robust crash detection with stale marker cleanup)
