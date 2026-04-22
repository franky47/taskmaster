---
# tm-ezda
title: 'Doctor diagnostic: consecutive requirement skips'
status: completed
type: feature
priority: normal
created_at: 2026-04-22T13:19:57Z
updated_at: 2026-04-22T14:11:36Z
parent: tm-rby1
blocked_by:
    - tm-47m1
---

## What to build

Add a new doctor diagnostic that surfaces tasks chronically blocked by an unmet requirement. Mirrors the existing `consecutive_failures` and `consecutive_timeouts` checks in shape and severity. Reads the log (or history, whichever the existing checks use), groups `requirement-unmet` skip events per task per requirement, and warns when 3+ consecutive skips share the same unmet requirement. Update the Doctor section of the README.

See parent PRD `tm-rby1` for the rationale (consistent with existing consecutive-event patterns, avoids proportional-threshold complexity).

Docs ride with this slice.

## Acceptance criteria

- [x] New check `consecutive_requirement_skips` exists alongside the existing consecutive checks
- [x] Warn severity triggers at 3+ consecutive skips for the same task and same requirement
- [x] When multiple requirements are unmet across consecutive skips, the streak counter resets on requirement change (so mixed-requirement skips do not falsely trigger)
- [x] Doctor output includes the task name and the specific unmet requirement in the finding
- [x] README's Doctor section gains a bullet describing the new check
- [x] Colocated tests seed fixture log/history with N consecutive same-requirement skips and assert the finding appears at the expected severity
- [x] Tests also cover the negative cases: <3 consecutive, mixed requirements breaking the streak, no skips at all

## User stories addressed

Reference by number from parent PRD `tm-rby1`:

- User story 10 (structured skip event used by doctor) — completion
- User story 11 (warning on 3+ consecutive same-requirement skips)

## Summary of Changes

- Added `checkConsecutiveRequirementSkips` in `src/doctor/checks.ts`, a new `consecutive-requirement-skips` finding kind, and report rendering in `src/doctor/report.ts`.
- Wired the check into `src/doctor/doctor.ts` per-task, alongside the existing offline-skips check.
- Per-requirement streak tracking: for each requirement present in the most recent skip entry, count the tail of consecutive skips that include it. A skip without that requirement breaks the streak; mixed requirements across entries continue streaks only for requirements present in every tail entry. Emits one finding per chronically-unmet requirement so tasks with multiple unmet requirements surface all of them.
- Threshold 3+ at warning severity (matching the bean spec). No critical tier — `consecutive_failures`/`consecutive_timeouts` escalate to critical because they reflect task errors; chronic requirement skips reflect environment, not task health.
- README Doctor section updated with a bullet for the new check.
- Coexists with the existing `checkOfflineSkips` (count-based, network-only). Different signal: count vs. streak; both can fire for a chronically-offline network task.
