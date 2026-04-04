---
# tm-w8rg
title: tm list
status: todo
type: feature
priority: normal
created_at: 2026-04-04T19:53:24Z
updated_at: 2026-04-04T19:53:24Z
blocked_by:
    - tm-51fy
---

## What to build

The `tm list` subcommand. Lists all tasks with minimal, greppable output: one line per task with name, schedule, enabled/disabled. Supports `--json` for structured output.

See PRD Slice 2 for full specification.

## Acceptance criteria

- [ ] `tm list` outputs one line per task: name, schedule, enabled/disabled, space-separated (S2.1)
- [ ] Output has no headers, no borders, no decoration (S2.2)
- [ ] --json flag outputs a JSON array of {name, schedule, timezone?, enabled} objects (S2.3)
- [ ] Tasks are sorted alphabetically by name (S2.4)

## User stories addressed

- As a user, I run tm list and see a compact, greppable list of all tasks
- As an agent, I run tm list --json to check whether a task already exists before creating one
