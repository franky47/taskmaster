---
# tm-gael
title: tm doctor signals for chronic preflight-error and stale success
status: todo
type: feature
priority: normal
created_at: 2026-04-28T14:43:18Z
updated_at: 2026-04-28T14:43:18Z
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

- [ ] `tm doctor` reports `preflight-error` chronic when the most recent 3+ runs all have status `preflight-error`. Severity: critical. Mixed run statuses break the streak.
- [ ] `tm doctor` reports stale-success when `now() - last_success_timestamp > 14 days` AND the task has at least one prior run with `status: success`. Severity: info.
- [ ] Tasks with zero successful runs in their history are not reported by the stale-success detector regardless of age.
- [ ] Both new checks are gated to tasks that declare a `preflight` field — chronic-error and stale-success would otherwise fire on tasks without preflight, which this slice does not target.
- [ ] Existing doctor checks are unchanged; this slice extends, does not modify, current detector behavior.
- [ ] `--json` output exposes the new findings using stable diagnostic identifiers (e.g. `chronic-preflight-error`, `stale-preflight-success`) so downstream consumers can match on them.

## User stories addressed

Reference by number from parent PRD tm-ron0:

- 34, 35

