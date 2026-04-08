---
# tm-kgff
title: Connectivity-aware task scheduling
status: draft
type: feature
priority: normal
tags:
    - connectivity
    - scheduling
created_at: 2026-04-08T10:01:13Z
updated_at: 2026-04-08T10:01:13Z
---

## Problem Statement

Taskmaster schedules and executes tasks on a cron schedule, but it has no awareness of network connectivity. Most tasks invoke cloud-hosted AI models (Claude, Codex, etc.) that require internet access. When the machine is offline — a laptop on a plane, a flaky connection, a network outage — these tasks are dispatched, fail, and pollute the run history with errors that aren't actionable. Meanwhile, tasks that *could* run offline (using local models like Ollama) are not distinguished from network-dependent ones, so there's no way to keep productive work flowing during offline periods.

Users have no visibility into *why* tasks didn't run. There's no record of connectivity-related skips, and `tm doctor` can't surface patterns like "this task was skipped 12 times last week because you were offline."

## Solution

Extend the `enabled` frontmatter field from a boolean to a three-value enum that expresses scheduling conditions:

- `enabled: false` — task is never scheduled (unchanged behavior)
- `enabled: 'when-online'` — task is only scheduled when the machine has internet connectivity (new default)
- `enabled: 'always'` — task is always scheduled regardless of connectivity (for local-model tasks)

When `tm tick` runs, it performs a single DNS connectivity probe before dispatching tasks. If the machine is offline, only `enabled: 'always'` tasks are dispatched. Tasks skipped due to offline connectivity are logged to the global event log with `reason: 'offline'`, and `tm doctor` aggregates these skips into actionable diagnostics with a hint to use `enabled: 'always'`.

Manual execution via `tm run` is unaffected — it always runs the task regardless of connectivity, consistent with how `enabled: false` is already ignored for manual runs.

## User Stories

1. As a user with a laptop, I want network-dependent tasks to be silently skipped when I'm offline, so that my run history isn't polluted with predictable failures.
2. As a user with local models, I want to mark tasks as `enabled: 'always'`, so they continue running on schedule even when I'm offline.
3. As a user who doesn't know about the connectivity feature, I want the default behavior to be sensible (skip cloud tasks when offline), so I don't have to configure anything upfront.
4. As a user debugging missed runs, I want `tm doctor` to tell me "task X was skipped N times due to offline connectivity", so I understand why tasks didn't execute.
5. As a user debugging missed runs, I want `tm doctor` to suggest `enabled: 'always'` for tasks that were skipped due to offline, so I know what action to take.
6. As a user, I want `tm list` to show an `always` tag on tasks with `enabled: 'always'`, so I can quickly see which tasks are connectivity-independent.
7. As a user, I want `tm status` to display the `enabled` field value, so I can see the scheduling condition for each task.
8. As a user, I want `tm run <name>` to always execute the task regardless of connectivity, so I can manually trigger any task at any time.
9. As a user, I want `tm validate` to reject `enabled: true` (the old boolean form), so I'm guided toward the new enum values.
10. As a user, I want the connectivity check to be fast and not delay my tick cycle, so scheduled tasks aren't significantly delayed.
11. As a user, I want the connectivity check to be resilient to a single DNS provider being down, so tasks aren't incorrectly skipped.
12. As a user, I want `--json` output from `tm list` and `tm status` to include the `enabled` field as its enum value, so tooling can consume it.
13. As a user, I want skipped-due-to-offline events to appear in the global log, so I have an audit trail.
14. As a user who has only `enabled: 'always'` tasks due in a tick, I want the DNS probe to be skipped entirely, so no unnecessary network traffic occurs.
15. As a user with no tasks due in a tick, I want the DNS probe to be skipped, so the tick completes instantly.

## Implementation Decisions

### `enabled` field schema change

The Zod schema for `enabled` changes from `z.boolean().default(true)` to `z.union([z.literal(false), z.literal('when-online'), z.literal('always')]).default('when-online')`. No backward compatibility for `enabled: true` — this is a greenfield project. The output type is `false | 'when-online' | 'always'`.

### Connectivity detection — DNS probe

A new `network` module exports an `isOnline()` function. It creates two `dns.Resolver` instances — one pointing at `1.1.1.1` (Cloudflare), one at `8.8.8.8` (Google). Each resolves its own hostname (`one.one.one.one` and `dns.google` respectively) with a 2-second `AbortSignal.timeout`. Both probes run in parallel via `Promise.any`. If either resolves, the machine is online. If both fail, it's offline.

The function accepts an optional resolver factory parameter for dependency injection in tests.

### Tick pipeline changes

The tick dispatch pipeline gains a connectivity filter stage. The full pipeline with early exits at each stage:

