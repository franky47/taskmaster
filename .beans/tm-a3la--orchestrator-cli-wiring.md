---
# tm-a3la
title: Orchestrator + CLI wiring
status: completed
type: task
priority: high
created_at: 2026-04-07T12:14:21Z
updated_at: 2026-04-07T14:02:40Z
parent: tm-py4h
blocked_by:
    - tm-ymal
    - tm-t4z4
    - tm-rsra
    - tm-g12o
    - tm-w484
---

## What to build

Wire everything together for the doctor feature (see parent PRD tm-py4h).

**Orchestrator (`doctor/doctor.ts`):** Thin glue layer that:
1. Reads all data sources: heartbeat file, task list, validation results, per-task history, log entries, scheduler presence (plist/crontab)
2. Calls each check function with the loaded data
3. Collects findings into a single array
4. If no findings: returns "All systems operational"
5. If findings: calls report renderer and returns the markdown

The orchestrator uses the existing module functions (`listTasks`, `validateTasks`, `queryHistory`, `readLog`) — no subprocess calls. Scheduler detection reuses setup module constants: checks plist file existence on darwin, parses crontab output on linux.

**CLI wiring (`main.ts`):** Register `tm doctor [--since <iso8601>]`:
- `--since` accepts an ISO 8601 timestamp, defaults to 7 days before now
- No `--json` flag
- Exit code 0 + "All systems operational" on stdout if no findings
- Exit code 1 + markdown report on stdout if findings

## Acceptance criteria

- [x] `tm doctor` with no issues prints "All systems operational" and exits 0
- [x] `tm doctor` with issues prints markdown report and exits 1
- [x] Default time window is 7 days
- [x] `--since <iso8601>` narrows the time window
- [x] Orchestrator reads heartbeat, tasks, history, log, scheduler config
- [x] Orchestrator calls all check functions and collects findings
- [x] No subprocess calls — reuses existing module functions directly
- [x] Scheduler detection is platform-aware (plist on darwin, crontab on linux)

## User stories addressed

- User story 1: Single command surfaces all operational issues
- User story 2: Findings include specific commands to run next
- User story 3: Quick system health check
- User story 6: `--since` flag for narrowing window


## Summary of Changes

Orchestrator in `doctor/doctor.ts` with full DI via `DoctorDeps` type. CLI command `tm doctor [--since <iso8601>]` registered in `main.ts`. Added `isSchedulerInstalled` to the setup module for platform-aware scheduler detection. 16 tests covering all finding types, error resilience, and since-window behavior.
