---
# tm-jtg4
title: Surface preflight in tm list, tm status, tm history
status: completed
type: feature
priority: normal
created_at: 2026-04-28T14:43:14Z
updated_at: 2026-04-28T16:04:35Z
parent: tm-ron0
blocked_by:
    - tm-v1sy
---

## What to build

Make preflight visible in the three CLI surfaces that summarize task state: `tm list`, `tm status`, and `tm history`. No new flags v1 — defaults expose everything; users filter with shell tools or existing flags.

Refer to parent PRD tm-ron0 for the exact CLI behavior under "User Stories" 30–33 and supporting "Solution" / "Implementation Decisions → Modules" sections.

## Acceptance criteria

- [x] `tm list` appends a `[preflight]` marker to any row whose task declares a `preflight` field. Marker placement is consistent and stable across rows.
- [x] `tm list --json` exposes the full preflight command string in the structured output for tasks that declare it.
- [x] `tm status` displays the `skipped-preflight` and `preflight-error` statuses verbatim in the "last run" position (no abstraction or aggregation).
- [x] `tm history <name>` includes preflight skip and error rows inline with run rows by default — full timeline.
- [x] `tm history <name> --failures` includes `preflight-error` rows alongside agent failures and timeouts.
- [x] `tm history <name> --failures` does **not** include `skipped-preflight` rows (skips are not failures).
- [x] `--json` output for `status` and `history` exposes the new statuses as their canonical string values.

## User stories addressed

Reference by number from parent PRD tm-ron0:

- 30, 31, 32, 33

## Summary of Changes

`src/list/list.ts`: `TaskListEntry` gains optional `preflight?: string` populated when the parsed task declares the field. Drives both the `--json` output (full command string exposed) and the human-readable `[preflight]` marker.

`src/main.ts` (`list` command): the trailing ` [preflight]` marker is appended to any row whose task declares preflight. Marker is leading-space-prefixed and only emitted when truthy, so it's consistent and stable across rows.

`src/status/status.ts`: `LastRun.status` widened to `'ok' | 'timeout' | 'err' | 'skipped-preflight' | 'preflight-error' | 'payload-error'`. `LastRun.exit_code` is now optional — non-agent variants do not carry one. `getTaskStatuses` now reads `history[0]` (most recent entry, regardless of variant) and copies `latest.status` verbatim for non-agent variants. Agent-ran retains the `'ok'/'timeout'/'err'` derivation.

`src/history/query.ts`: new private `isFailureEntry` helper centralises the `--failures` predicate. For agent-ran entries: failure iff `!success`. For non-agent variants: failure iff `status !== 'skipped-preflight'`. So `preflight-error` and `payload-error` count as failures; `skipped-preflight` does not (a clean "no work to do" is not a failure).

The CLI history printer (main.ts) already handled non-agent variants because `CompletedHistoryEntry.status` was extended in tm-nzcg, and the existing `'exit_code' in entry` guard correctly suppresses the exit_code line for skipped-preflight/preflight-error/payload-error rows.
