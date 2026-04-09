---
# tm-1q2a
title: tm history shows in-progress runs
status: todo
type: task
created_at: 2026-04-09T10:38:12Z
updated_at: 2026-04-09T10:38:12Z
parent: tm-zaph
blocked_by:
    - tm-fu5m
---

## What to build

Enhance `tm history <name>` to show currently in-progress runs alongside completed ones, using a discriminated union type.

End-to-end: CLI handler checks `readRunningMarker` before calling `queryHistory` → if running, prepends a synthetic entry with `status: 'running'` → plain output shows the running entry first → `--json` uses the discriminated union (`status: 'running' | 'ok' | 'timeout' | 'err'`).

The running entry in the union has `status`, `timestamp`, `started_at`, `pid`, `output_path` but lacks `finished_at`, `exit_code`, `success`, `duration_ms`, `timed_out`.

See parent PRD (tm-zaph) for full context on the discriminated union design.

## Acceptance criteria

- [ ] History entry type is a discriminated union on `status`: running entries vs completed entries
- [ ] CLI handler checks running marker and prepends running entry when present
- [ ] Plain output shows running entry as first line with `running` status and elapsed time
- [ ] `--json` serializes running entries with the discriminated union shape
- [ ] Running entries include `output_path` pointing to the streaming output file
- [ ] `--failures` filter excludes running entries (they're not failures)
- [ ] Tests: running entry appears in history when marker present
- [ ] Tests: running entry absent when not running

## User stories addressed

- User story 9 (history shows in-progress runs)
- User story 10 (running entry appears first)
- User story 13 (discriminated union in JSON output)
