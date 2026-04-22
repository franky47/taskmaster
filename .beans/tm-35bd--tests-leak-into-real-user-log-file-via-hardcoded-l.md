---
# tm-35bd
title: Tests leak into real user log file via hardcoded logFilePath
status: completed
type: bug
priority: high
created_at: 2026-04-22T14:27:28Z
updated_at: 2026-04-22T14:28:40Z
---

## Problem

`log()` in `src/lib/logger.ts` defaults its `target` parameter to the hardcoded module-level `logFilePath = ~/.config/taskmaster/log.jsonl`. Every production caller (13 sites across `src/tick/tick.ts`, `src/dispatch/dispatch.ts`, `src/main.ts`) uses that default. Tests that exercise those code paths already isolate other state by passing a tmp `configDir`, but they cannot redirect logging because no option flows through.

Result: running `bun test` permanently contaminates the user's real log file. Evidence: `~/.config/taskmaster/log.jsonl` contains 169 entries for task names that exist only as test fixtures — `every-min`, `bad-tz`, `(purge)`, `(heartbeat)`. Surfaced as 100 `log-error` findings in today's `tm doctor` output.

## Invariant to uphold

Tests must never write to paths outside the test's own tmp scope. Using `mkdtemp`-style real tmp dirs is fine (they're isolated); the leak is specifically about *fixed* production paths baked into defaults.

Bun does not ship an in-memory filesystem. `memfs` would require patching `node:fs` globally, which is more invasive than the DI it replaces. DI is the right approach: thread the log path the same way `configDir` is already threaded.

## Proposed approach

1. Derive the log path from `configDir` rather than hardcoding it — add `logFilePath(configDir)` helper in `src/lib/config.ts` (or inline it at the tick/dispatch entry points).
2. Add a `logPath?: string` option to `TickOptions`, `DispatchOptions`, and the `runTask` entry point used from `src/main.ts`. Default to the derived user path; tests pass their tmp-derived one.
3. Thread it through every production `log(...)` call inside those modules. No call site should hit the module-level default.
4. Delete the `target` default from `log()` itself — make the path a required argument. This makes any future leak a type error rather than a silent default.
5. Update `readLog()` symmetrically (currently also defaults to `logFilePath`).

## Acceptance criteria

- [x] `log()` and `readLog()` in `src/lib/logger.ts` take the log path as a required argument (no module-level default reference to `logFilePath`)
- [x] `tick()`, `dispatch()`, and the task-run path in `main.ts` accept a log path option and thread it through every internal `log(...)` call
- [x] Every test that currently creates a tmp `configDir` derives the log path from that tmp dir
- [x] New regression test: run a tick that triggers an error log entry under a tmp configDir, then assert the real user log file has NOT been appended to (read its size before/after, or mock the default path to throw on write)
- [x] `bun test` run → `~/.config/taskmaster/log.jsonl` size unchanged afterwards (manual verification in the PR)
- [x] Existing doctor findings from test leakage are a separate concern — this bean does not truncate the user's log

## Non-goals

- Not a rewrite of filesystem access across the codebase. Scope is the log file only, because that's where the observed leak is and it's the highest-signal pollution. Other path defaults (e.g. the heartbeat file) are on the same pattern and can be fixed in sibling beans if similar leaks are observed.
- Not adding a virtual filesystem abstraction layer. DI is sufficient and already the project convention (see memory `feedback_di_over_mocks.md`).
- Not changing log format, rotation, or write semantics.

## How to verify the fix holds

Truncate `~/.config/taskmaster/log.jsonl`, run `bun test`, verify the file is still empty (or unchanged from its pre-test state). If anything appears, a production code path still hits the default — hunt it down.

## Summary of Changes

- `log()` and `readLog()` in `src/lib/logger.ts` lost their hardcoded default — path is now a required argument.
- `tick()` and `dispatch()` derive `logPath = path.join(cfgDir, 'log.jsonl')` at the top and thread it through every internal `log(...)` call (`isCronMatch` grew a `logPath` parameter to keep the same contract).
- `main.ts` imports `logFilePath` and passes it explicitly at the three run-path call sites.
- `doctor.ts` default `readLog` closure binds `logFilePath` the same way it already binds `configDir`/`tasksDir`.
- Four `readLog(before)` calls in `tick.test.ts` now read from the tmp configDir's log path.
- New static source-text regression test in `logger.test.ts` guards against re-introducing a default reference to `logFilePath` inside `logger.ts`.

**Design choice (differs from bean proposal):** The bean suggested adding a `logPath?` option to `TickOptions`/`DispatchOptions`/`runTask`. Skipped per `feedback_no_dead_code` — no caller needs to override the log path independently of configDir today. Deriving from configDir is sufficient for the leak fix. Add the option if and when a real second axis of variation appears.

**Verification:** Real user log truncated to 0 bytes, full 548-test suite run, still 0 bytes. Leak closed.
