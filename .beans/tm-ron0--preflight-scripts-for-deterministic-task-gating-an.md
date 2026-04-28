---
# tm-ron0
title: Preflight scripts for deterministic task gating and prompt injection
status: todo
type: epic
created_at: 2026-04-28T14:38:37Z
updated_at: 2026-04-28T14:38:37Z
---

## Problem Statement

Tasks today always invoke their agent when due. For many real-world workflows, this wastes tokens, money, and time when there is nothing to do — checking an inbox that has no new mail, summarizing a feed that has not changed, processing a queue that is empty. The existing `requires` mechanism only models *environment capability* (network reachable, AC power available); it cannot answer the task-specific question "is there any work for the agent right now?".

Users also want richer task inputs than what static prompt bodies and the implicit dispatch-payload append can express: fetching context from an external API, transforming an event payload, or formatting state into a prompt fragment. There is no first-class place for that work to happen, deterministically, before the agent runs.

## Solution

Introduce **preflight**: an optional per-task shell command, declared in frontmatter, that runs deterministically before the agent. Its exit code decides whether the agent runs, and its stdout can be injected into the prompt at user-chosen positions via a token.

- `preflight: '<shell command>'` in frontmatter. Same shell, env, and cwd as the existing `run` field.
- Exit codes: `0` = run the agent, `1` = clean skip, anything else = error. Modeled on `grep -q` semantics.
- Two prompt-body tokens, both self-closing JSX-style and uppercase:
  - `<PREFLIGHT/>` — substituted with preflight stdout (UTF-8, trimmed).
  - `<PAYLOAD/>` — substituted with the dispatch payload (trimmed). Allowed only on event tasks.
- Both tokens are substituted in a single regex pass (no recursive substitution). Each capped at 1 MB.
- Preflight always runs, regardless of trigger (`tick`, `tm dispatch`, `tm run`). It is not a bypassable gate — it may also be a *prep* step with side effects. `tm run` no longer bypasses anything new; it bypasses `enabled` and `requires` exactly as today.
- The implicit `task.prompt + '\n---\n' + payload` append is removed. `<PAYLOAD/>` is the only path payload takes into the prompt; tasks that want it write `<PAYLOAD/>` (or `<PREFLIGHT/>` if they preprocess it) at the desired position.
- Preflight runs after lock acquisition, inside the same per-task critical section as the agent.
- Preflight stdout, stderr, exit code, duration, and the resolved prompt (when injection happened) are persisted to the task's history directory, surfacing in `tm history`, `tm status`, and `tm doctor`.

Greenfield project: no compatibility shim for the dropped payload-append behavior.

## User Stories

