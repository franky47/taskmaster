---
# tm-s2sw
title: 'tm tick --dry-run: preview dispatches without executing'
status: completed
type: task
priority: normal
created_at: 2026-04-08T22:50:40Z
updated_at: 2026-04-09T11:10:08Z
---

Add a `--dry-run` flag to `tm tick` that evaluates which tasks are due and reports what would be dispatched, without actually spawning any `tm run` processes.

## Acceptance Criteria

- [x] `tm tick --dry-run` lists tasks that would be dispatched this minute
- [x] No processes are spawned, no heartbeat written, no history purged
- [x] Text output prefixes entries with 'would dispatch' instead of 'dispatched'
- [x] `--json` output includes a `dry_run: true` field
- [x] Tick function accepts a `dryRun` option
- [x] Tests cover dry-run with due tasks, no-due-tasks, and JSON output

## Summary of Changes

Added `dryRun` option to `TickOptions` and `dry_run` field to `TickResult`. In dry-run mode, tick evaluates cron matching, dedup, and connectivity filtering but early-returns before spawning processes, writing heartbeat, or purging history. CLI wired with `--dry-run` flag; text output uses "would dispatch" verb with dynamic column alignment.
