---
# tm-h1js
title: Event dispatch end-to-end
status: completed
type: task
priority: high
created_at: 2026-04-10T08:36:29Z
updated_at: 2026-04-10T10:06:30Z
parent: tm-k9xd
blocked_by:
    - tm-g3h4
    - tm-xonu
---

## What to build

The core event dispatch feature. A new dispatch module scans all task files for `on.event` matching a given event name, filters by `enabled` and connectivity, optionally reads stdin as a payload, and spawns matching tasks in parallel (detached, fire-and-forget).

End-to-end: a user creates an event task file, pipes context into `tm dispatch <event>`, and the matching tasks run with the payload appended to their prompt body.

Key behaviors:
- Payload (stdin) is optional. If present, appended to task body with a `---` separator. If absent, task body used as-is.
- Fan-out: multiple tasks can subscribe to the same event.
- Fire-and-forget: spawns detached children, reports results, exits immediately.
- Respects `enabled` flag and `when-online` connectivity check.
- No locking — dispatched tasks always run (depends on locking refactor).
- History records `trigger: 'dispatch'` and the `event` name.
- Default timeout for event tasks: 1 hour.
- CLI: `tm dispatch <event>` with `--json` flag.
- Human-readable output lists dispatched and skipped tasks.

## Acceptance criteria

- [x] New dispatch module with interface: `dispatch(eventName, payload?) => DispatchResult`
- [x] `tm dispatch <event>` finds all tasks with `on.event` matching `<event>`
- [x] Multiple tasks subscribing to the same event are all dispatched
- [x] Stdin is read when piped and appended to task body with `---` separator
- [x] No separator appended when stdin is empty / TTY
- [x] Tasks spawned as detached processes (fire-and-forget)
- [x] `enabled: false` tasks are skipped with reason
- [x] `enabled: 'when-online'` tasks check connectivity and skip if offline
- [x] History entries include `trigger: 'dispatch'` and `event: '<name>'`
- [x] Event tasks default to 1 hour timeout when no explicit `timeout` set
- [x] `--json` outputs `{ event, dispatched, skipped }` structure
- [x] Human-readable output lists dispatched and skipped task names
- [x] `tm dispatch` for an event with no subscribers reports empty result (not an error)

## User stories addressed

- User story 1 (trigger workflows on events)
- User story 3 (pipe context via stdin)
- User story 4 (multiple tasks per event)
- User story 5 (fire-and-forget)
- User story 7 (respect enabled flag)
- User story 8 (when-online connectivity check)
- User story 9 (see dispatched/skipped)
- User story 10 (--json output)
- User story 13 (history shows event)
- User story 14 (1hr default timeout)
- User story 17 (stdin optional)
- User story 18 (payload with --- separator)

## Summary of Changes

New dispatch module (src/dispatch/) mirrors tick's architecture: list tasks, filter by event match + enabled + connectivity, spawn detached children via `tm run` with hidden `--trigger dispatch --event <name>` flags. Extended history schema with optional trigger/event fields (with cross-field refinement). Added payload support to executeTask — appends to prompt with `---` separator via temp files. Extended logger for dispatch trigger and disabled skip reason.