1. As a user with a daily inbox-summary task, I want the agent to be invoked only when the inbox has new mail, so that I do not pay for empty runs.
2. As a user pulling a remote feed, I want a preflight script to compare the latest fetch against the previous one and skip the agent if nothing changed, so that idempotent fetches do not waste tokens.
3. As a user, I want a single field `preflight: '<shell command>'` in frontmatter, so that gating logic stays in the task file and is versioned alongside it.
4. As a user, I want preflight to use any interpreter (bun, python, bash, inline `test ...`), so that I am not forced into one runtime.
5. As a user, I want preflight to inherit the task's env (system + `.env` + per-task `env`) and `cwd`, so that gating logic uses the same context as the agent.
6. As a user, I want exit code `0` to mean "run the agent", so that natural shell idioms like `test -s file` and `grep -q pattern` work without inversion.
7. As a user, I want exit code `1` to mean "clean skip", so that I can express "no work to do" with a normal non-zero exit.
8. As a user, I want any exit code `≥ 2` (or signal/timeout/oversize/encoding error) to be treated as an error, so that broken preflight scripts surface loudly instead of silently skipping forever.
9. As a user, I want preflight to time out at 60 seconds, so that a hung script cannot block the next scheduled tick indefinitely.
10. As a user, I want preflight stdout to be capturable into the prompt via a `<PREFLIGHT/>` token in the markdown body, so that I can inject deterministic context for the agent at a chosen position.
11. As a user, I want all occurrences of `<PREFLIGHT/>` to be substituted, so that I can repeat the injected content if the prompt structure needs it.
12. As a user, I want `<PREFLIGHT/>` in the body without a `preflight` field declared to fail validation at parse time, so that I catch typos before runtime.
13. As a user, I want declaring `preflight` without a `<PREFLIGHT/>` token to be allowed, so that I can use preflight as a pure gate or side-effect prep step.
14. As a user, I want a `<PAYLOAD/>` token to inject the dispatch event payload directly into the prompt, so that trivial event tasks do not need a preflight script just to forward payload.
15. As a user, I want `<PAYLOAD/>` to be valid only in event tasks, so that scheduled tasks fail validation if they reference a payload that cannot exist.
16. As a user, I want `<PAYLOAD/>` on an event task dispatched without payload to substitute as empty, so that the same task definition works whether or not a payload is provided.
17. As a user, I want both tokens substituted in a single pass, so that content from one source containing the other token's literal is never re-substituted.
18. As a user, I want preflight stdout and the payload to each be capped at 1 MB, so that runaway output cannot blow up the prompt or storage.
19. As a user, I want oversize stdout, invalid UTF-8, signal exit, and timeout to all be treated as preflight errors with distinct `error_reason` fields, so that I can diagnose failure modes from history.
20. As a user, I want the implicit `\n---\n` append of dispatch payloads to be removed, so that there is one — and only one — way for payload to enter the prompt.
21. As a user, I want preflight to run inside the same lock as the agent, so that two concurrent runs of the same task cannot stomp on each other's preflight side effects.
22. As a user, I want `tm run <name>` to always run preflight, so that gating and preparation behavior is identical regardless of trigger.
23. As a user dispatching events, I want preflight to see `TM_EVENT_NAME` and `TM_EVENT_PAYLOAD_FILE` env vars, so that I can validate or transform the payload before deciding to skip or proceed.
24. As a user, I want `TM_TASK_NAME`, `TM_TRIGGER`, and `TM_RUN_TIMESTAMP` exposed to preflight (and to `run`), so that scripts have stable identifiers without parsing argv.
25. As a user, I want preflight stdout captured even on exit code `1`, so that I can diagnose why a script meant to detect work decided there was none.
26. As a user, I want preflight stdout and stderr captured even on error, so that I can debug crashes or misbehaving scripts from history alone.
27. As a user, I want a `skipped-preflight` history entry written for clean skips, so that `tm history` shows the full timeline including gate decisions, not just agent runs.
28. As a user, I want a `preflight-error` history entry written for errors, so that broken scripts are visible in the same place as failed runs.
29. As a user, I want the resolved prompt (post-substitution) persisted to history when injection actually happened, so that I can audit exactly what the agent saw.
30. As a user running `tm history <name>`, I want preflight skip and error rows to appear inline with run rows by default, so that I can read the full timeline at a glance.
31. As a user running `tm history <name> --failures`, I want `preflight-error` rows to be included, so that error triage covers preflight failures too.
32. As a user running `tm list`, I want a `[preflight]` marker on tasks that declare a preflight, so that I can quickly tell which tasks have gating.
33. As a user running `tm status`, I want the last status to display verbatim (including `skipped-preflight` and `preflight-error`), so that I do not have to interpret abstracted state.
34. As a user running `tm doctor`, I want chronic `preflight-error` runs (3+ consecutive) flagged as critical, so that I notice broken scripts quickly.
35. As a user running `tm doctor`, I want tasks whose last successful run is more than 14 days old (and that have run before) flagged as info, so that dead or chronically-skipping tasks become visible without spamming for normal rare-event tasks.
36. As a developer maintaining the codebase, I want token substitution and cap enforcement implemented as a single shared module used by both `<PREFLIGHT/>` and `<PAYLOAD/>`, so that the two paths cannot drift apart.
37. As a developer, I want the runner step ordering to be: resolve cwd → assemble env → acquire lock → run preflight → handle exit-code branch → resolve prompt → write `TM_PROMPT_FILE` → spawn agent, so that the contract is unambiguous and testable.
38. As a developer, I want preflight to be modeled in Zod just like other frontmatter fields, so that validation is consistent with the existing parser.

## Implementation Decisions

### Frontmatter

- New optional field `preflight: string` (non-empty when present). No co-occurrence rules with other fields.
- Body-level validation: presence of `<PREFLIGHT/>` in the prompt body without a `preflight` field is a parse error. Presence of `<PAYLOAD/>` on a task whose `on` is not `event` is a parse error.
- Tokens are matched by a strict regex: uppercase only, optional whitespace before `/>`. No attributes, no opening/closing pair.

### Exit-code semantics

- `0` → run the agent.
- `1` → clean skip; record `status: skipped-preflight`.
- ≥ `2`, signal, timeout (60 s hard cap), oversize stdout (> 1 MB), invalid UTF-8 → record `status: preflight-error` with an `error_reason` field discriminating `nonzero | signal | timeout | oversize-stdout | invalid-utf8`.

### Runner ordering

The `tm run` process performs, in order:

1. Resolve cwd (create temp dir if needed).
2. Assemble env: system + `.env` + per-task `env` + `TM_TASK_NAME` + `TM_TRIGGER` + `TM_RUN_TIMESTAMP` + (when triggered by dispatch) `TM_EVENT_NAME` + `TM_EVENT_PAYLOAD_FILE`.
3. Acquire per-task lock; on contention, log and exit (existing behavior).
4. If `preflight` is set: spawn it with the assembled env and cwd, 60 s timeout. Capture stdout (UTF-8, ≤ 1 MB), stderr, exit code, duration. Branch on the exit code.
5. Resolve the prompt: a single regex pass over the markdown body substituting `<PREFLIGHT/>` and `<PAYLOAD/>` simultaneously. Each replacement is independently capped at 1 MB.
6. Write the resolved prompt to `TM_PROMPT_FILE`. If any token was actually substituted with non-empty content, persist `<ts>.prompt.txt` to history.
7. Spawn the agent with the assembled env (plus `TM_PROMPT_FILE`) and the task `timeout`.
8. Persist `<ts>.meta.json` and `<ts>.output.txt` as today, and a `<ts>.preflight.txt` whenever preflight ran.
9. Release lock (ensured on every exit path).

