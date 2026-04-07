---
# tm-py4h
title: 'tm doctor: diagnostic report command'
status: completed
type: epic
priority: high
tags:
    - cli
created_at: 2026-04-07T12:09:08Z
updated_at: 2026-04-07T14:08:34Z
---

## Problem Statement

Taskmaster has rich observability spread across multiple data sources — event logs (log.jsonl), per-task run history with stdout/stderr, preserved failure artifacts, a scheduler heartbeat file, task validation, and system scheduler configuration. When something goes wrong (tasks silently failing, scheduler stopped, misconfigured tasks), a user or AI agent must manually check each of these sources independently to piece together what happened. There is no single command that reads across all signals to produce a unified diagnosis.

## Solution

Add a `tm doctor` command that inspects all operational data sources within a configurable time window (default: 7 days), detects known problem patterns, and produces a concise markdown report. The report is designed for an AI agent to consume and act on: each finding includes severity, a human-readable explanation, and specific `tm` commands to run for further investigation.

- If no issues are found: prints "All systems operational" and exits with code 0.
- If issues are found: prints the markdown report and exits with code 1.

## User Stories

1. As an AI agent monitoring taskmaster, I want a single command that surfaces all operational issues, so that I can investigate and resolve them without needing to know which data sources to check.
2. As an AI agent, I want each finding to include specific commands to run next, so that I can drill deeper without guessing the CLI interface.
3. As a user, I want to run `tm doctor` and immediately see if my system is healthy, so that I don't have to manually cross-reference logs, history, and scheduler state.
4. As a user, I want the doctor report to show timestamps and relative times ("3h 37m ago"), so that I can quickly gauge how stale a problem is.
5. As a user, I want the report to only show investigation commands relevant to my platform (launchctl on macOS, crontab on Linux), so that I'm not confused by irrelevant instructions.
6. As a user, I want to narrow the diagnostic window with `--since <iso8601>`, so that I can focus on a specific incident timeframe.
7. As an AI agent, I want to know when tasks are consistently failing (3+ consecutive failures), so that I can prioritize critical issues over transient ones.
8. As an AI agent, I want to know when a task's last run failed (but hasn't hit the consecutive threshold), so that I can monitor it before it becomes critical.
9. As a user, I want doctor to detect when the scheduler has stopped ticking, so that I'm alerted before all tasks silently stop running.
10. As a user, I want doctor to detect when the system scheduler (launchd/crontab) isn't installed, so that I can fix it with `tm setup`.
11. As a user, I want doctor to catch invalid task files, so that I know about configuration errors before they cause runtime failures.
12. As a user, I want doctor to flag enabled tasks that have never run within the window, so that I can investigate why they're not being dispatched.
13. As an AI agent, I want to know about contention events (tasks skipped because already running), so that I can detect tasks that run longer than their schedule interval.
14. As an AI agent, I want to see recent error events from the event log, so that I have visibility into transient failures even if the task eventually recovered.
15. As a user, I want the report to reference stderr file paths for failed runs (not inline the content), so that the report stays brief and token-efficient.
16. As a user, I want the "Checked at" timestamp to appear at the top of every report, so that the report is self-documenting.
17. As a user, I want old failures that were followed by a successful run to NOT be reported, so that the report only surfaces active problems.
18. As a user, I want preserved run artifact directories (in `~/.config/taskmaster/runs/`) to be referenced in findings where relevant, so that the investigating agent can access full failure context.

## Implementation Decisions

### Module Architecture

**Deep logger module (refactored `logger.ts`)**: The existing logger module will be deepened to own both reading and writing of the JSONL event log. A Zod schema will be the single source of truth for the serialized log entry format (including the `ts` timestamp field and discriminated union on `event`). The `LogEntry` type will be inferred from this schema. A new `readLog(since, path?)` function will parse, validate, and filter log entries by time window. The `typescript-advanced-types` skill must be used for the Zod schema design. Malformed lines are silently skipped (same resilience pattern as history query).

**Checks module (`doctor/checks.ts`)**: Pure functions that take pre-loaded data and return findings. No I/O. Each check function takes specific inputs and returns a finding or null:
- `checkHeartbeat(heartbeatTime, now)` — critical if heartbeat > 5 minutes old (comment explaining: tick runs every 60s, 5min = 5 missed ticks)
- `checkSchedulerInstalled(platform, schedulerPresent)` — critical if scheduler not installed
- `checkTaskValidation(validationResults)` — error per invalid task
- `checkTaskFailures(taskName, history)` — critical if last 3+ runs all failed; warning if only the last run failed; not reported if last run succeeded
- `checkTaskNeverRan(taskName, enabled, historyLength)` — warning for enabled tasks with zero history
- `checkContention(taskName, logEntries)` — warning if skipped/contention events found
- `checkLogErrors(logEntries)` — info severity for error events in window

