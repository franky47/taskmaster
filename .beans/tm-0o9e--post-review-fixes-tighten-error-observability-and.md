---
# tm-0o9e
title: 'Post-review fixes: tighten error observability and CLI test isolation'
status: completed
type: epic
priority: normal
created_at: 2026-04-30T19:20:44Z
updated_at: 2026-04-30T20:31:32Z
---

## Problem Statement

A multi-reviewer audit of the preflight branch (REVIEWERS.md) flagged three classes of issue that every consumer of `tm run` is exposed to:

1. **History-recording failures vanish.** When `recordHistory` fails (disk full, EACCES, EIO), the CLI prints to stderr and exits as if the run had succeeded. Tick and dispatch spawn child processes with `stdio: 'ignore'`, so even that stderr is discarded. The new `stale-success` and `chronic-preflight-error` doctor signals — added on the same branch — silently degrade because their input data isn't being written, and the next tick re-fires the task because it has no record.

2. **Disk writes inside `executeTask` are unhandled.** Three sites — preflight artifact write, resolved-prompt artifact write, and the agent's output-dir mkdir — use raw `fsPromises` calls inside a function whose signature claims `Promise<ExecuteError | RunResult>`. A throw becomes an unhandled rejection that exits the process *after* preflight ran with side effects but before history was recorded. Callers don't try/catch because the type contract says they don't have to.

3. **CLI behavior under preflight is untested.** The `tm run` action grew ~178 lines on the preflight branch and now branches on `result.kind` for four variants, each with its own JSON envelope and exit-code contract. None of it has CLI-level coverage. A regression dropping the `findings` array from `tm doctor --json`, or flipping an exit code, would be invisible. The integration-test scaffolding the project does have (`run.integration-test.ts`) hits real filesystem paths under `~/.config/taskmaster/`, so historically tests have polluted the user's production logs and history. End-to-end CLI tests cannot be added until that's fenced.

A fourth review category — empty `catch` blocks on internal data with strong types — was deliberately deferred. If the only realistic failure mode of those sites is bypassing the type system, the fix belongs in the type system, not in defensive runtime code.

## Solution

Three coordinated changes, each shippable independently:

1. Surface every `recordHistory` failure through the JSONL log (in addition to the existing stderr write) so doctor signals stay accurate under tick/dispatch and chronic disk problems become visible. Exit codes do not change — the agent's outcome is still the right signal for callers.

2. Move the three unhandled write sites in `executeTask` into a new `writeHistoryArtifact` helper that returns a tagged error. Add the error to the `ExecuteError` union. Any artifact-write failure abandons the run before the agent spawns, ensuring an incomplete run is never persisted as if it succeeded.

3. Make the CLI's config root redirectable for tests (and only for tests) via a `TM_CONFIG_DIR` environment variable, fenced to `NODE_ENV=test`. Add a `main.integration-test.ts` covering the four `tm run --json` envelopes and the `tm doctor --json` exit-code contract. Add one regression unit test for the `signaled:true, exit_code:0` case the existing `signal_outranks_exit_code` memory note warns about.

## User Stories

1. As a user running `tm tick` from cron/launchd, I want history-recording failures to be visible in `~/.config/taskmaster/log.jsonl`, so that `tm doctor` can flag chronic disk problems instead of pretending everything is fine.
2. As a user running `tm run` directly from my terminal, I want history-recording failures to print to stderr (current behavior preserved), so that I see the problem without having to read the log file.
3. As a user whose disk fills up partway through a run, I want the run to abort cleanly with a tagged error, so that the agent doesn't get spawned for work whose result will never be persisted.
4. As a user reading `tm history` after a disk failure, I want the entry to either exist completely or not exist at all — never a half-written meta.json or an artifact file referencing missing siblings.
5. As a maintainer reading the code, I want disk-write failures inside `executeTask` to be expressed in the function's return type, so that I cannot forget to handle them in callers.
6. As a maintainer adding a new artifact type later (e.g. per-run subdirectories), I want a single helper that owns history-artifact filename construction, so that a rename only requires touching one place.
7. As a contributor writing CLI integration tests, I want a way to redirect taskmaster's config root to a temp directory, so that tests cannot pollute my real `~/.config/taskmaster/log.jsonl`, history entries, or run records.
8. As an end user, I want the test-only redirection mechanism to be impossible to trigger by accident in production, so that a stray `TM_CONFIG_DIR` in my shell environment cannot silently move my data.
9. As a maintainer, I want CLI-level tests for `tm doctor --json` to assert the exit-code contract (0 when no findings, 1 when findings) and the presence of the `findings` array, so that a regression dropping either is caught immediately.
10. As a maintainer, I want CLI-level tests for the four `tm run --json` envelope shapes (agent / payload-error / skipped-preflight / preflight-error), so that structural drift in the JSON contract is caught immediately.
11. As a maintainer, I want a regression unit test for `signaled:true, exit_code:0`, so that the bug pattern documented in `signal_outranks_exit_code` cannot reappear.
12. As a maintainer, I want the integration tests to be slow-bucketed (`*.integration-test.ts`) so that the fast `bun run check` loop is not affected.

