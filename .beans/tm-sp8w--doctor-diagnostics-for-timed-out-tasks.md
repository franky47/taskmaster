---
# tm-sp8w
title: Doctor diagnostics for timed-out tasks
status: todo
type: task
created_at: 2026-04-07T12:29:38Z
updated_at: 2026-04-07T12:29:38Z
parent: tm-7fv4
blocked_by:
    - tm-lzk7
    - tm-qnn6
    - tm-c7ng
    - tm-yfj9
    - tm-py4h
---

## What to build

Add timeout-aware diagnostics to `tm doctor`. When doctor detects task failures, it should check the `timed_out` field in history to give specific advice for timeout failures vs regular failures.

Potential checks:
- "task X timed out 3 times consecutively → consider increasing the timeout or investigating why the agent is slow"
- Correlate timeouts with contention: if a task times out and its timeout approaches or exceeds its schedule interval, warn about likely contention
- Include the configured timeout value in the finding for context

This issue depends on both the timeout feature (for the `timed_out` history field and frontmatter schema) and the doctor feature (for the checks/report infrastructure).

## Acceptance criteria

- [ ] Doctor's failure checks distinguish timeout failures from regular failures
- [ ] Timeout-specific findings include the configured timeout value and actionable advice
- [ ] Timeout + contention correlation is detected when timeout >= schedule interval
- [ ] Tests: doctor reports timeout-specific findings for timed-out task history
- [ ] Tests: doctor correlates timeout with contention when intervals overlap

## User stories addressed

- Extends doctor user stories 7, 8 (task failure checks) with timeout-specific diagnostics
