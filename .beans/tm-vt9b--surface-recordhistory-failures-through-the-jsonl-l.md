---
# tm-vt9b
title: Surface recordHistory failures through the JSONL log
status: completed
type: bug
priority: high
created_at: 2026-04-30T19:25:12Z
updated_at: 2026-04-30T20:11:21Z
parent: tm-0o9e
---

## What to build

When `recordHistory` fails inside the `tm run` action handler, write a structured entry to the JSONL log in addition to the existing stderr message, so chronic disk problems become visible to `tm doctor` even under `tm tick` / `tm dispatch` (where the child process's stderr is `stdio: 'ignore'` and discarded). Exit codes are unchanged.

See parent PRD `tm-0o9e` § "Branch 1 — `recordHistory` failure observability" for full design rationale, including why `event:'error'` is reused rather than introducing a new event type, and why exit codes are deliberately not escalated.

## Acceptance criteria

- [x] In `src/main.ts`, the agent path writes a JSONL log entry on `recordHistory` failure, in addition to stderr — implemented via `notifyHistoryWriteFailure` helper
- [x] Same call added on the payload-error path
- [x] Same call added on the skipped-preflight / preflight-error path
- [x] Exit codes unchanged
- [x] `console.error(recordErr.message)` preserved (default `stderr` dep)
- [x] Unit tests in `src/history/notify-failure.test.ts` verify both JSONL log entry and stderr write via injected deps
- [x] Picked up by `checkLogErrors` without doctor changes — entry shape matches `event:'error' && 'error' in entry` predicate (test asserts this)
- [x] `bun run check` passes

## User stories addressed

Reference by number from parent PRD `tm-0o9e`:

- User story 1
- User story 2

## Summary of Changes

Added `notifyHistoryWriteFailure(err, taskName, deps?)` helper in `src/history/notify-failure.ts`, exported via `src/history/index.ts`. Replaces the bare `console.error(recordErr.message)` at the three failure sites in `src/main.ts` (agent, payload-error, skipped-preflight/preflight-error) so a JSONL log entry is also written.

### Design deviation from bean text

The bean suggested `log({event:'error', task, reason:'history-write-failed', cause: msg})`. The implementation instead reuses the existing `errorEntrySchema` shape via `log({event:'error', task, error: recordErr})` — passing the errore-tagged `HistoryWriteError` that `recordHistory` already returns. This avoids a schema extension and a `checkLogErrors` broadening: the existing predicate `entry.event === 'error' && 'error' in entry` matches automatically, satisfying the "no new doctor wiring" criterion. `name: 'HistoryWriteError'` survives `serializeError` so the failure type is identifiable in JSONL.

### Tests

DI-style: `notifyHistoryWriteFailure` accepts `{log, logFilePath, stderr}` overrides; tests inject fakes and assert behavior. The 3 sites in `main.ts` are thin wrappers around this helper, verified by inspection.

### Files

- `src/history/notify-failure.ts` (new)
- `src/history/notify-failure.test.ts` (new)
- `src/history/index.ts` (export)
- `src/main.ts` (3 wired sites)