## Implementation Decisions

### Branch 1 — `recordHistory` failure observability

- All three sites in `main.ts` (agent path, payload-error path, preflight path) gain a `log({ event: 'error', task, reason: 'history-write-failed', cause })` call alongside the existing `console.error`.
- `event: 'error'` is reused rather than introducing a new event type. `checkLogErrors` already buckets `event:'error'` entries into `log-error` doctor findings, giving the new failure mode observability for free.
- Exit codes are unchanged. The agent ran successfully; the failure is bookkeeping. Tick/dispatch parents do not parse exit codes per kind; introducing sentinel codes would be a contract surface with no current consumer.
- Double-counting against doctor thresholds (the existing run-outcome `event:'error'` plus the new `history-write-failed` line) is accepted — chronic disk failure is exactly the kind of thing that should over-flag.

### Branch 2 — Wrap `executeTask` writes

- New module: `src/history/artifact.ts`. Re-exported from `src/history/index.ts`.
- New tagged error: `HistoryArtifactWriteError` with a `stage` field (`'preflight' | 'prompt' | 'output-dir'`). One type with a stage discriminator, not three separate types — there is no behavioral difference at the handler in `main.ts`, and the errore-template style with parameterized message is already idiomatic in this codebase (see `PromptFileWriteError`).
- New helper: `writeHistoryArtifact`. Discriminated-union options:
  - `{ stage: 'preflight' | 'prompt'; task; configRoot?; timestamp; body }` for file writes.
  - `{ stage: 'output-dir'; task; configRoot? }` for the agent output directory.
  - Returns `HistoryArtifactWriteError | string` (history dir path on success).
- Filename construction (`${ts}.preflight.txt`, `${ts}.prompt.txt`) stays internal to the helper. Filename strings are duplicated across other modules (`purge.ts`, `query.ts`, `record.ts`, `logs.ts`, `main.ts`) but that is pre-existing and out of scope for this PR. A note has been added to `ideas.md` proposing a `historyArtifactFilenames` map that all consumers can adopt later.
- `HistoryArtifactWriteError` is added to the `ExecuteError` union in `run.ts`.
- All three call sites in `executeTask` (preflight artifact, prompt artifact, output-dir mkdir) migrate to the helper.
- On any artifact-write failure, `executeTask` returns the error; the run is aborted before the agent spawns. This is consistent across all three sites — site 3 (output-dir mkdir) hits the same disk seconds after sites 1-2, so "soldier on" is incoherent: the agent has nowhere to stream output to.
- The existing `cleanupPromptFile` + `defaultKillProcessGroup` pattern (catch + narrow on expected error code) is preserved as the model for any future internal-state cleanup; it is not modified by this work.

### Branch 4 — CLI test isolation and integration tests

