---
# tm-zaph
title: Running state visibility & streaming output
status: todo
type: feature
created_at: 2026-04-09T10:35:07Z
updated_at: 2026-04-09T10:35:07Z
---

## Problem Statement

When the tick process dispatches a task, there is zero visibility into what it does until it completes or crashes. There are two specific gaps:

1. **No "is running" status**: `tm status` only reads completed history entries (`history/<name>/<ts>.meta.json`), which are written after the process exits. Between dispatch and completion, a running task is completely invisible — there is no way to know that a task is currently executing.

2. **Output is fully buffered**: `defaultSpawnAgent` collects stdout/stderr into in-memory `Buffer[]` arrays and only writes them to disk via `recordHistory` after the process exits. There is no way to observe what an agent is doing while it runs — no `tail -f`, no streaming, nothing until the process terminates.

For long-running agent tasks (which can take minutes to hours), this makes the system feel like a black box. Operators cannot tell if a task is stuck, progressing, or even running at all.

## Solution

Two coordinated changes that give operators real-time visibility:

1. **Running state via the lock file**: After acquiring the exclusive flock, the `tm run` process writes JSON metadata (PID, start time, timestamp) into the lock file itself. Other processes (`tm status`, `tm history`, `tm logs`) can read this file freely (flock is advisory and doesn't block plain reads) and validate liveness via `process.kill(pid, 0)`. The metadata is truncated from the lock file before releasing the lock on completion.

2. **Streaming output via fd passthrough**: Instead of piping stdout/stderr through in-memory buffers, open a single output file (`history/<name>/<ts>.output.txt`) before spawning the agent and pass its file descriptor for both stdout and stderr stdio slots. The kernel writes output directly to the file in real-time with correct interleaving. The file is readable by other processes immediately — `tail -f` works out of the box.

3. **`tm logs <name>` command**: A new command that auto-detects whether a task is currently running (live tail with follow) or completed (one-shot print of most recent output). Provides the primary UX for observing task output.

## User Stories

1. As an operator, I want to see which tasks are currently running when I run `tm status`, so that I know the system is actively working.
2. As an operator, I want `tm status` to show how long a running task has been executing, so that I can detect stuck or unexpectedly slow tasks.
3. As an operator, I want `tm status` to show the path to the live output file of a running task, so that I can tail it manually if needed.
4. As an operator, I want task output to stream to disk in real-time during execution, so that I can observe what an agent is doing without waiting for it to finish.
5. As an operator, I want stdout and stderr to be interleaved in correct order in the output file, so that I see a coherent log of what happened.
6. As an operator, I want to run `tm logs <name>` to see the live output of a currently running task, so that I don't have to find and tail the file manually.
7. As an operator, I want `tm logs <name>` to automatically follow output when the task is running (like `tail -f`), so that I see new lines as they appear.
8. As an operator, I want `tm logs <name>` to print the most recent completed output when the task is not running, so that I can quickly review what happened last.
9. As an operator, I want `tm history <name>` to show in-progress runs alongside completed ones, so that I get a complete picture of task activity.
10. As an operator, I want in-progress runs to appear as the first entry in `tm history` with a "running" status, so that the most current state is immediately visible.
11. As an operator, I want the running state detection to be robust against crashes — if a task process dies without cleanup, the stale marker should be detected and cleaned up automatically.
12. As an operator, I want `tm status --json` to include running state with `started_at`, `timestamp`, `pid`, and `duration_ms` fields, so that I can build tooling on top of it.
13. As an operator, I want `tm history --json` to use a discriminated union (`status: 'running' | 'ok' | 'timeout' | 'err'`) so that I can programmatically distinguish running from completed entries.
14. As an operator, I want the merged stdout+stderr output model to simplify the history format — one `.output.txt` file instead of separate `.stdout.txt` and `.stderr.txt` — so that the system is easier to reason about.
15. As an operator, I want old history entries with `.stdout.txt`/`.stderr.txt` to continue working after the migration to `.output.txt`, so that I don't lose access to past data.

## Implementation Decisions

- **Lock file reused as running marker**: After `acquireTaskLock` returns a file descriptor, write JSON metadata (`{ pid, started_at, timestamp }`) into the lock file via `fs.writeSync`. Before releasing the lock, `fs.ftruncateSync` clears the content. No new files or directories needed. The marker schema is validated with Zod.
- **PID-based liveness detection**: Status/history readers call `readFileSync` on the lock file (advisory flocks don't block plain reads), parse the JSON, and validate the PID is alive via `process.kill(pid, 0)`. If the PID is dead, the marker is stale (process crashed) — report as not running.
- **Merged stdout+stderr into single output**: `defaultSpawnAgent` opens the output file and passes the same fd for both stdout and stderr stdio slots (`stdio: ['ignore', fd, fd]`). The kernel interleaves output in correct order. This replaces the current in-memory `Buffer[]` collection and the separate `stdout`/`stderr` strings.
- **`SpawnAgentResult` and `RunResult` change**: Replace `stdout: string` + `stderr: string` with a single `output: string` field. All downstream consumers (`recordHistory`, `main.ts` CLI output, etc.) adapt accordingly.
- **`recordHistory` writes `.output.txt`**: Instead of writing separate `.stdout.txt` and `.stderr.txt`, write a single `<ts>.output.txt`. When output is pre-written (streamed during execution), accept an `outputPrewritten` flag to skip the write.
- **fd passthrough with file read-back**: After the process exits, close the fd and read the file back into a string for the `output` field of the return value. This preserves the existing contract where callers receive the output as a string.
- **Timestamp threaded into `runTask`/`executeTask`**: The `timestamp` is added to `ExecuteOptions` so that `executeTask` can compute the output file path (`history/<name>/<ts>.output.txt`) and `runTask` can write the lock file marker.
- **`queryHistory` return type**: Add a discriminated union — entries have `status: 'running' | 'ok' | 'timeout' | 'err'`. Running entries lack `finished_at`, `exit_code`, `success`, `duration_ms` fields. The running state is detected at the caller level (checking the lock file) and prepended to the history results.
- **`tm logs <name>`**: Auto-detects running state. If running, reads the lock file marker to find the timestamp, constructs the output file path, and spawns `tail -f` on it (inheriting stdio for live streaming). If not running, finds the most recent history entry and prints its `.output.txt` content. Errors if no history exists and task is not running.
- **Backward compatibility**: `queryHistory` tries `.output.txt` first, falls back to `.stdout.txt` for old entries. Old `.stderr.txt` files are ignored (they'll purge naturally over time).

## Testing Decisions

Good tests for this feature verify observable behavior through the public interfaces — they should not depend on internal file layouts or implementation details. Test through the same functions that the CLI commands call.

Modules to test:
- **Running marker lifecycle** (write/read/truncate via lock file): Test that marker is readable during execution, absent after completion, and stale markers are detected when the PID is dead. Prior art: `src/run/run.test.ts` which already tests lock acquisition/release lifecycle with real flocks.
- **Streaming output** (fd passthrough): Integration test that spawns a real child process, verifies the output file is populated incrementally during execution (not just at the end), and that the read-back string matches. Prior art: `defaultSpawnAgent` integration test in `src/run/run.test.ts` that runs `echo hello`.
- **Status with running state**: Test that `getTaskStatuses` returns a running entry when a marker is present and the PID is alive. Prior art: `src/status/status.test.ts`.
- **History with running entries**: Test that the discriminated union correctly represents running vs completed entries. Prior art: `src/history/query.test.ts` (if it exists) or `src/history/record.test.ts`.
- **`tm logs` command**: Integration test for auto-detection behavior — running task triggers follow mode, completed task shows last output.
- **Backward compatibility**: Test that `queryHistory` reads old `.stdout.txt` entries alongside new `.output.txt` entries.

## Out of Scope

- Real-time push notifications or WebSocket streaming of task output
- A web UI or dashboard for monitoring tasks
- Changes to the tick dispatch mechanism itself (it continues to spawn and detach)
- Log rotation or output size limits
- Colorized or structured output parsing
- Changes to the cron matching or scheduling logic

## Further Notes

- The merged stdout+stderr model is a simplification. If future use cases require distinguishing the streams, a prefix-based approach (e.g., `[stderr]` line prefix) could be added later without changing the single-file model.
- `tail -f` behavior in `tm logs` depends on the platform's `tail` implementation. macOS and Linux both support `-f` for following file appends. Since the output file is written to via a stable fd (not replaced/rotated), `tail -f` works reliably.
- The advisory flock + plain read pattern is well-established in Unix tooling (e.g., PID files). The small risk of reading partial JSON during the initial `writeSync` is mitigated by treating parse failures as "not running."
