---
# tm-dxs3
title: Wrap unhandled writes in executeTask with a tagged error
status: completed
type: bug
priority: high
created_at: 2026-04-30T19:25:12Z
updated_at: 2026-04-30T20:30:22Z
parent: tm-0o9e
---

## What to build

The three raw `fsPromises` writes inside `executeTask` (preflight artifact at `run.ts:501-506`, resolved-prompt artifact at `run.ts:551-555`, output-dir mkdir at `run.ts:568`) currently throw on disk failure, becoming unhandled rejections that callers cannot see in the function's `Promise<ExecuteError | RunResult>` return type. Move them behind a single helper that returns a tagged error, and add the error to the `ExecuteError` union so the type system makes failure handling unforgettable.

See parent PRD `tm-0o9e` § "Branch 2 — Wrap `executeTask` writes" for full design rationale, including why one tagged error with a `stage` discriminator is preferred over three separate types, and why any artifact-write failure aborts the run before agent spawn.

## Acceptance criteria

- [x] New module `src/history/artifact.ts` exports `writeHistoryArtifact` and `HistoryArtifactWriteError`
- [x] `HistoryArtifactWriteError` is a tagged error (errore-style) with a `stage: 'preflight' | 'prompt' | 'output-dir'` field, message includes the path that failed
- [x] `writeHistoryArtifact` accepts a discriminated-union options shape: `{ stage: 'preflight' | 'prompt'; task; configRoot?; timestamp; body }` for file-writing stages, `{ stage: 'output-dir'; task; configRoot? }` for the directory-creation stage — caller cannot statically pass `body` for `output-dir` or omit it for `preflight`/`prompt`
- [x] `writeHistoryArtifact` returns `HistoryArtifactWriteError | string` where the string is the history dir path on success
- [x] Helper is re-exported from `src/history/index.ts`
- [x] `HistoryArtifactWriteError` is added to the `ExecuteError` union in `src/run/run.ts`
- [x] All three call sites in `executeTask` (`run.ts:501-506`, `run.ts:551-555`, `run.ts:568`) migrate to `writeHistoryArtifact` and return the error on failure (the caller's `if (result instanceof Error) return result` pattern)
- [x] On any artifact-write failure, the run is aborted before the agent spawns — verified by a unit test that injects a failure at site 1 (preflight artifact) and asserts the agent's spawn fn is never invoked
- [x] Unit tests for `writeHistoryArtifact` cover each stage: success path returns the dir path and writes the expected file (or just creates the dir for `output-dir`); injected failure returns a `HistoryArtifactWriteError` with the correct `stage`
- [x] `main.ts` handles the new `HistoryArtifactWriteError` in its existing `if (result instanceof Error)` branch — no new branch required since the error type extends `Error`
- [x] Filename construction (`${ts}.preflight.txt`, `${ts}.prompt.txt`) lives inside the new helper; broader filename centralization sweep is explicitly deferred (tracked in `ideas.md`)
- [x] `bun run check` passes after the change (typecheck, lint, knip, tests)

## User stories addressed

Reference by number from parent PRD `tm-0o9e`:

- User story 3
- User story 4
- User story 5
- User story 6

## Summary of Changes

Added `src/history/artifact.ts` exporting `writeHistoryArtifact` and the errore-tagged `HistoryArtifactWriteError` (with `stage: preflight|prompt|output-dir` field). Helper takes a discriminated-union options shape that statically requires `body`+`timestamp` on file-writing stages and forbids them on `output-dir`. Returns `HistoryArtifactWriteError | string` (history dir on success).

Migrated all three raw `fsPromises` write/mkdir sites in `executeTask` (`run.ts`) to the helper, returning the error on failure. Added `HistoryArtifactWriteError` to the `ExecuteError` union so callers cannot forget to handle it. `main.ts` needs no change — its existing `instanceof Error` branch covers the new variant.

Unit tests cover each stage success+failure path using the established file-as-dir injection pattern (no mocks). Added a regression test in `run.test.ts` proving the agent is never spawned when the preflight artifact write fails.
