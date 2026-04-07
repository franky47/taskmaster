---
# tm-g12o
title: Task validation, never-ran, and contention checks
status: todo
type: task
priority: high
created_at: 2026-04-07T12:13:55Z
updated_at: 2026-04-07T12:13:55Z
parent: tm-py4h
---

## What to build

Add three check functions for the doctor feature (see parent PRD tm-py4h).

**`checkTaskValidation(validationResults)`** — takes the output of the existing `validateTasks` logic and returns error-severity findings for each invalid task. Each finding includes the task name and the list of validation error messages.

**`checkTaskNeverRan(taskName, enabled, historyLength)`** — returns a warning finding if the task is enabled but has zero history entries within the diagnostic window. Returns null for disabled tasks or tasks with any history.

**`checkContention(taskName, logEntries)`** — takes the filtered log entries for a specific task and returns a warning finding if there are any `skipped/contention` events. The finding includes the count of contention events in the window.

All three are pure functions in `doctor/checks.ts` — no I/O. They extend the `Finding` discriminated union.

## Acceptance criteria

- [ ] `checkTaskValidation` returns error finding per invalid task with error messages
- [ ] `checkTaskValidation` returns empty array for all-valid tasks
- [ ] `checkTaskNeverRan` returns warning for enabled task with zero history
- [ ] `checkTaskNeverRan` returns null for disabled tasks
- [ ] `checkTaskNeverRan` returns null for tasks with history
- [ ] `checkContention` returns warning with event count when contention events exist
- [ ] `checkContention` returns null when no contention events for that task
- [ ] All tested with synthetic inputs

## User stories addressed

- User story 11: Invalid task files caught
- User story 12: Enabled tasks that never ran flagged
- User story 13: Contention events surfaced