1. Load all task files
2. Filter out `enabled: false` tasks (early exit if empty)
3. Evaluate cron expressions against floored time (early exit if empty)
4. Deduplicate against history (early exit if empty)
5. DNS probe — **skipped entirely** if no remaining tasks have `enabled: 'when-online'` (all remaining are `'always'`, or list is empty)
6. If offline, filter out `enabled: 'when-online'` tasks; log each as `{ event: 'skipped', reason: 'offline' }` to the global log
7. Dispatch remaining tasks

### Logger extension

The `skippedEntrySchema` reason field extends from `z.literal('contention')` to `z.enum(['contention', 'offline'])`. The `LogInput` type union gains `reason: 'contention' | 'offline'`. No other schema changes.

### Doctor diagnostic

A new diagnostic aggregates `skipped` log entries with `reason: 'offline'` from `readLog(since)`. Groups by task name, counts skips. For each task with at least 1 offline skip in the window, emits a `warning`-severity finding:

> task "sync-notes" was skipped 12 times due to offline connectivity
> hint: set `enabled: 'always'` if this task can run without network

### Display changes

- `tm list`: append `always` tag after `enabled`/`disabled` when `enabled: 'always'`. Show `when-online` as `enabled` (it's the default, no extra tag). Show `false` as `disabled`.
- `tm status`: display the `enabled` field using its enum value (`false`, `when-online`, `always`).
- `--json` output: include `enabled` as the enum string value in both commands.

### Manual execution

`tm run <name>` always executes the task. No connectivity check. Consistent with existing precedent where `enabled: false` is ignored for manual runs.

## Testing Decisions

Good tests for this feature verify external behavior (what the system does), not implementation details (how it does it). Tests should use dependency injection — the established pattern in this codebase — rather than module-level mocking.

### Modules to test

**Zod schema (unit, `frontmatter.test.ts`):**
- `false`, `'when-online'`, `'always'` parse successfully
- `true` is rejected
- Omitted `enabled` defaults to `'when-online'`
- Full frontmatter round-trip with new enabled values

**`isOnline()` (unit, `network.test.ts`):**
- Both resolvers succeed → online
- One resolver fails, one succeeds → online
- Both resolvers fail → offline
- Inject resolver factory via DI, no real DNS calls

**Tick connectivity filter (unit, `tick.test.ts`):**
- When offline: `when-online` tasks are filtered, `always` tasks are dispatched
- When online: all enabled tasks are dispatched
- DNS probe is skipped when all remaining tasks are `always`
- DNS probe is skipped when no tasks are due
- Offline-skipped tasks are logged with `reason: 'offline'`
- Early exit at each pipeline stage

**Logger (unit, `logger.test.ts`):**
- `{ event: 'skipped', reason: 'offline' }` entries serialize and parse correctly

**Doctor diagnostic (unit, `doctor.test.ts`):**
- Offline skip entries produce warning findings with correct count and hint message
- No offline skips produce no findings
- Prior art: existing doctor tests use DI via `DoctorDeps` to inject fake log entries

**Display (unit, `list.test.ts`, `status.test.ts`):**
- `tm list` shows `always` tag for `enabled: 'always'` tasks
- `tm list` shows `enabled` for `when-online` tasks (default display)
- `tm status` shows enum value in detail output
- JSON output includes `enabled` as string value

### Integration tests

The `isOnline()` function and tick pipeline connectivity filter tests that involve real async behavior or process spawning use `*.integration-test.ts` naming convention per project conventions.

## Out of Scope

- **Captive portal detection**: DNS probes may return false positives on captive portals. This is a known limitation, not addressed in this iteration.
- **Configurable DNS servers**: The probe targets are hardcoded to `1.1.1.1` and `8.8.8.8`. User-configurable DNS servers are not included.
- **Retry on offline**: If a task is skipped due to offline, it is not retried when connectivity returns. It waits for the next cron match.
- **`enabled: 'when-offline'`**: A condition that only runs when offline (inverse of `when-online`) is not included but the enum is extensible for future additions.
- **Network quality detection**: Only binary online/offline is detected. Slow or degraded connectivity is not handled.
- **`tm run` connectivity gating**: Manual execution always runs. There is no `--check-connectivity` flag.

## Further Notes

- The `enabled` enum is designed to be extensible. Future conditions (e.g., `when-on-power`, `when-idle`, `when-on-wifi`) could be added as new string literals without schema-breaking changes.
- The DNS probe is designed to add minimal latency to the tick cycle. In the common case (machine is online, probe succeeds in <100ms), the overhead is negligible. In the worst case (both probes timeout), it adds 2 seconds to the tick.
- The probe is skipped entirely when it can't affect the outcome (no due tasks, or all due tasks are `always`), making it zero-cost in those cases.
- Doctor diagnostics provide the discoverability mechanism for this feature. Users who don't know about `enabled: 'always'` will be guided to it when their tasks start getting skipped.
