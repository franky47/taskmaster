---
# tm-gjb6
title: Fix silent failures from error handling audit
status: completed
type: bug
priority: high
created_at: 2026-04-09T11:34:16Z
updated_at: 2026-04-09T14:39:17Z
---

## Context

A silent failure audit found a pervasive "skip and continue on error" pattern that creates a system where problems accumulate invisibly — and the diagnostic tool (`tm doctor`) is itself subject to the pattern.

## Critical

- [ ] `src/list/list.ts:33`: `listTasks` silently drops malformed task files — parse errors make tasks vanish from `tm list`, `tm status`, and `tm tick` with zero feedback
- [ ] `src/tick/tick.ts:105-118`: `tick` silently ignores `queryHistory` errors during dedup — if history is unreadable, tasks get dispatched redundantly (could rack up AI agent API costs)
- [ ] `src/run/run.ts:139-142`: `defaultSpawnAgent` returns fake `exitCode: 1` when spawn fails (PID undefined) — indistinguishable from a real failure, no diagnostic output

## High

- [ ] `src/tick/tick.ts:42-57`: `isCronMatch` swallows all exceptions → `false` — task silently never runs
- [ ] `src/history/query.ts:84-100`: `queryHistory` silently skips malformed meta files — history entries vanish, affecting doctor and dedup
- [ ] `src/run/cwd.ts:37-46`: `resolveCwd` catches all `fs.stat` errors as "not found" — EACCES/ELOOP/EIO produce misleading "directory does not exist" error
- [ ] `src/tick/tick.ts:152`: `tick` silently ignores `purgeHistory` errors — history accumulates unboundedly
- [ ] `src/tick/tick.ts:156`: Heartbeat write failure is unhandled — causes `tm doctor` to falsely report "scheduler not ticking"

## Medium

- [ ] `src/logger.ts:85-91`: `log()` empty catch — write to stderr as last resort when log is permanently unwritable
- [ ] `src/logger.ts:96-99`: `readLog` returns `[]` on any file error, not just ENOENT
- [ ] `src/run/run.ts:115-120`: `defaultKillProcessGroup` catches EPERM — timed-out process may keep running if we can't signal it
- [ ] `src/setup/setup.ts:171,176,224`: `launchctl`/`crontab` exit codes unchecked — setup reports success even if scheduler fails to load
- [ ] `src/doctor/doctor.ts:115-122`: Doctor silently skips checks when `validateTasks`/`listTasks` errors — the diagnostic tool itself fails silently, reporting "all clear"

## Low

- [ ] `src/doctor/doctor.ts:122`: Per-task `queryHistory` errors silently skipped in doctor
- [ ] `src/history/query.ts:139-142`: `queryGlobalHistory` silently skips unreadable task directories
- [ ] `src/main.ts:364`: No top-level unhandled rejection handler


## Acceptance Criteria

### Critical

**`listTasks` silently drops malformed task files**
- `listTasks` returns parse warnings alongside successful entries (e.g. `{ tasks: TaskListEntry[]; warnings: { file: string; error: Error }[] }`) or logs a warning to stderr
- A task file with invalid frontmatter produces a visible warning in `tm list` output
- `tm tick` surfaces the same warning so users know a task isn't being scheduled
- Existing tests pass; new test confirms a malformed file produces a warning, not silent omission

**`tick` dedup ignores `queryHistory` errors**
- When `queryHistory` returns an error during the dedup check, the error is logged via `log()`
- The task is skipped (not dispatched) when history is unreadable — conservative approach prevents duplicate dispatches
- New test: inject a failing `queryHistory` → task is skipped and error is logged

**`defaultSpawnAgent` fake exitCode on spawn failure**
- When child PID is undefined, the result includes a diagnostic message in `output` (e.g. `"Failed to spawn process: ..."`)
- `exitCode` is set to 127 (command-not-found convention) rather than 1
- New test: mock spawn returning undefined PID → result has exit code 127 and non-empty output

### High

**`isCronMatch` swallows all exceptions**
- Exceptions in `isCronMatch` are logged via `log()` with the task/schedule context
- Still returns `false` (graceful degradation), but the error is observable
- New test: inject a throwing cron parser → returns false and produces a log entry

**`queryHistory` silently skips malformed meta files**
- `queryHistory` tracks skipped file count and includes it in the return value, or logs a warning to stderr
- `tm history` output indicates when entries were skipped
- New test: corrupt meta JSON → entry is skipped and count/warning is surfaced

