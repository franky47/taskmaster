---
# tm-v1sy
title: Preflight execution and exit-code gating
status: completed
type: feature
priority: high
created_at: 2026-04-28T14:43:01Z
updated_at: 2026-04-28T15:16:59Z
parent: tm-ron0
---

## What to build

Foundation slice for preflight: a per-task shell command that runs deterministically before the agent and gates execution by exit code. End-to-end, this slice introduces the `preflight` frontmatter field, the runner stage that executes it, the exit-code → status mapping, history persistence for skip and error paths, and the new `TM_*` env vars exposed to both preflight and the existing `run` field. Token substitution into the prompt body is intentionally **not** part of this slice — it ships in tm-ttdd.

Behavior is uniform across triggers: preflight runs on `tick`, `tm dispatch`, and `tm run <name>` alike. It runs inside the same per-task lock that the agent uses, immediately after lock acquisition.

Refer to parent PRD tm-ron0 for the full design — in particular: "Solution", "Implementation Decisions → Frontmatter", "Implementation Decisions → Exit-code semantics", "Implementation Decisions → Runner ordering", "Implementation Decisions → History schema additions", and "Implementation Decisions → Trigger-uniform behavior".

## Acceptance criteria

- [x] Frontmatter accepts an optional `preflight: <non-empty string>` field; empty string is rejected at parse time.
- [x] Runner spawns the preflight command with the same shell, env, and cwd as the existing `run` field.
- [x] Env vars exposed to preflight (and to `run`): `TM_TASK_NAME`, `TM_TRIGGER` (`tick` | `dispatch` | `run`), `TM_RUN_TIMESTAMP`, plus `TM_EVENT_NAME` and `TM_EVENT_PAYLOAD_FILE` when triggered by dispatch.
- [x] Preflight runs after lock acquisition; lock-contention path is unchanged from today.
- [x] Preflight is hard-capped at 60s wall time; timeout is treated as a `preflight-error` with `error_reason: 'timeout'`.
- [x] Exit code `0` → agent runs as today.
- [x] Exit code `1` → no agent spawn; history meta written with `status: 'skipped-preflight'`.
- [x] Exit code ≥ 2, signal exit, or timeout → no agent spawn; history meta written with `status: 'preflight-error'` and `error_reason` discriminating `nonzero | signal | timeout`.
- [x] Preflight stdout, stderr, exit code, and duration are captured in every branch (including exit 0) and persisted as `<ts>.preflight.txt` in the task history dir, plus a `preflight: { exit_code, duration_ms, stdout_bytes, stderr_bytes, error_reason? }` block in the run's `meta.json`.
- [x] Preflight runs identically for `tick`-spawned, `tm dispatch`-spawned, and `tm run <name>` invocations. `tm run` continues to bypass `enabled` and `requires` exactly as today, but does not bypass preflight.
- [x] Lock is released on every exit path (success, skip, error, timeout, crash).
- [x] Tasks without a `preflight` field behave exactly as before this slice (regression test).

## User stories addressed

Reference by number from parent PRD tm-ron0:

- 3, 4, 5, 6, 7, 8, 9, 21, 22, 23, 24, 25, 26, 27, 28, 37, 38

## Summary of Changes

Foundation slice for preflight: per-task shell command runs before the agent and gates execution by exit code (0 → run, 1 → skip, ≥2/signal/timeout → error).

Key shape changes:

- New optional `preflight` field in frontmatter (Zod schema in `src/lib/task/frontmatter.ts`).
- History meta is now a discriminated union over `status` for the new `skipped-preflight` and `preflight-error` variants. The agent-ran variant has no `status` field — narrow with the new `isAgentRanMeta` type guard. Consumers (`query.ts`, `purge.ts`, `status/status.ts`, `doctor/checks.ts`, `main.ts` printing) updated to narrow before reading agent-only fields.
- Runner gains a preflight stage between lock acquisition and agent spawn. `RunResult` becomes a discriminated union with `kind: 'agent' | 'skipped-preflight' | 'preflight-error'`. Default `spawnPreflight` mirrors `spawnAgent` but captures stdout/stderr separately and is hard-capped at 60 s.
- `TM_TASK_NAME`, `TM_TRIGGER`, `TM_RUN_TIMESTAMP`, plus `TM_EVENT_NAME` and `TM_EVENT_PAYLOAD_FILE` (dispatch only) are exposed to both preflight and agent.
- `<ts>.preflight.txt` is persisted to the task history dir whenever preflight ran. `purgeHistory` unlinks the new sibling alongside `output.txt`.
- `recordHistory` no longer archives temp cwd to `runs/` for skipped-preflight or preflight-error variants — the agent never ran, so there are no artifacts worth preserving.
- `error_reason` derivation puts `timed_out`/`signaled` ahead of `exit_code`: a kernel-killed process can still report exit 0, but it should still surface as an error.

Token substitution (`<PREFLIGHT/>`, `<PAYLOAD/>`) and CLI/doctor surfacing of the new statuses are intentionally out of scope here — they ship in tm-ttdd, tm-jtg4, and tm-gael respectively.
