---
# tm-7fv4
title: Task timeout support
status: todo
type: epic
priority: high
tags:
    - cli
created_at: 2026-04-07T12:22:52Z
updated_at: 2026-04-07T12:22:55Z
---

## Problem Statement

Taskmaster tasks run via `sh -c <command>` with no execution time limit. A runaway agent or script will block indefinitely — consuming resources, holding the task lock (preventing the next scheduled run), and requiring manual intervention to kill. Users have no way to express "this task should never run longer than X" in their task definition.

## Solution

Add an optional `timeout` field to the task frontmatter that accepts a human-friendly duration string (e.g. `"30s"`, `"5m"`, `"2h"`). When a task exceeds its timeout, taskmaster sends SIGTERM to the entire process group, waits a 10-second grace period for cleanup, then sends SIGKILL. The timed-out run is recorded in history with exit code 124, `success: false`, and a `timed_out: true` flag.

No timeout is enforced by default — the field is opt-in.

## User Stories

1. As a user, I want to set a maximum run duration for a task in frontmatter, so that runaway agents are automatically killed.
2. As a user, I want to express the timeout as a human-readable string like `"5m"` or `"2h"`, so that I don't have to convert to seconds or milliseconds.
3. As a user, I want the timeout to be optional with no default, so that existing tasks are unaffected.
4. As a user, I want `tm validate` to reject invalid timeout values (unparseable strings, values under 1 second), so that I catch configuration errors before runtime.
5. As a user, I want the timed-out process and all its children to be killed (not just the shell wrapper), so that the actual agent is terminated.
6. As a user, I want SIGTERM sent first with a grace period before SIGKILL, so that well-behaved agents can clean up resources before being force-killed.
7. As a user, I want timed-out runs to be recorded in history with a `timed_out` flag, so that I can distinguish timeouts from other failures.
8. As a user, I want timed-out runs to use exit code 124 (matching GNU timeout convention), so that the exit code is predictable and scriptable.
9. As a user, I want partial stdout/stderr from timed-out runs to be preserved, so that I can inspect what the agent was doing when it was killed.
10. As a user, I want `tm status` to display the configured timeout for tasks that have one, so that I can see the timeout policy at a glance.
11. As a user, I want the timeout to apply to both `agent` and `run` task variants, so that the feature works uniformly regardless of execution mode.
12. As a user, I want the task lock to be released after a timeout kill, so that the next scheduled run is not blocked.

## Implementation Decisions

### Frontmatter schema
- New optional `timeout` field on `rawFrontmatter` Zod schema
- Input type: string (human-friendly duration like `"30s"`, `"5m"`, `"2h"`)
- Parsed by the `ms` npm package during Zod validation
- Zod refinement rejects values that `ms()` cannot parse or that resolve to less than 1000ms
- The schema transform converts the string to a number (milliseconds) in the output type
- The field threads through both the agent and run discriminated union variants

### Spawn agent (deep module)
- `SpawnAgentOpts` gains `timeout?: number` (milliseconds, undefined = no limit)
- `SpawnAgentResult` gains `timedOut: boolean`
- Process spawned with new process group so the entire tree can be killed
- On timeout: `kill(-pid, SIGTERM)` to the process group, wait 10s grace (`KILL_GRACE_MS = 10_000` constant), then `kill(-pid, SIGKILL)`
- On normal exit before timeout: timer is cancelled, `timedOut: false`
- Partial stdout/stderr is captured up to the kill point (streams close when process dies)
- The parent `tm run` process is in a separate process group and is not affected by the kill signal

### Execute/run pipeline
- `executeTask` threads `task.timeout` into spawn opts
- `RunResult` gains `timedOut: boolean`
- No changes to lock acquisition/release — the existing `DisposableStack` cleanup handles this

### History schema
- `timed_out` boolean field added to history metadata schema, defaulting to `false` for backwards compatibility with existing records
- Exit code overridden to 124 when `timedOut` is true
- `success` is `false` for timed-out runs
- Failed-run artifact preservation (temp dir moved to history) works unchanged

### Status display
- `TaskStatus` type gains optional `timeout` string field (the raw human-readable value from frontmatter)
- Displayed in `tm status` output when present

### Grace period
- Hardcoded as a constant (`KILL_GRACE_MS = 10_000`), not exposed in frontmatter
- This is an operational detail, not a per-task policy knob

## Testing Decisions

Good tests for this feature test external behavior through the module's public interface with synthetic inputs. They do not rely on real long-running processes or wall-clock timing.

### Modules to test

**Frontmatter schema**: Test that valid timeout strings are accepted and converted to milliseconds. Test that invalid strings, sub-1s values, and non-string types are rejected with clear error messages. Prior art: existing frontmatter validation tests.

**Spawn agent with timeout (deep module)**: Test with a real `sleep` command and a short timeout (e.g. 100ms timeout on `sleep 60`) to verify the process is killed, `timedOut` is true, and partial output is captured. Test that a fast command with a generous timeout completes normally with `timedOut: false`. This is the highest-value test surface. Prior art: existing executor tests that use the DI `spawnAgent` seam.

**History schema**: Test that records with and without `timed_out` field parse correctly (backwards compatibility).

The execute pipeline and CLI wiring are thin plumbing — covered by the spawn agent and schema tests.

## Out of Scope

- Global default timeout (each task must opt in explicitly)
- Configurable grace period (hardcoded to 10 seconds)
- Per-task SIGKILL-only mode (always does SIGTERM first)
- Doctor integration for timeout-specific diagnostics (separate issue, depends on both this epic and the doctor epic)
- Timeout for the `tm run` command itself (only the spawned agent is timed)

## Further Notes

- The `ms` npm package must be added as a dependency (`bun add ms`, `bun add -d @types/ms`)
- Exit code 124 follows the GNU `timeout` command convention, making the behavior familiar to Unix users
- The process group kill strategy (`kill(-pgid, signal)`) ensures that agent subprocesses (e.g. Claude spawning tool calls) are also terminated
- The `timed_out` field in history is designed to be consumed by the future `tm doctor` command for timeout-specific diagnostics
