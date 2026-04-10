---
# tm-f6f5
title: Display + doctor updates for event tasks
status: todo
type: task
priority: normal
created_at: 2026-04-10T08:36:43Z
updated_at: 2026-04-10T08:36:43Z
parent: tm-k9xd
blocked_by:
    - tm-g3h4
    - tm-h1js
---

## What to build

Update all display commands and doctor diagnostics to handle event tasks properly.

Display: `tm list` and `tm status` show `event:<name>` where a cron expression would appear. `tm status` shows `-` for "next run" on event tasks. `tm history` surfaces the event name when present in the history entry.

Doctor: skip the "never-ran" check for event tasks (they may legitimately never have been triggered). Skip the "timeout/schedule mismatch" check for event tasks (no schedule interval to compare against). All other checks apply as-is.

## Acceptance criteria

- [ ] `tm list` shows `event:<name>` for event-driven tasks in place of cron expression
- [ ] `tm status` shows `-` or equivalent for "next run" on event tasks
- [ ] `tm history` displays event name when `event` field is present in history entry
- [ ] `tm doctor` skips "never-ran" check for event tasks
- [ ] `tm doctor` skips "timeout/schedule mismatch" check for event tasks
- [ ] All other doctor checks still apply to event tasks (consecutive failures, etc.)
- [ ] JSON output for list/status/history includes event information

## TDD approach

This refactors existing display and doctor code. Follow TDD:

1. Update existing list, status, history, and doctor tests first to include event task scenarios and expect the new output format.
2. Verify the updated tests fail — if they pass, it reveals a coverage gap that should be investigated.
3. Change the implementation to make the tests pass.

## User stories addressed

- User story 11 (tm list shows event tasks)
- User story 12 (tm status without next run)
- User story 13 (tm history shows event name)
- User story 15 (doctor skips irrelevant checks)
