---
# tm-ezda
title: 'Doctor diagnostic: consecutive requirement skips'
status: todo
type: feature
priority: normal
created_at: 2026-04-22T13:19:57Z
updated_at: 2026-04-22T13:19:57Z
parent: tm-rby1
blocked_by:
    - tm-47m1
---

## What to build

Add a new doctor diagnostic that surfaces tasks chronically blocked by an unmet requirement. Mirrors the existing `consecutive_failures` and `consecutive_timeouts` checks in shape and severity. Reads the log (or history, whichever the existing checks use), groups `requirement-unmet` skip events per task per requirement, and warns when 3+ consecutive skips share the same unmet requirement. Update the Doctor section of the README.

See parent PRD `tm-rby1` for the rationale (consistent with existing consecutive-event patterns, avoids proportional-threshold complexity).

Docs ride with this slice.

## Acceptance criteria

- [ ] New check `consecutive_requirement_skips` exists alongside the existing consecutive checks
- [ ] Warn severity triggers at 3+ consecutive skips for the same task and same requirement
- [ ] When multiple requirements are unmet across consecutive skips, the streak counter resets on requirement change (so mixed-requirement skips do not falsely trigger)
- [ ] Doctor output includes the task name and the specific unmet requirement in the finding
- [ ] README's Doctor section gains a bullet describing the new check
- [ ] Colocated tests seed fixture log/history with N consecutive same-requirement skips and assert the finding appears at the expected severity
- [ ] Tests also cover the negative cases: <3 consecutive, mixed requirements breaking the streak, no skips at all

## User stories addressed

Reference by number from parent PRD `tm-rby1`:

- User story 10 (structured skip event used by doctor) — completion
- User story 11 (warning on 3+ consecutive same-requirement skips)