- `src/lib/config.ts` is modified to compute its base directory once at module init. If `process.env.NODE_ENV === 'test'` and `process.env.TM_CONFIG_DIR` is set, the base is `TM_CONFIG_DIR`; otherwise it falls back to `path.join(os.homedir(), '.config', 'taskmaster')` as today.
- All other exports (`tasksDir`, `historyDir`, `runsDir`, `locksDir`, `logFilePath`, `envFilePath`, `agentsFilePath`) continue to derive from the base. No call-site changes required.
- The `NODE_ENV === 'test'` fence is non-bypassable in production builds: `bun test` automatically sets `NODE_ENV=test`, and the integration tests must explicitly pass it via `Bun.spawn({ env: { ..., NODE_ENV: 'test', TM_CONFIG_DIR: tempDir } })`. A user running the compiled binary in a shell that happens to have both env vars set is an acceptable edge case.
- New file: `src/main.integration-test.ts`. Pattern follows `src/run/run.integration-test.ts` (existing prior art) and the `process.execPath + path.resolve(Bun.main)` dev/compiled detection used by `dispatch.ts`, `tick.ts`, and `setup.ts`.
- The test helper creates a temp config root via `mkdtemp`, writes minimal `tasks/<name>.md` and `agents.yml` fixtures into it, spawns the CLI with the test env, captures stdout/stderr/exit, and removes the temp dir on teardown.
- Four CLI-level tests:
  - `tm doctor --json` against a clean config exits 0 and emits `{ findings: [] }`.
  - `tm doctor --json` against a config with a deliberately broken task exits 1 and includes the expected finding kind.
  - `tm run --json` for each of the four `result.kind` branches asserts the JSON envelope shape and the exit-code contract (agent → `exitCode`; payload-error → 0; skipped-preflight → 0; preflight-error → 0).
- One unit test: `signaled:true, exit_code:0` → `error_reason: 'signal'`. Lives next to the existing `defaultSpawnPreflight` exit-classification tests (likely `src/run/run.test.ts`).

### Decisions explicitly deferred / out of scope

- The empty-catch sites flagged as Critical C1 / High H6 / High H7 in REVIEWERS.md (`main.ts:144` payload unlink, `prompt.ts:31` /tmp prompt unlink, `bounded-text.ts:13` UTF-8 decode) are not changed. Each operates on internal, type-checked data; the realistic failure modes are programmer errors or expected ENOENT-style cases. Adding narrowing without a concrete failing scenario would be defensive code masquerading as observability.
- The structural type refactors (`agentRanMeta` discriminator field, `SpawnPreflightResult` twin-boolean tristate collapse, `PreflightOutcome` vs `preflightBlockSchema` deduplication) are sound but pure churn without a forcing function. Tracked elsewhere or left as ambient cleanup.
- The unbounded stdout buffering DoS surface flagged in C5 / I-1 is not addressed. Preflight is local user code with a 60s cap; the concern is theoretical.
- The broader history-artifact filename centralization sweep (5+ call sites for `.output.txt` and `.meta.json`) is logged in `ideas.md` for a follow-up.
- `tm history` output formatting tests are not added. The underlying data layer is already covered by `query.test.ts`; formatting regressions would be cosmetic.

## Testing Decisions

- **A good test asserts external behavior, not implementation details.** For the integration tests, that means: exit codes, JSON envelope shapes, presence/absence of expected log lines, presence/absence of expected files. It does *not* mean: which internal function was called, which specific error class was instantiated, what the in-memory `RunResult` looked like.
- **Test-induced filesystem pollution is unacceptable.** The integration tests must spawn the CLI with `TM_CONFIG_DIR` pointing at a temp directory and clean that directory up on teardown. No test may touch `~/.config/taskmaster/` directly. This is the load-bearing reason Branch 4 exists.
- **Modules tested:**
  - `src/history/artifact.ts` (new) — unit tests for the helper itself: each `stage` writes the expected file (or just creates the directory for `output-dir`), returns the dir path, and surfaces a tagged error on injected failure.
  - `src/run/run.ts` — one new unit test for the `signaled:true, exit_code:0` precedence.
  - `src/main.ts` (via `main.integration-test.ts`) — CLI-level tests for the `tm doctor --json` and `tm run --json` envelope/exit-code contracts.
- **Prior art:**
  - `src/run/run.integration-test.ts` — existing integration test using bun:test with real subprocess spawns. New tests follow this exact shape.
  - `src/dispatch/dispatch.ts`, `src/tick/tick.ts`, `src/setup/setup.ts` — existing `process.execPath + Bun.main` dev/compiled detection. The integration-test helper reuses this pattern.
  - `src/run/run.test.ts` — existing exit-classification tests for `defaultSpawnPreflight` (the `timed_out:true,exit_code:0` and `signaled:true,exit_code:1` cases). The new `signaled:true,exit_code:0` test is a sibling.
  - `src/history/record.test.ts`, `src/history/purge.test.ts`, `src/status/status.test.ts` — existing pattern of in-test temp config dirs via `makeConfigDir`-style helpers (the simplifier review flagged this duplication; reuse rather than re-invent).

