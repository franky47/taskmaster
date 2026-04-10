---
# tm-g3h4
title: 'on: schema migration (schedule → on.schedule | on.event)'
status: completed
type: task
priority: high
created_at: 2026-04-10T08:35:44Z
updated_at: 2026-04-10T09:17:44Z
parent: tm-k9xd
---

## What to build

Replace the top-level `schedule` frontmatter field with a unified `on:` object containing a discriminated union: `{ schedule: string } | { event: string }`. Exactly one key is required. Update the Zod schema, parser, tick dispatcher, validate command, and all other consumers of the parsed frontmatter type. Update all test fixtures to use the new syntax.

This is a hard breaking change — no backwards compatibility (see parent PRD).

## Acceptance criteria

- [x] Zod schema accepts `on: { schedule: '...' }` and `on: { event: '...' }`
- [x] Schema rejects tasks with both `schedule` and `event` under `on:`
- [x] Schema rejects tasks with neither `schedule` nor `event` under `on:`
- [x] Schema rejects the old top-level `schedule` field
- [x] All existing consumers (tick, run, list, status, validate, doctor, schedule interval) read from `on.schedule` instead of `schedule`
- [x] All test fixtures updated to new format
- [x] `tm validate` reports clear errors for old-format task files

## TDD approach

This refactors existing code. Follow TDD:

1. Update existing frontmatter, parser, and tick tests first to expect `on.schedule` / `on.event` instead of `schedule`.
2. Verify the updated tests fail — if they pass, it reveals a coverage gap that should be investigated.
3. Change the implementation to make the tests pass.

## User stories addressed

- User story 2 (same markdown format)
- User story 16 (exactly one of schedule or event enforced)

## Summary of Changes

Replaced top-level `schedule` frontmatter field with `on: { schedule } | { event }` discriminated union. Updated Zod schema, all consumers (tick, list, status, doctor, main), all test files and fixtures. Added old-format detection with helpful migration error. Event tasks default to 1hr timeout.