**Report renderer (`doctor/report.ts`)**: Takes findings array, checked-at timestamp, and platform. Produces markdown string. Each finding section includes: heading with severity tag, explanation, relevant timestamps with relative time display, and platform-appropriate investigation commands. Relative time uses human-friendly format ("3h 37m ago", "2d 5h ago").

**Orchestrator (`doctor/doctor.ts`)**: Thin glue layer that reads all data sources (heartbeat file, task list, validation results, history per task, log entries, scheduler config), passes data to check functions, collects findings, and delegates to the report renderer. Returns either "all clear" or the markdown report.

**CLI wiring (`main.ts`)**: Registers `tm doctor [--since <iso8601>]` command. Default window is 7 days before current time. Exit code 0 if no findings, 1 if any findings.

### Findings Model

Findings use a discriminated union on a `kind` field. Each variant carries severity (`critical`, `error`, `warning`, `info`) and the data needed for rendering. Severity is fixed per finding kind (not configurable).

### Platform Awareness

Scheduler checks use `process.platform` to determine what to inspect (launchd plist existence on darwin, crontab entry on linux). Investigation commands in the report are platform-gated. The setup module's constants (plist label, path helpers) are reused.

### Log Entry Schema

The serialized log entry schema includes a `ts` (ISO 8601 string) field added during serialization. The Zod schema models the full on-disk format as a discriminated union on the `event` field with three variants: `started`, `skipped`, and `error`. The error variant's `error` field is a record (the serialized error object). Types are inferred from the schema using `z.infer`.

### No Lock File Inspection

Lock files are empty (opened with `'w'` for `flock`). The kernel releases `flock` automatically when a process dies. There is no stale lock problem in this design, so doctor does not inspect lock files.

## Testing Decisions

Good tests for this feature test external behavior through the module's public interface, not implementation details. Tests use synthetic/fixture data — no real filesystem or subprocess calls needed for the core logic.

### Modules to test

**Logger module (read path)**: Test `readLog` with fixture JSONL content — valid entries, malformed lines (skipped gracefully), time window filtering, empty file, mixed entry types. Prior art: existing tests that use temp directories and fixture files alongside source.

**Checks module**: Each check function tested independently with synthetic inputs. Test the boundary conditions: heartbeat exactly at threshold, 2 vs 3 consecutive failures, task with history just outside the window, contention with zero vs multiple events. This is the highest-value test surface since the checks are pure functions.

**Report renderer**: Test that output is valid markdown, contains platform-appropriate commands (darwin vs linux), includes relative time strings, includes "Checked at" header. Snapshot-style assertions on known inputs.

The orchestrator and CLI wiring are thin enough to skip unit tests — they're integration-tested by the checks and report tests.

## Out of Scope

- `--json` output for doctor (the consuming agent uses `--json` on individual commands when drilling deeper)
- `--task <name>` flag to scope to a single task (system-wide only for v1)
- Stale lock detection (not a real problem with flock-based locking)
- Checking whether agent binaries are installed on PATH (run failures from missing binaries show up as task failures, which are already reported)
- Auto-remediation (doctor diagnoses, it does not fix)
- Configurable severity thresholds or failure count (hardcoded to 3 consecutive failures = critical)
- History purge interaction (doctor reads what exists, doesn't purge)

## Further Notes

- The consecutive failure threshold (3) is hardcoded with a comment explaining the rationale. This avoids config complexity for v1.
- The heartbeat staleness threshold (5 minutes) is hardcoded with a comment explaining: tick runs every 60 seconds, so 5 minutes means 5 missed ticks — enough to rule out transient delays.
- Relative time display should degrade gracefully: "just now" for < 1 min, "Xm ago" for < 1h, "Xh Ym ago" for < 1d, "Xd Yh ago" for longer.
- The report references file paths (stderr, run artifacts) rather than inlining content, keeping output token-efficient for AI agent consumption.


## Summary of Changes

All child tasks completed: Zod logger schema (tm-ymal), heartbeat & scheduler checks (tm-t4z4), task failure checks (tm-rsra), task validation/never-ran/contention checks (tm-g12o), report renderer (tm-w484), and orchestrator + CLI wiring (tm-a3la). The `tm doctor` command is fully operational.
