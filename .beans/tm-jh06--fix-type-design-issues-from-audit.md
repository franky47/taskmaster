---
# tm-jh06
title: Fix type design issues from audit
status: completed
type: task
priority: normal
created_at: 2026-04-09T11:33:55Z
updated_at: 2026-04-09T14:17:37Z
---

## Context

A type design audit identified 6 actionable improvements. The codebase is already excellent (zero `any`, zero `interface`, Zod at all boundaries), but these items would tighten invariant enforcement and consistency.

## Work Items

- [ ] `src/tick/tick.ts`: Make `TickResult` a discriminated union on `dry_run` — currently `heartbeat: ''` and `purged: 0` in dry-run mode are convention, not type-enforced
- [ ] `src/setup/setup.ts`: Replace bare `new Error(...)` returns in `setup()`/`teardown()` with tagged error classes (e.g. `UnsupportedPlatformError`) — only place in codebase breaking the tagged-error convention
- [ ] `src/logger.ts`: Use `z.iso.datetime()` for the `ts` field in `logEntrySchema` — currently any string passes validation for timestamps
- [ ] `tsconfig.json`: Enable `noPropertyAccessFromIndexSignature` — currently `false`, contradicting stricter typing goals
- [ ] `src/history/record.ts`: Make `RecordArtifacts.cwd` accept `ResolvedCwd` directly and handle the `isTemp` → `is_temp` mapping internally, reducing manual mapping in `main.ts`
- [ ] `src/lock/lock.ts`: Make `LockAcquired` implement `Disposable` so the `using` pattern works directly after narrowing, instead of requiring a `DisposableStack` wrapper


## Acceptance Criteria

### `TickResult` discriminated union
- `TickResult` is a union of `{ dry_run: true; dispatched: string[]; skipped: string[] }` and `{ dry_run: false; dispatched: string[]; skipped: string[]; heartbeat: string; purged: number }`
- Accessing `heartbeat` or `purged` on a dry-run result is a compile-time error
- All callers of `tick()` narrow on `dry_run` before accessing variant-specific fields
- `tsc --noEmit` passes

### Tagged errors in `setup()`/`teardown()`
- `UnsupportedPlatformError` (or equivalent tagged class) replaces bare `new Error(...)` for unsupported platforms
- Callers can distinguish unsupported-platform errors from other errors via `instanceof`
- Existing tests pass; new test confirms the error is an instance of the tagged class

### `z.iso.datetime()` for log timestamps
- `logEntrySchema` uses `z.iso.datetime()` (or equivalent) for the `ts` field
- Malformed timestamps in log lines are rejected during `readLog` parsing (skipped like other malformed lines)
- Existing log tests pass; new test confirms a non-ISO timestamp is rejected

### `noPropertyAccessFromIndexSignature`
- `tsconfig.json` has `noPropertyAccessFromIndexSignature: true`
- All `Record<string, unknown>` accesses in the codebase use bracket notation
- `tsc --noEmit` passes

### `RecordArtifacts.cwd` accepts `ResolvedCwd`
- `RecordArtifacts.cwd` field type is `ResolvedCwd` (imported from `src/run/cwd.ts`)
- The `isTemp` → `is_temp` mapping happens inside `recordHistory()`, not at the call site in `main.ts`
- `main.ts` passes `result.cwd` directly without manual field mapping
- Existing tests pass

### `LockAcquired` implements `Disposable`
- `LockAcquired` has a `[Symbol.dispose]()` method that calls `releaseLock(fd)`
- Callers can use `using lock = ...` after narrowing the lock result
- The `DisposableStack` wrapper in `runTask()` is removed or simplified
- Lock release still happens on error paths (verified by test)
