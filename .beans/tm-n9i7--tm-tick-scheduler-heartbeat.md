---
# tm-n9i7
title: tm tick (scheduler heartbeat)
status: todo
type: feature
priority: high
created_at: 2026-04-04T19:54:32Z
updated_at: 2026-04-04T19:54:32Z
blocked_by:
    - tm-274l
    - tm-hbyu
---

## What to build

The `tm tick` heartbeat command. Reads all enabled tasks, floors current time to the minute, evaluates cron expressions, deduplicates against history, and dispatches `tm run` as fully detached child processes. Runs the history purge routine. Writes heartbeat timestamp file.

See PRD Slice 8 for full specification.

## Acceptance criteria

- [ ] tm tick reads all task files and filters to enabled tasks (S8.1)
- [ ] Current wall-clock time is floored to the current minute (S8.2)
- [ ] Each enabled task's cron expression is evaluated against the floored time, in the task's timezone or system local (S8.3)
- [ ] For each matching task, checks most recent history entry to prevent double-firing for the same floored minute (S8.4)
- [ ] For each due, non-duplicate task, spawns tm run <name> --timestamp <floored-ISO8601> as a fully detached child process (S8.5)
- [ ] Locked tasks are skipped by tm run's own lock mechanism; tick does not pre-check (S8.6)
- [ ] tm tick writes the current ISO8601 timestamp to ~/.config/taskmaster/heartbeat (S8.7)
- [ ] tm tick completes quickly — dispatched runs are fully detached, tick does not wait (S8.8)
- [ ] tm tick runs the history purge routine on every invocation (S8.9)

## User stories addressed

- As the system scheduler, I invoke tm tick every 60 seconds and it runs whatever is due
- As a user, I can check the heartbeat file to verify the system is alive
