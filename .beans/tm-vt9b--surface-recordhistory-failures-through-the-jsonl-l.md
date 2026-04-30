---
# tm-vt9b
title: Surface recordHistory failures through the JSONL log
status: todo
type: bug
priority: high
created_at: 2026-04-30T19:25:12Z
updated_at: 2026-04-30T19:25:12Z
parent: tm-0o9e
---

## What to build

When `recordHistory` fails inside the `tm run` action handler, write a structured entry to the JSONL log in addition to the existing stderr message, so chronic disk problems become visible to `tm doctor` even under `tm tick` / `tm dispatch` (where the child process's stderr is `stdio: 'ignore'` and discarded). Exit codes are unchanged.

See parent PRD `tm-0o9e` § "Branch 1 — `recordHistory` failure observability" for full design rationale, including why `event:'error'` is reused rather than introducing a new event type, and why exit codes are deliberately not escalated.

## Acceptance criteria

- [ ] In `src/main.ts`, the agent path (around line 198) writes `log({ event: 'error', task: name, reason: 'history-write-failed', cause: recordErr.message }, logFilePath)` when `recordHistory` returns an error, in addition to the existing `console.error`
- [ ] Same call added on the payload-error path (around line 239)
- [ ] Same call added on the skipped-preflight / preflight-error path (around line 284)
- [ ] Exit codes for all three paths are unchanged (agent → `exitCode`; payload-error / skipped-preflight / preflight-error → 0)
- [ ] `console.error(recordErr.message)` is preserved on all three paths so direct-CLI users still see the failure on their terminal
- [ ] Unit tests assert that injecting a `recordHistory` failure on each of the three paths produces both the JSONL log entry (with `reason: 'history-write-failed'`) and the stderr write
- [ ] The new log entries are picked up by `checkLogErrors` (existing doctor check) without any new doctor wiring — verified by inspection or test
- [ ] `bun run check` passes after the change

## User stories addressed

Reference by number from parent PRD `tm-0o9e`:

- User story 1
- User story 2
