---
# tm-k9xd
title: Event-driven task dispatch
status: completed
type: feature
priority: normal
created_at: 2026-04-10T08:26:07Z
updated_at: 2026-04-10T10:45:10Z
---

## Problem Statement

Taskmaster currently only supports cron-scheduled tasks. When an event occurs on the machine (a deploy, a file change, a webhook landing), there is no way to trigger an AI workflow in response. Users must either poll on a cron schedule (wasteful and delayed) or manually run tasks. There is no mechanism to pass event-specific context into a task's prompt.

## Solution

Add event-driven task dispatch to taskmaster. Tasks can subscribe to a named event via a new `on: { event: <name> }` frontmatter field. A new `tm dispatch <event>` command finds all tasks subscribed to that event and runs them in parallel, fire-and-forget. Stdin can optionally be piped into the command to inject event-specific context into each task's prompt body.

This replaces the top-level `schedule` field with a unified `on:` field that supports either `schedule` (cron) or `event` (dispatch) — but not both on the same task.

## User Stories

1. As a developer, I want to trigger AI workflows when a deploy happens, so that I can automate post-deploy checks with context about what was deployed.
2. As a user, I want to define event-driven tasks in the same markdown format as scheduled tasks, so that I don't need to learn a new configuration system.
3. As a user, I want to pipe event context via stdin into `tm dispatch`, so that the triggered tasks receive relevant information about the event.
4. As a user, I want multiple tasks to react to the same event, so that one event can trigger several independent workflows in parallel.
5. As a user, I want `tm dispatch` to return immediately after spawning tasks, so that the dispatching process (hook, script, etc.) is not blocked.
6. As a user, I want dispatched tasks to always run even if a previous invocation is still running, so that no events are lost due to contention.
7. As a user, I want `tm dispatch` to respect the `enabled` flag, so that I can disable event tasks without removing them.
8. As a user, I want `tm dispatch` to check connectivity for `when-online` tasks, so that tasks requiring network access are skipped when offline.
9. As a user, I want to see which tasks were dispatched and which were skipped, so that I can verify the dispatch worked.
10. As a user, I want `tm dispatch --json` for machine-readable output, so that other tools can parse the result.
11. As a user, I want `tm list` to show event tasks alongside scheduled tasks, displaying the event name where the cron expression would be, so that I can see all tasks in one view.
12. As a user, I want `tm status` to show event tasks without a "next run" time, so that the display makes sense for event-driven tasks.
13. As a user, I want `tm history` to show which event triggered a dispatched task, so that I can trace runs back to events.
14. As a user, I want event tasks to have a sensible default timeout (1 hour), so that runaway processes are killed even without explicit configuration.
15. As a user, I want `tm doctor` to skip "never-ran" and "timeout/schedule mismatch" checks for event tasks, so that I don't get false warnings.
16. As a user, I want the `on:` field to enforce exactly one of `schedule` or `event`, so that invalid configurations are caught at parse time.
17. As a user, I want stdin to be optional in `tm dispatch` — if nothing is piped, the task body is used as-is without a separator appended.
18. As a user, I want the event payload appended to the task body with a `---` separator, so that the agent sees the standing instructions followed by the event context.

## Implementation Decisions

### Frontmatter schema change
- Replace top-level `schedule` field with `on:` object containing exactly one of `schedule` (cron string) or `event` (string name).
- This is a hard breaking change — no backwards compatibility. Existing tasks must be manually migrated by moving `schedule` into `on.schedule`.
- The `on:` field uses a discriminated union in the Zod schema.

### Dispatch module (new)
- New deep module with interface: `dispatch(eventName, payload?) => DispatchResult`.
- Scans all task files for matching `on.event`.
- Filters by `enabled` and connectivity (same logic as tick).
- Assembles the prompt file: task body + `---\n` + payload (if provided).
- Spawns matching tasks in parallel as detached processes (fire-and-forget).
- Returns `{ dispatched: string[], skipped: { task: string, reason: string }[] }`.