**`resolveCwd` catches all `fs.stat` errors as "not found"**
- ENOENT → `CwdNotFoundError` (existing behavior)
- EACCES, ELOOP, EIO, etc. → distinct error (e.g. `CwdAccessError`) or generic error with the real `cause`
- The error message does not say "does not exist" when the actual problem is permissions
- New test: mock `fs.stat` throwing EACCES → error message mentions permission, not "not found"

**`tick` silently ignores `purgeHistory` errors**
- Purge errors are logged via `log()` with `event: 'error'`
- `TickResult` still reports `purged: 0` on failure (non-fatal), but the error is observable
- New test: inject failing `purgeHistory` → error is logged

**Heartbeat write failure unhandled**
- `fs.writeFile` for heartbeat is wrapped in try/catch
- Failure is logged via `log()` — tick continues successfully
- `TickResult.heartbeat` reflects that the write failed (empty string or error indicator)
- New test: inject failing `fs.writeFile` for heartbeat path → tick succeeds, error is logged

### Medium

**`log()` empty catch**
- On write failure, `log()` writes a one-line diagnostic to `process.stderr`
- Logging failures never throw or crash the program (existing invariant preserved)
- New test: inject a throwing `appendFileSync` → stderr receives a message

**`readLog` returns `[]` on any file error**
- ENOENT → returns `[]` (no log file yet, normal)
- Other errors (EACCES, EIO) → returns `Error` or logs to stderr before returning `[]`
- New test: mock EACCES on log file → behavior differs from ENOENT

**`defaultKillProcessGroup` catches EPERM**
- ESRCH is still silently caught (process already dead, expected)
- EPERM → writes warning to stderr ("failed to kill process group, it may still be running")
- New test: mock `process.kill` throwing EPERM → stderr warning emitted

**`launchctl`/`crontab` exit codes unchecked**
- `setup()` checks the exit code of `launchctl load` and returns an error if non-zero
- `teardown()` checks the exit code of `launchctl unload` (or treats failure as non-fatal with warning)
- `setupLinux` checks `crontab` exit code
- New tests: mock non-zero exit → `setup()` returns an error

**Doctor silently skips checks on error**
- When `validateTasks()` or `listTasks()` returns an error, doctor emits a critical finding (e.g. `kind: 'internal-error'`)
- The doctor report shows "could not validate tasks" rather than "all clear"
- New test: inject failing `listTasks` → report contains an error finding, not empty

### Low

**Per-task `queryHistory` errors in doctor**
- When per-task `queryHistory` fails, doctor emits a warning finding for that task rather than silently skipping
- New test confirms the finding is emitted

**`queryGlobalHistory` silently skips unreadable task directories**
- Skipped directories are counted and optionally surfaced to the caller
- New test: inject unreadable directory → count is non-zero

**No top-level unhandled rejection handler**
- `main.ts` has a `process.on('unhandledRejection', ...)` handler that prints a formatted error and exits with code 1
- Unhandled rejections do not produce raw stack traces


## Summary of Changes

All 16 silent failure patterns have been fixed across the codebase:

- **listTasks**: Returns `{ tasks, warnings }` instead of silently dropping malformed files. All callers (main, tick, status, doctor) surface warnings.
- **tick dedup**: Logs and skips tasks when queryHistory fails (conservative: prevents duplicate dispatches).
- **defaultSpawnAgent**: Returns exit code 127 with diagnostic message when spawn fails.
- **isCronMatch**: Logs exceptions with task/schedule context, still returns false.
- **queryHistory**: Tracks and warns about skipped malformed meta files on stderr.
- **resolveCwd**: Distinguishes ENOENT from EACCES/ELOOP/EIO with new CwdAccessError type.
- **tick purge/heartbeat**: Logs errors, tick still succeeds (non-fatal).
- **log()/readLog**: Write to stderr on failures; readLog distinguishes ENOENT from other errors.
- **defaultKillProcessGroup**: Only silently catches ESRCH; warns on EPERM.
- **setup**: Checks launchctl/crontab exit codes, returns SchedulerCommandError.
- **doctor**: Emits `internal-error` findings when listTasks/validateTasks/queryHistory fail.
- **main.ts**: Added unhandledRejection handler.
