---
# tm-g3gd
title: 'Frontmatter schema: agent, run, args'
status: completed
type: task
priority: high
created_at: 2026-04-05T22:41:15Z
updated_at: 2026-04-06T21:59:40Z
parent: tm-eu53
---

## What to build

Update the frontmatter Zod schema to support the new multi-agent fields. This is the foundation slice — everything else depends on parsing these fields correctly.

### Schema changes

- Add `agent` field: `z.string().optional()` — name of a registered agent
- Add `run` field: `z.string().optional()` — raw shell command referencing `$TM_PROMPT_FILE`
- Change `args` from `z.array(z.string()).optional().default([])` to `z.string().optional().default('')` — plain string
- Add cross-field validation via `.superRefine()`:
  - Exactly one of `agent` or `run` must be present (neither → error, both → error)
  - `args` is only valid when `agent` is set (using `args` with `run` → error)
  - `run` must contain the literal string `TM_PROMPT_FILE` (missing → warning-level error: "this task will ignore its prompt")

### Type changes

- `Frontmatter` type gains `agent?: string`, `run?: string`
- `args` changes from `string[]` to `string`
- `TaskDefinition` type changes accordingly

## Acceptance criteria

- [x] `agent: claude` parses successfully with no `run` field
- [x] `run: some-cmd $TM_PROMPT_FILE` parses successfully with no `agent` field
- [x] Both `agent` and `run` present → `FrontmatterValidationError` with clear message
- [x] Neither `agent` nor `run` present → `FrontmatterValidationError` with clear message
- [x] `args: --model sonnet --verbose` parses as a string, not an array
- [x] `args` with `run` → `FrontmatterValidationError`
- [x] `run` without `TM_PROMPT_FILE` → `FrontmatterValidationError`
- [x] `args` defaults to empty string when omitted
- [x] All existing frontmatter fields (schedule, timezone, cwd, env, enabled) continue to work
- [x] Existing test fixtures updated to include `agent:` or `run:` field
- [x] New test fixtures cover all validation edge cases

## Summary of Changes

Updated the frontmatter Zod schema to support multi-agent execution. The schema
now requires exactly one of `agent` (named agent) or `run` (raw shell command),
with `args` changed from `string[]` to `string` and only valid with `agent`.

The output type is a discriminated union (`AgentFrontmatter | RunFrontmatter`)
produced via `.superRefine()` + `.transform()`, with all types inferred from the
schema. Cross-field validation routes errors to specific field keys for clear
error messages.

Temporary executor adaptations marked with `// AGENT(tm-5nbg):` comments.