## Out of Scope

- Empty-catch hardening for `main.ts:144`, `prompt.ts:31`, `bounded-text.ts:13`. Internal data with strong types; no concrete failure mode worth defending against.
- Type-shape refactors to `SpawnPreflightResult`, `agentRanMeta`, `PreflightOutcome`. Sound advice but pure churn outside of a real change.
- Stdout DoS hardening for `defaultSpawnPreflight`. Local user code under a 60s cap.
- `tm history` rendering tests for the three new kinds. Cosmetic.
- Integration coverage of `defaultSpawnPreflight` real-process behavior (timeout escalation, oversize stdout, invalid UTF-8). Worthwhile but a separate slice.
- Lock-interaction tests for `runTask({lock:true})` with payload-error / preflight-error. Unit-level, not part of this CLI-focused slice.
- The `historyArtifactFilenames` centralization sweep across `purge.ts`, `query.ts`, `record.ts`, `logs.ts`, `main.ts`. Tracked in `ideas.md`.

## Further Notes

- REVIEWERS.md (root of repo) contains the full multi-agent audit that motivated this epic. The "Top 5 actionable items" list there maps to this PRD as: items 1, 2, 4, 5 → addressed; item 3 → deferred (empty catches); item 5 (DoS) → out of scope.
- The brainstorm session that produced this PRD walked the design tree one branch at a time. The key user-driven decisions were: (a) reuse `event:'error'` rather than a new event type for `history-write-failed`; (b) one tagged error with a `stage` field rather than three separate types; (c) discriminated-union options on `writeHistoryArtifact` so `filename`/`body` are statically tied to the file-writing stages; (d) defer the broader filename-centralization sweep with a note in `ideas.md`; (e) drop empty-catch hardening because the realistic failure modes are type-bypass programmer errors; (f) fence `TM_CONFIG_DIR` to `NODE_ENV=test` to make accidental production redirection impossible.
- `feedback_integration_tests.md` (memory) requires `*.integration-test.ts` naming for slow tests so they stay out of the fast check loop. The new file follows that convention.
- `feedback_bun_sfe_argv.md` (memory) requires `process.execPath + Bun.main` for resolving the binary path in tests, not `process.argv`. The integration-test helper follows that.
- This epic groups three slices that should ship as independent PRs in dependency order: Branch 4 (config-root redirection) is a prerequisite for adding any CLI integration tests; Branches 1 and 2 are independent of each other and of Branch 4. Recommended order: 4 → 1 → 2, but 1 and 2 can land in either order.

## Summary of Changes

All three branches landed as independent PRs:

- **Branch 1** (tm-vt9b, commit df0877a): every `recordHistory` failure now emits a `log({ event: 'error', reason: 'history-write-failed' })` line in addition to the existing stderr write, so doctor signals stay accurate under tick/dispatch and chronic disk failures become visible. Reused `event:'error'` rather than introducing a new event type so `checkLogErrors` buckets it for free.
- **Branch 4** (tm-hsnm, commit a70ef07): `src/lib/config.ts` now resolves its base from `TM_CONFIG_DIR` when `NODE_ENV=test` so integration tests can fence themselves to a temp directory. Added `src/main.integration-test.ts` covering the four `tm run --json` envelopes and the `tm doctor --json` exit-code contract, plus the `signaled:true,exit_code:0` regression unit test next to existing `defaultSpawnPreflight` exit-classification tests.
- **Branch 2** (tm-dxs3, commit c237ff2): the three raw `fsPromises` writes inside `executeTask` (preflight artifact, resolved-prompt artifact, agent output-dir) moved behind a single `writeHistoryArtifact` helper that returns a tagged `HistoryArtifactWriteError` with a `stage` discriminator. The error is now part of the `ExecuteError` union, so any artifact-write failure aborts the run before the agent spawns — verified by a regression test.

Deferred items (per the original PRD) remain deferred: empty-catch hardening at internal-data sites, structural type refactors, stdout DoS mitigation, the broader history-artifact filename centralization sweep, and `tm history` rendering tests.
