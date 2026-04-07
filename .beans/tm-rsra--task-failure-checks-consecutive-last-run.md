---
# tm-rsra
title: Task failure checks (consecutive + last-run)
status: todo
type: task
priority: high
created_at: 2026-04-07T12:13:45Z
updated_at: 2026-04-07T12:13:45Z
parent: tm-py4h
---

## What to build

Add the task failure check function for the doctor feature (see parent PRD tm-py4h).

**`checkTaskFailures(taskName, history)`** — a pure function that examines a task's run history (sorted newest-first) and returns:

- **Critical finding** if the last 3+ runs all failed (no successful run among them). The finding includes the task name, failure count, last failure timestamp with relative time, exit code, and paths to stderr and preserved run artifacts.
- **Warning finding** if only the last run failed (fewer than 3 consecutive failures). Same data, lower severity.
- **Null** if the most recent run succeeded (even if there were failures before it — recovered tasks are not reported).

The function takes `HistoryEntry[]` (already sorted newest-first from `queryHistory`). It walks the array counting consecutive failures from the front until it hits a success or runs out of entries.

Findings reference file paths (stderr, run artifact dirs) rather than inlining content, keeping the report token-efficient.

## Acceptance criteria

- [ ] Returns critical finding when last 3+ runs all failed
- [ ] Returns warning finding when last run failed but < 3 consecutive
- [ ] Returns null when most recent run succeeded
- [ ] Returns null for empty history (no runs = nothing to report as failure)
- [ ] Finding includes: task name, consecutive failure count, last failure timestamp + relative time, exit code
- [ ] Finding references stderr path and run artifact directory path
- [ ] Handles edge cases: exactly 3 failures, 2 failures, 1 failure, history shorter than 3 entries
- [ ] All tested with synthetic HistoryEntry arrays

## User stories addressed

- User story 7: Consistently failing tasks surfaced as critical
- User story 8: Last-run failures surfaced as warning
- User story 15: Stderr paths referenced, not inlined
- User story 17: Old failures after a successful run not reported
- User story 18: Preserved run artifact directories referenced
