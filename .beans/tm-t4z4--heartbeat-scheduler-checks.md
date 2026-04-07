---
# tm-t4z4
title: Heartbeat & scheduler checks
status: todo
type: task
priority: high
created_at: 2026-04-07T12:13:33Z
updated_at: 2026-04-07T12:13:33Z
parent: tm-py4h
---

## What to build

Add two pure check functions for the doctor feature (see parent PRD tm-py4h) that detect scheduler health issues.

**Heartbeat check:** `checkHeartbeat(heartbeatTime, now)` returns a critical finding if the heartbeat file timestamp is more than 5 minutes old. Include a comment explaining: tick runs every 60s, so 5 minutes = 5 missed ticks. If the heartbeat file doesn't exist, that's also critical (scheduler has never ticked). The finding must include both absolute timestamps and relative time ("3h 37m ago").

**Scheduler installed check:** `checkSchedulerInstalled(platform, schedulerPresent)` returns a critical finding if the system scheduler is not installed. The check itself is platform-agnostic (takes a boolean), but the finding carries the platform so the report renderer can emit the right investigation commands later.

Both checks are pure functions in `doctor/checks.ts` — no I/O. They extend the `Finding` discriminated union established in slice 1.

A relative-time formatting helper is needed ("just now" for <1m, "Xm ago" for <1h, "Xh Ym ago" for <1d, "Xd Yh ago" for longer). This helper will be reused by other checks and the report renderer.

## Acceptance criteria

- [ ] `checkHeartbeat` returns critical finding when heartbeat > 5 minutes old
- [ ] `checkHeartbeat` returns critical finding when heartbeat file is missing (null input)
- [ ] `checkHeartbeat` returns null when heartbeat is fresh
- [ ] Finding includes absolute timestamp + relative time string
- [ ] `checkSchedulerInstalled` returns critical finding when scheduler not present
- [ ] `checkSchedulerInstalled` returns null when scheduler is present
- [ ] Finding carries platform info for downstream rendering
- [ ] Relative-time helper produces human-friendly strings at all scale boundaries
- [ ] All checks tested with synthetic inputs (no filesystem access)
- [ ] Threshold (5 min) has explanatory comment

## User stories addressed

- User story 4: Timestamps and relative times in findings
- User story 5: Platform-aware investigation commands
- User story 9: Detect scheduler not ticking
- User story 10: Detect scheduler not installed
- User story 16: "Checked at" timestamp context
