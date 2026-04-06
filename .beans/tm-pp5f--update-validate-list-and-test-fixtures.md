---
# tm-pp5f
title: Update validate, list, and test fixtures
status: completed
type: task
priority: normal
created_at: 2026-04-05T22:41:58Z
updated_at: 2026-04-06T22:41:10Z
parent: tm-eu53
blocked_by:
    - tm-g3gd
---

## What to build

Update the remaining commands and test infrastructure to work with the new frontmatter schema.

### tm validate

Already works via the frontmatter schema — the new cross-field validations (agent/run mutual exclusivity, args only with agent, TM_PROMPT_FILE check) will surface automatically through `tm validate`. Verify this with new test cases.

### tm list

Currently shows `name schedule enabled`. Consider whether to show the agent/run field. At minimum, ensure it doesn't break with the new frontmatter fields.

### tm status

Same as list — ensure it doesn't break. The `agent`/`run` field could appear in the status output as a future enhancement (out of scope per PRD, but the plumbing should not prevent it).

### Test fixtures

All existing test fixtures in `src/task/fixtures/` use the old format (no `agent`/`run` field). Every fixture must be updated to include either `agent:` or `run:`. Add new fixtures for:
- Task with `agent:` + `args:`
- Task with `run:` using `$TM_PROMPT_FILE`
- Invalid: both `agent:` and `run:`
- Invalid: neither `agent:` nor `run:`
- Invalid: `args:` with `run:`
- Invalid: `run:` without `TM_PROMPT_FILE`

## Acceptance criteria

- [x] `tm validate` catches all new validation errors (agent/run mutual exclusivity, etc.)
- [x] `tm list` works with new frontmatter (no regression)
- [x] `tm status` works with new frontmatter (no regression)
- [x] All existing test fixtures updated to new format
- [x] New fixtures cover all validation edge cases
- [x] All tests pass: `bun test`

## Summary of Changes

Added test coverage for the run-variant code path across validate, list, status,
and parser tests. Added valid-run.md fixture. Fixed INVALID_TASK in validate
tests to include agent field so it stays focused on schedule/timezone errors.
