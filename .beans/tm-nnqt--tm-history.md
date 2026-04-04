---
# tm-nnqt
title: tm history
status: todo
type: feature
priority: normal
created_at: 2026-04-04T19:54:07Z
updated_at: 2026-04-04T19:54:07Z
blocked_by:
    - tm-274l
---

## What to build

The `tm history <name>` subcommand. Query and display run history for a task from the history directory. Supports filtering by failure status, limiting to N most recent entries, and --json output.

See PRD Slice 6 for full specification.

## Acceptance criteria

- [ ] tm history <name> lists runs from history directory, most recent first (S6.1)
- [ ] Each run displayed as indented block: timestamp header, indented duration, exit code, status (ok/err), stderr file path when present (S6.2)
- [ ] --failures flag filters to only failed runs (S6.3)
- [ ] --last N limits output to the N most recent entries (S6.4)
- [ ] --json outputs a JSON array of meta.json objects (S6.5)
- [ ] Exit code 1 if the task name does not exist (S6.6)

## User stories addressed

- As a user, I run tm history daily-audit and see recent runs with timestamps, duration, and pass/fail
- As an agent, I run tm history daily-audit --json --failures to find failed runs for debugging