### Locking refactor
- Remove lock acquisition from `runTask()` — it becomes lock-unaware.
- Move lock acquisition into the tick dispatcher only.
- `tm run` (manual) and `tm dispatch` both call `runTask()` without locking.
- This means dispatched tasks can run concurrently — no events lost to contention.

### History extension
- Add `'dispatch'` to the trigger type union (`'tick' | 'manual' | 'dispatch'`).
- Add optional `event: string` field to history entries.
- Display event name in `tm history` output when present.

### Timeout for event tasks
- No schedule interval to derive a default timeout from.
- Default to 1 hour for event tasks.
- Can be overridden with explicit `timeout` field in frontmatter.

### Display changes
- `tm list`: show `event:<name>` in place of cron expression for event tasks.
- `tm status`: show `-` or equivalent for "next run" on event tasks.

### Doctor adjustments
- Skip "never-ran" check for event tasks (they may legitimately never have been triggered).
- Skip "timeout/schedule mismatch" check for event tasks (no schedule interval to compare against).

### CLI command
- `tm dispatch <event>` with `--json` flag.
- Reads stdin when piped (not a TTY), otherwise no payload.
- Human-readable output by default listing dispatched and skipped tasks.

## Testing Decisions

Good tests verify external behavior through public interfaces, not implementation details. Tests should exercise the module boundaries — give it inputs, assert on outputs.

### Modules to test

- **Frontmatter schema**: Test that `on: { schedule: '...' }` and `on: { event: '...' }` parse correctly, that both together is rejected, that neither is rejected, and that the old top-level `schedule` field is rejected. Prior art: existing frontmatter parser tests.
- **Dispatch module**: Test event matching (fan-out to multiple tasks), enabled/connectivity filtering, payload assembly (with and without stdin), and the returned dispatched/skipped result. Mock the spawn layer, test the orchestration logic.
- **History schema**: Test that `trigger: 'dispatch'` and `event` field serialize/deserialize correctly.

### TDD approach for refactored modules

For modules that refactor existing code (tick dispatcher, task runner, list/status, doctor), follow TDD:
1. Update existing tests first to reflect the new desired behavior and interface (e.g., `on.schedule` instead of `schedule`, lock acquisition in tick not in runTask).
2. Verify the updated tests fail — if they pass, it reveals a coverage gap that should be investigated.
3. Change the implementation to make the tests pass.

## Out of Scope

- Tasks subscribing to multiple events (array of event names) — can be added later by widening string to string array.
- A task having both `schedule` and `event` triggers simultaneously.
- Queuing or retry of dispatched tasks — fire-and-forget only.
- `--wait` flag to block until dispatched tasks complete.
- `tm dispatch --list` to list all known events — `tm list` already surfaces this.
- Event payload templating (e.g., `{{payload}}` in task body) — append-only for now.

## Further Notes

- The `on:` syntax is inspired by GitHub Actions, providing a familiar mental model.
- Since `schedule` and `event` are mutually exclusive on a task, there is no scenario where a cron run and a dispatch run contend on the same task — this eliminates a class of edge cases.
- The locking refactor (pulling locks out of runTask into tick) simplifies the task runner and makes the codebase cleaner overall, independent of the event dispatch feature.


## Summary of Changes

All 18 user stories implemented across 5 prior commits plus a race-condition fix:

- **Frontmatter schema**: `schedule` replaced with `on: { schedule | event }` discriminated union via Zod
- **Dispatch module**: `dispatch(eventName, payload?)` scans tasks, filters by enabled/connectivity, spawns matches fire-and-forget
- **Locking refactor**: Lock acquisition moved from `runTask` into tick dispatcher only; dispatch and manual runs are lock-free
- **History**: `trigger: 'dispatch'` and `event` field added to history schema with cross-field refinement
- **Display**: `tm list` shows `event:<name>`, `tm status` shows `-` for next run on event tasks
- **Doctor**: Skips never-ran and timeout/schedule mismatch checks for event tasks
- **CLI**: `tm dispatch <event>` reads optional stdin payload, supports `--json`
- **Bug fix**: Per-task payload files to prevent race condition when multiple tasks fan out from the same event
