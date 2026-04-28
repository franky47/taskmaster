---
# tm-v1sy
title: Preflight execution and exit-code gating
status: todo
type: feature
priority: high
created_at: 2026-04-28T14:43:01Z
updated_at: 2026-04-28T14:43:01Z
parent: tm-ron0
---

## What to build

Foundation slice for preflight: a per-task shell command that runs deterministically before the agent and gates execution by exit code. End-to-end, this slice introduces the `preflight` frontmatter field, the runner stage that executes it, the exit-code → status mapping, history persistence for skip and error paths, and the new `TM_*` env vars exposed to both preflight and the existing `run` field. Token substitution into the prompt body is intentionally **not** part of this slice — it ships in tm-ttdd.

Behavior is uniform across triggers: preflight runs on `tick`, `tm dispatch`, and `tm run <name>` alike. It runs inside the same per-task lock that the agent uses, immediately after lock acquisition.

Refer to parent PRD tm-ron0 for the full design — in particular: "Solution", "Implementation Decisions → Frontmatter", "Implementation Decisions → Exit-code semantics", "Implementation Decisions → Runner ordering", "Implementation Decisions → History schema additions", and "Implementation Decisions → Trigger-uniform behavior".

## Acceptance criteria

- [ ] Frontmatter accepts an optional `preflight: <non-empty string>` field; empty string is rejected at parse time.
- [ ] Runner spawns the preflight command with the same shell, env, and cwd as the existing `run` field.
- [ ] Env vars exposed to preflight (and to `run`): `TM_TASK_NAME`, `TM_TRIGGER` (`tick` | `dispatch` | `run`), `TM_RUN_TIMESTAMP`, plus `TM_EVENT_NAME` and `TM_EVENT_PAYLOAD_FILE` when triggered by dispatch.
- [ ] Preflight runs after lock acquisition; lock-contention path is unchanged from today.
- [ ] Preflight is hard-capped at 60s wall time; timeout is treated as a `preflight-error` with `error_reason: 'timeout'`.
- [ ] Exit code `0` → agent runs as today.
- [ ] Exit code `1` → no agent spawn; history meta written with `status: 'skipped-preflight'`.
- [ ] Exit code ≥ 2, signal exit, or timeout → no agent spawn; history meta written with `status: 'preflight-error'` and `error_reason` discriminating `nonzero | signal | timeout`.
- [ ] Preflight stdout, stderr, exit code, and duration are captured in every branch (including exit 0) and persisted as `<ts>.preflight.txt` in the task history dir, plus a `preflight: { exit_code, duration_ms, stdout_bytes, stderr_bytes, error_reason? }` block in the run's `meta.json`.
- [ ] Preflight runs identically for `tick`-spawned, `tm dispatch`-spawned, and `tm run <name>` invocations. `tm run` continues to bypass `enabled` and `requires` exactly as today, but does not bypass preflight.
- [ ] Lock is released on every exit path (success, skip, error, timeout, crash).
- [ ] Tasks without a `preflight` field behave exactly as before this slice (regression test).

## User stories addressed

Reference by number from parent PRD tm-ron0:

- 3, 4, 5, 6, 7, 8, 9, 21, 22, 23, 24, 25, 26, 27, 28, 37, 38

