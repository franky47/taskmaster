---
# tm-fo0w
title: tm logs command
status: completed
type: task
priority: normal
created_at: 2026-04-09T10:38:22Z
updated_at: 2026-04-09T13:31:38Z
parent: tm-zaph
blocked_by:
    - tm-bsm4
    - tm-fu5m
---

## What to build

New `tm logs <name>` CLI command that auto-detects whether a task is running or completed and shows its output accordingly.

End-to-end: Read `readRunningMarker(taskName)` → if running, construct output path from marker timestamp (`history/<name>/<ts>.output.txt`), spawn `tail -f <path>` with inherited stdio for live streaming → if not running, find most recent history entry via `queryHistory(name, { last: 1 })`, read and print its `.output.txt` content → error if no history and not running.

See parent PRD (tm-zaph) for full context on the auto-detection behavior and `tail -f` approach.

## Acceptance criteria

- [x] `tm logs <name>` command registered in CLI
- [x] Running task: spawns `tail -f` on the streaming output file with inherited stdio (user sees live output)
- [x] Completed task: prints the most recent `.output.txt` content to stdout
- [x] No history and not running: prints error message and exits with non-zero code
- [x] `tail -f` process is killed when `tm logs` receives SIGINT/SIGTERM (clean exit on Ctrl+C)
- [x] Integration test: completed task shows output
- [x] Integration test: auto-detection routes correctly based on running state

## User stories addressed

- User story 6 (tm logs shows live output)
- User story 7 (auto-follow for running tasks)
- User story 8 (print most recent output for completed tasks)
