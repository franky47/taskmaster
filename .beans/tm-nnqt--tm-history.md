---
# tm-nnqt
title: tm history
status: completed
type: feature
priority: normal
created_at: 2026-04-04T19:54:07Z
updated_at: 2026-04-06T08:36:48Z
parent: tm-we5m
blocked_by:
    - tm-274l
---

## What to build

The `tm history <name>` subcommand. Query and display run history for a task from the history directory. Supports filtering by failure status, limiting to N most recent entries, and --json output.

See PRD Slice 6 for full specification.

## Acceptance criteria

- [x] tm history <name> lists runs from history directory, most recent first (S6.1)
- [x] Each run displayed as indented block: timestamp header, indented duration, exit code, status (ok/err), stderr file path when present (S6.2)
- [x] --failures flag filters to only failed runs (S6.3)
- [x] --last N limits output to the N most recent entries (S6.4)
- [x] --json outputs a JSON array of meta.json objects (S6.5)
- [x] Exit code 1 if the task name does not exist (S6.6)

## User stories addressed

- As a user, I run tm history daily-audit and see recent runs with timestamps, duration, and pass/fail
- As an agent, I run tm history daily-audit --json --failures to find failed runs for debugging


## Summary of Changes

Implemented `tm history <name>` as a new query module in `src/history/`:
- `query.ts`: reads meta.json files from history dir, validates task existence, supports --failures and --last filters
- `schema.ts`: shared Zod schema for HistoryMeta, used by record, query, and purge modules
- CLI wired with --json, --failures, --last flags, with Zod validation on --last
- 10 new tests covering sorting, filtering, limiting, error cases, and stderr path detection
