---
# tm-gael
title: tm doctor signals for chronic preflight-error and stale success
status: completed
type: feature
priority: normal
created_at: 2026-04-28T14:43:18Z
updated_at: 2026-04-28T16:11:51Z
parent: tm-ron0
blocked_by:
    - tm-v1sy
---

## What to build

Two new diagnostics in `tm doctor` driven by the preflight-aware history written in tm-v1sy:

1. **Chronic preflight-error** — 3+ consecutive `preflight-error` runs for a task → critical severity. Mirrors the existing chronic-failure detector.
2. **Stale success** — a task whose last `success` run is more than 14 days old, *and* which has run successfully at least once historically, is flagged as info. Tasks that have never succeeded are excluded (avoids false positives for freshly-added tasks).

Refer to parent PRD tm-ron0: "User Stories" 34, 35, and "Implementation Decisions → Modules" (doctor extensions).

## Acceptance criteria

- [x] `tm doctor` reports `preflight-error` chronic when the most recent 3+ runs all have status `preflight-error`. Severity: critical. Mixed run statuses break the streak.
- [x] `tm doctor` reports stale-success when `now() - last_success_timestamp > 14 days` AND the task has at least one prior run with `status: success`. Severity: info.
- [x] Tasks with zero successful runs in their history are not reported by the stale-success detector regardless of age.
- [x] Both new checks are gated to tasks that declare a `preflight` field — chronic-error and stale-success would otherwise fire on tasks without preflight, which this slice does not target.
- [x] Existing doctor checks are unchanged; this slice extends, does not modify, current detector behavior.
- [x] `--json` output exposes the new findings using stable diagnostic identifiers (e.g. `chronic-preflight-error`, `stale-preflight-success`) so downstream consumers can match on them.

## User stories addressed

Reference by number from parent PRD tm-ron0:

- 34, 35

## Summary of Changes

`src/doctor/checks.ts`: two new finding kinds added to the `Finding` union and two new check functions:

- `checkPreflightChronicError(task, history, hasPreflight, now)` — returns a critical finding when the most-recent 3+ entries all have `status: 'preflight-error'`. Anything else (success, skipped-preflight, payload-error, etc.) breaks the streak. Gated on `hasPreflight`.
- `checkStalePreflightSuccess(task, history, hasPreflight, now)` — returns an info finding when the last successful agent run is older than 14 days. Tasks with zero historical successes are excluded so freshly-added tasks don't false-positive. Gated on `hasPreflight`.

`src/doctor/doctor.ts`: both checks called per-task with `task.preflight !== undefined` as the gate. `DoctorResult` exposes `findings: Finding[]` on both branches so the CLI can serialize them without re-running the checks.

`src/doctor/report.ts`: rendering for both new finding kinds, with "Investigate:" hints pointing at `tm history --failures --last 5` (chronic) and `tm history --last 10` (stale).

`src/main.ts`: `tm doctor` gains a `--json` flag that emits `JSON.stringify(result.findings)` and exits 0/1 based on `result.ok`. The kind strings (`chronic-preflight-error`, `stale-preflight-success`) are the stable diagnostic identifiers downstream consumers can match on.

Test fixtures use `historyMetaSchema.decode()` instead of `as HistoryEntry` casts to stay compliant with the project's no-unsafe-cast rule.
