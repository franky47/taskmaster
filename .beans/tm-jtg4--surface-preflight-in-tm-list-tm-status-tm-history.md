---
# tm-jtg4
title: Surface preflight in tm list, tm status, tm history
status: todo
type: feature
priority: normal
created_at: 2026-04-28T14:43:14Z
updated_at: 2026-04-28T14:43:14Z
parent: tm-ron0
blocked_by:
    - tm-v1sy
---

## What to build

Make preflight visible in the three CLI surfaces that summarize task state: `tm list`, `tm status`, and `tm history`. No new flags v1 — defaults expose everything; users filter with shell tools or existing flags.

Refer to parent PRD tm-ron0 for the exact CLI behavior under "User Stories" 30–33 and supporting "Solution" / "Implementation Decisions → Modules" sections.

## Acceptance criteria

- [ ] `tm list` appends a `[preflight]` marker to any row whose task declares a `preflight` field. Marker placement is consistent and stable across rows.
- [ ] `tm list --json` exposes the full preflight command string in the structured output for tasks that declare it.
- [ ] `tm status` displays the `skipped-preflight` and `preflight-error` statuses verbatim in the "last run" position (no abstraction or aggregation).
- [ ] `tm history <name>` includes preflight skip and error rows inline with run rows by default — full timeline.
- [ ] `tm history <name> --failures` includes `preflight-error` rows alongside agent failures and timeouts.
- [ ] `tm history <name> --failures` does **not** include `skipped-preflight` rows (skips are not failures).
- [ ] `--json` output for `status` and `history` exposes the new statuses as their canonical string values.

## User stories addressed

Reference by number from parent PRD tm-ron0:

- 30, 31, 32, 33

