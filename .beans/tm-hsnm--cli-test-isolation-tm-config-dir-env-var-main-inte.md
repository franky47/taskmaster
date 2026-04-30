---
# tm-hsnm
title: 'CLI test isolation: TM_CONFIG_DIR env var + main integration tests + signaled regression'
status: todo
type: feature
priority: high
created_at: 2026-04-30T19:25:09Z
updated_at: 2026-04-30T19:25:09Z
parent: tm-0o9e
---

## What to build

Make the CLI's config root redirectable for tests, fenced so it cannot be triggered in production. Add the first CLI-level integration tests covering `tm doctor --json` and the four `tm run --json` envelope shapes. Add a regression unit test for the `signaled:true, exit_code:0` precedence case the existing `signal_outranks_exit_code` memory note warns about.

See parent PRD `tm-0o9e` § "Branch 4 — CLI test isolation and integration tests" for full design rationale, including why `NODE_ENV=test` fencing is the right shape and why the integration tests must spawn real subprocesses rather than running in-process.

## Acceptance criteria

- [ ] `src/lib/config.ts` reads a base directory once at module init: if `process.env.NODE_ENV === 'test'` and `process.env.TM_CONFIG_DIR` is set, the base is `TM_CONFIG_DIR`; otherwise it falls back to `path.join(os.homedir(), '.config', 'taskmaster')`
- [ ] All exports from `lib/config.ts` (`configDir`, `tasksDir`, `historyDir`, `runsDir`, `locksDir`, `logFilePath`, `envFilePath`, `agentsFilePath`) continue to derive from the base; no call-site changes elsewhere
- [ ] In production builds (no `NODE_ENV=test`), setting `TM_CONFIG_DIR` has no effect — verified by a unit test
- [ ] When both `NODE_ENV=test` and `TM_CONFIG_DIR` are set, all paths derive from `TM_CONFIG_DIR` — verified by a unit test
- [ ] New file `src/main.integration-test.ts` follows the existing `*.integration-test.ts` convention so it stays out of the fast `bun run check` loop
- [ ] Integration test helper creates a temp config root via `mkdtemp`, writes minimal task fixtures into it, spawns the CLI via `[process.execPath, path.resolve(Bun.main)]` (matching the dev/compiled detection used in `dispatch.ts`/`tick.ts`/`setup.ts`), captures stdout/stderr/exit, and removes the temp dir on teardown
- [ ] Integration test: `tm doctor --json` against a clean config exits 0 and emits `{ findings: [] }` (or equivalent empty-findings shape)
- [ ] Integration test: `tm doctor --json` against a config with a deliberately broken task exits 1 and includes the expected finding kind
- [ ] Integration test: `tm run --json` for a task that produces an `agent` result asserts the envelope shape (`{ skipped, exitCode, timedOut, duration_ms }`) and exits with the agent's exit code
- [ ] Integration test: `tm run --json` for a task that produces a `payload-error` result asserts `{ payload_error: true, error_reason, taskName }` and exits 0
- [ ] Integration test: `tm run --json` for a task that produces a `skipped-preflight` result asserts `{ skipped: true, preflight_error: false, taskName }` and exits 0
- [ ] Integration test: `tm run --json` for a task that produces a `preflight-error` result asserts `{ skipped: false, preflight_error: true, taskName }` and exits 0
- [ ] No integration test reads or writes any path under `~/.config/taskmaster/` — verified by code inspection
- [ ] Unit test in `src/run/run.test.ts` (next to existing exit-classification tests): `signaled: true, exit_code: 0` produces `error_reason: 'signal'`
- [ ] `bun run check` passes after the change

## User stories addressed

Reference by number from parent PRD `tm-0o9e`:

- User story 7
- User story 8
- User story 9
- User story 10
- User story 11
- User story 12
