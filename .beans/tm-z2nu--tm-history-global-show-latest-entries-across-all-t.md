---
# tm-z2nu
title: 'tm history (global): show latest entries across all tasks'
status: completed
type: task
priority: normal
created_at: 2026-04-08T22:50:27Z
updated_at: 2026-04-09T11:26:05Z
---

Make `tm history` work without a task name argument to show the most recent run entries across all tasks, ordered by timestamp (newest first).

## Acceptance Criteria

- `tm history` (no args) shows latest entries across all tasks, sorted newest-first
- Each entry includes the task name in addition to existing fields
- Default limit of 20 entries (overridable with --last)
- `--failures` filter still works in global mode
- `--json` output support
- `tm history <name>` continues to work as before (no regression)
- Tests cover global query, filtering, limits, empty state


## Summary of Changes

All acceptance criteria met. Added `queryGlobalHistory()` in `src/history/query.ts` that reads across all task history directories, merges entries with `task_name`, sorts newest-first, and defaults to 20 entries. Extracted shared `parseHistoryDir()` helper to eliminate duplication with `queryHistory()`. CLI updated to accept optional `[name]` argument, with `printHistoryEntry()` helper for shared formatting.
