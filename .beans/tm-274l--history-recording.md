---
# tm-274l
title: History recording
status: completed
type: feature
priority: high
created_at: 2026-04-04T19:53:50Z
updated_at: 2026-04-05T13:31:15Z
blocked_by:
    - tm-kr4g
---

## What to build

After `tm run` completes, persist run metadata and output to the history directory. Handle temp dir lifecycle (delete on success, preserve on failure). Implement the purge routine for successful history older than 30 days.

See PRD Slice 4 for full specification.

## Acceptance criteria

- [x] On completion, tm run writes <timestamp>.meta.json to ~/.config/taskmaster/history/<task-name>/ (S4.1)
- [x] meta.json contains: timestamp, started_at, finished_at, duration_ms, exit_code, success (S4.2)
- [x] On completion, tm run writes <timestamp>.stdout.txt with raw claude output (S4.3)
- [x] On completion, tm run writes <timestamp>.stderr.txt with claude's stderr, only when non-empty (S4.3a)
- [x] Timestamp in filenames is UTC in YYYY-MM-DDTHH.MM.SSZ format; tick-initiated runs use floored minute (via --timestamp), manual runs use second precision (S4.4)
- [x] On success with a temp dir: temp dir is deleted (S4.5)
- [x] On failure with a temp dir: temp dir is moved to ~/.config/taskmaster/runs/<task-name>/<timestamp>/ with prompt, stdout, stderr preserved (S4.6)
- [x] On success or failure with explicit cwd: no directory operations beyond history writes (S4.7)
- [x] Purge routine deletes successful history entries older than 30 days (S4.8)
- [x] Failed run entries in history/ are never auto-purged (S4.9)

## User stories addressed

- As a user, after a task runs, I can find its output and metadata in the history directory
- As a user, when a task fails and used a temp dir, the temp dir is preserved for debugging
- As a user, successful run history older than 30 days is automatically purged


## Summary of Changes

Implemented history recording as a new `src/history/` module:
- `timestamp.ts`: FS-safe UTC timestamp formatting, `--timestamp` flag parsing
- `record.ts`: writes meta.json/stdout/stderr to history dir, handles temp dir lifecycle (delete on success, move to runs/ on failure)
- `purge.ts`: deletes successful history entries older than 30 days, never purges failed entries
- Enriched `RunResult` with `startedAt`, `finishedAt`, `cwd`, `prompt` for history recording
- CLI wired with hidden `--timestamp` option for tick-initiated runs
- 27 new tests covering all acceptance criteria
