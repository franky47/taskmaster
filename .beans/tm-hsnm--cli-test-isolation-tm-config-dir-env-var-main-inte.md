---
# tm-hsnm
title: 'CLI test isolation: TM_CONFIG_DIR env var + main integration tests + signaled regression'
status: completed
type: feature
priority: high
created_at: 2026-04-30T19:25:09Z
updated_at: 2026-04-30T20:12:58Z
parent: tm-0o9e
---

## What to build

Make the CLI's config root redirectable for tests, fenced so it cannot be triggered in production. Add the first CLI-level integration tests covering `tm doctor --json` and the four `tm run --json` envelope shapes. Add a regression unit test for the `signaled:true, exit_code:0` precedence case the existing `signal_outranks_exit_code` memory note warns about.

See parent PRD `tm-0o9e` § "Branch 4 — CLI test isolation and integration tests" for full design rationale, including why `NODE_ENV=test` fencing is the right shape and why the integration tests must spawn real subprocesses rather than running in-process.

## Acceptance criteria

- [x] `src/lib/config.ts` reads a base directory once at module init: if `process.env.NODE_ENV === 'test'` and `process.env.TM_CONFIG_DIR` is set, the base is `TM_CONFIG_DIR`; otherwise it falls back to `path.join(os.homedir(), '.config', 'taskmaster')`
- [x] All exports from `lib/config.ts` (`configDir`, `tasksDir`, `historyDir`, `runsDir`, `locksDir`, `logFilePath`, `envFilePath`, `agentsFilePath`) continue to derive from the base; no call-site changes elsewhere
- [x] In production builds (no `NODE_ENV=test`), setting `TM_CONFIG_DIR` has no effect — verified by a unit test
- [x] When both `NODE_ENV=test` and `TM_CONFIG_DIR` are set, all paths derive from `TM_CONFIG_DIR` — verified by a unit test
- [x] New file `src/main.integration-test.ts` follows the existing `*.integration-test.ts` convention so it stays out of the fast `bun run check` loop
- [x] Integration test helper creates a temp config root via `mkdtemp`, writes minimal task fixtures into it, spawns the CLI via `[process.execPath, path.resolve(Bun.main)]` (matching the dev/compiled detection used in `dispatch.ts`/`tick.ts`/`setup.ts`), captures stdout/stderr/exit, and removes the temp dir on teardown
- [x] Integration test: `tm doctor --json` against a clean config exits 0 and emits `{ findings: [] }` (or equivalent empty-findings shape)
- [x] Integration test: `tm doctor --json` against a config with a deliberately broken task exits 1 and includes the expected finding kind
- [x] Integration test: `tm run --json` for a task that produces an `agent` result asserts the envelope shape (`{ skipped, exitCode, timedOut, duration_ms }`) and exits with the agent's exit code
- [x] Integration test: `tm run --json` for a task that produces a `payload-error` result asserts `{ payload_error: true, error_reason, taskName }` and exits 0
- [x] Integration test: `tm run --json` for a task that produces a `skipped-preflight` result asserts `{ skipped: true, preflight_error: false, taskName }` and exits 0
- [x] Integration test: `tm run --json` for a task that produces a `preflight-error` result asserts `{ skipped: false, preflight_error: true, taskName }` and exits 0
- [x] No integration test reads or writes any path under `~/.config/taskmaster/` — verified by code inspection
- [x] Unit test in `src/run/run.test.ts` (next to existing exit-classification tests): `signaled: true, exit_code: 0` produces `error_reason: 'signal'`
- [x] `bun run check` passes after the change

## User stories addressed

Reference by number from parent PRD `tm-0o9e`:

- User story 7
- User story 8
- User story 9
- User story 10
- User story 11
- User story 12

## Summary of Changes

- `src/lib/config.ts`: extracted `resolveConfigBase(env)` that returns `TM_CONFIG_DIR` only when `NODE_ENV=test`. All path exports continue to derive from the resolved base — no call-site changes anywhere.
- `src/lib/config.test.ts` (new): four unit tests covering the truth table for the test-fence (NODE_ENV present/absent, TM_CONFIG_DIR present/absent).
- `src/run/run.test.ts`: added one regression test asserting that `signaled:true, exit_code:0` classifies as `error_reason:'signal'`. The implementation was already correct (signaled is checked before exit_code in the ladder); the test guards against future drift documented in the `signal_outranks_exit_code` memory.
- `src/main.integration-test.ts` (new): seven CLI-level integration tests that spawn `tm` with `NODE_ENV=test`, `TM_CONFIG_DIR=<tempdir>`, and `HOME=<tempdir>/.home`. Covers the two doctor exit-code/finding contracts and all four `tm run --json` envelope shapes (plus a non-zero exit-code propagation case).
- `package.json`: `test:integration` glob extended to `./src/*-test.ts ./src/**/*-test.ts` so the new top-level integration file is picked up (the previous glob only matched nested files).

## Notes

The "clean config" doctor test fakes the macOS LaunchAgents plist under the redirected `HOME`; on Linux the same setup leaves a `scheduler-not-installed` finding which the test filters out per the AC's "equivalent empty-findings shape" carve-out.