### History schema additions

- New `status` values: `skipped-preflight`, `preflight-error`.
- Existing meta gains a `preflight: { exit_code, duration_ms, stdout_bytes, stderr_bytes, error_reason? }` block when preflight ran.
- New per-run files: `<ts>.preflight.txt` (stdout + stderr, both tail-truncated to ~2 KB on the error path, full on the success/skip path), `<ts>.prompt.txt` (resolved body, only when substitution happened).

### Trigger-uniform behavior

- Preflight runs on every trigger: `tick`, `tm dispatch`, `tm run`.
- `tm run` continues to bypass `enabled` and `requires` as today; it does **not** bypass preflight.
- `requires` continues to be evaluated upstream (in `tick` and `dispatch`) as today; preflight runs downstream in the runner.

### Removed behavior

- The existing `task.prompt + '\n---\n' + payload` append is removed entirely. Payload reaches the prompt only via `<PAYLOAD/>` substitution.

### Modules

- A new shared substitution module (likely `src/lib/prompt-template/`) owns: token regex, single-pass substitution, per-token 1 MB cap, UTF-8 validation, leading/trailing whitespace trim, validation helpers (token-without-field for preflight, token-on-non-event for payload).
- Frontmatter Zod schema gains `preflight`.
- The runner (`src/run/run.ts`) gains the preflight stage, env assembly additions, history-meta enrichment, and removal of the payload-append branch.
- History writers gain `skipped-preflight` and `preflight-error` statuses and the new sibling files.
- `tm list`, `tm status`, `tm history`, and `tm doctor` are extended to surface preflight signals.
- Dispatch keeps writing the payload temp file but no longer triggers an implicit prompt append.

## Testing Decisions

Good tests assert externally observable behavior of the run lifecycle and prompt resolution: exit-code → status mapping, token substitution outputs, history files written, env exposed to the script, lock ordering. They do not assert on internal call shapes or private helpers. Existing tests in `src/run/run.test.ts`, `src/run/prompt.test.ts`, `src/dispatch/dispatch.test.ts`, `src/lib/task/frontmatter.test.ts`, and `src/lib/requirements/filter.test.ts` are the prior art for shape, naming, and DI patterns.

Modules to cover with tests:

- Shared substitution module: token regex (positive and negative cases, whitespace tolerance, case strictness), single-pass non-recursive substitution, per-token 1 MB cap (success at boundary, error above), UTF-8 validation, whitespace trim, validation rules (token-without-field, payload-on-scheduled).
- Frontmatter parser: `preflight` field accepted as non-empty string; rejected when empty; body-token validation rules.
- Runner: each exit-code branch (`0`, `1`, `≥ 2`, signal, timeout, oversize stdout, invalid UTF-8); preflight runs after lock acquisition; preflight env contains `TM_*` vars; resolved prompt path written when substitution happened; history files written for each branch; agent never spawns on skip or error.
- Dispatch: removal of the `\n---\n` append (regression test asserting it does not appear in resolved prompt unless `<PAYLOAD/>` is in the body).
- History/list/status/doctor: new statuses surface in the expected commands; chronic-error and chronic-stale-success detectors fire at the correct thresholds.

Slow scenarios (process spawn, real timeouts) should use the existing `*.integration-test.ts` naming so they stay out of the fast loop, consistent with the project's integration-test convention.

## Out of Scope

- Built-in preflight types (e.g. `imap-unread`, `url-changed`, `file-mtime-newer`). User scripts only.
- Taskmaster-managed state directory (`TM_STATE_DIR` or similar). Scripts manage their own state via paths they choose.
- Configurable preflight timeout. Hard-coded 60 s in v1.
- Piping preflight stdout into the agent in any way other than `<PREFLIGHT/>` substitution.
- Filtering or transforming preflight stderr into the prompt. Stderr is logs-only.
- A `--respect-preflight` / `--bypass-preflight` flag on `tm run`. Preflight always runs.
- Escape syntax for embedding the literal strings `<PREFLIGHT/>` or `<PAYLOAD/>` in prompts that should not be substituted.
- Per-token positioning hints (header/footer/etc.) — substitution is purely positional based on where the user wrote the token.

## Further Notes

- `<PREFLIGHT/>` and `<PAYLOAD/>` are intentionally both routed through the same shared substitution module. They are different *data sources* (computed stdout vs delivered payload) but they share a single mechanism — the duplication concern that motivated dropping the implicit append applies only when there are two *mechanisms* for the same data, not when there is one mechanism with multiple bound variables.
- A 60 s preflight timeout is theoretically incompatible with `* * * * *` per-minute cron tasks. Accepted: such tasks are an edge case, and the rest of the system already enforces `timeout < schedule interval`. Revisit if real per-minute preflighted tasks emerge.
- `tm doctor`'s 14-day-stale-success threshold and "task has run at least once" guard are tunable. The intent is to avoid noising on freshly-added tasks and on rare-event tasks that legitimately skip for long stretches, while still surfacing scripts that have silently broken.
