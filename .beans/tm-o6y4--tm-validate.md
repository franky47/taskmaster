---
# tm-o6y4
title: tm validate
status: todo
type: feature
priority: normal
created_at: 2026-04-04T19:53:19Z
updated_at: 2026-04-04T19:53:19Z
blocked_by:
    - tm-51fy
---

## What to build

CLI entry point with the `tm validate` subcommand. Scans all task files in `~/.config/taskmaster/tasks/*.md`, runs the parser on each, and reports results. Supports `--json` for structured output.

See PRD Slice 1 for full specification.

## Acceptance criteria

- [ ] `tm validate` scans ~/.config/taskmaster/tasks/*.md and runs the parser on each (S1.1)
- [ ] Valid files produce a success line; invalid files produce error details with filename (S1.2)
- [ ] Exit code 0 if all valid, exit code 1 if any invalid (S1.3)
- [ ] --json flag outputs a JSON array of {name, valid, errors?} objects (S1.4)
- [ ] Gracefully handles empty tasks/ directory and missing tasks/ directory (S1.5)

## User stories addressed

- As a user, I run tm validate and see which task files are valid and which have errors
- As an agent, I run tm validate --json and get a structured array of validation results
