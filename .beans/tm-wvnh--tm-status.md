---
# tm-wvnh
title: tm status
status: completed
type: feature
priority: normal
created_at: 2026-04-04T19:54:15Z
updated_at: 2026-04-06T08:36:48Z
parent: tm-we5m
blocked_by:
    - tm-w8rg
    - tm-274l
---

## What to build

The `tm status` subcommand. Rich status view combining task metadata with history data and next-run computation. Shows indented blocks per task with schedule, enabled state, last run result, and next scheduled time.

See PRD Slice 7 for full specification.

## Acceptance criteria

- [x] tm status outputs an indented block per task: task name as header, followed by indented key-value fields (schedule, enabled, last run with ok/err, next scheduled time) (S7.1)
- [x] Fields with no value are omitted (e.g., no last_run line if task has never run) (S7.2)
- [x] Disabled tasks omit the next field (S7.3)
- [x] Next scheduled time is computed from the cron expression relative to now, respecting the task's timezone (S7.4)
- [x] --json outputs a JSON array with all fields including last_run and next_run as ISO8601 strings (S7.5)

## User stories addressed

- As a user, I run tm status and see at a glance which tasks are healthy, which failed last, and when each will next fire
- As an agent, I run tm status --json to get a complete system overview

## Summary of Changes

Added `src/status/` module with `getTaskStatuses()` that combines task metadata from `listTasks` with most recent history entry from `queryHistory`, plus cron-computed next run time via `cron-parser`. Wired as `tm status [--json]` in `main.ts`.
