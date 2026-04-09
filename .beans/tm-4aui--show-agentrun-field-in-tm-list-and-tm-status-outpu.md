---
# tm-4aui
title: Show agent/run field in tm list and tm status output
status: completed
type: task
priority: normal
created_at: 2026-04-08T22:50:34Z
updated_at: 2026-04-09T11:35:08Z
---

Surface which agent or run command a task uses in the `tm list` and `tm status` CLI output, so users can tell at a glance what each task executes.

## Acceptance Criteria

- `tm list` text output includes agent name or 'custom' (for run tasks) after the schedule
- `tm list --json` includes agent/run fields
- `tm status` text output includes agent name or 'custom'
- `tm status --json` includes agent/run fields
- TaskListEntry type gains optional agent/run fields
- TaskStatus type gains optional agent/run fields
- Tests cover agent tasks, run tasks, and JSON output


## Summary of Changes

- `TaskListEntry` type gains optional `agent` and `run` fields
- `TaskStatus` type gains optional `agent` and `run` fields
- `listTasks()` extracts agent/run from parsed task definitions
- `getTaskStatuses()` passes agent/run through from list entries
- `tm list` text output shows agent name or 'custom' after schedule
- `tm status` text output shows executor line (agent name or 'custom')
- Both `--json` modes include agent/run fields
- All existing tests updated with agent/run expectations
