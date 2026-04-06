---
# tm-g3gd
title: 'Frontmatter schema: agent, run, args'
status: in-progress
type: task
priority: high
created_at: 2026-04-05T22:41:15Z
updated_at: 2026-04-06T05:15:33Z
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

- [ ] `agent: claude` parses successfully with no `run` field
- [ ] `run: some-cmd $TM_PROMPT_FILE` parses successfully with no `agent` field
- [ ] Both `agent` and `run` present → `FrontmatterValidationError` with clear message
- [ ] Neither `agent` nor `run` present → `FrontmatterValidationError` with clear message
- [ ] `args: --model sonnet --verbose` parses as a string, not an array
- [ ] `args` with `run` → `FrontmatterValidationError`
- [ ] `run` without `TM_PROMPT_FILE` → `FrontmatterValidationError`
- [ ] `args` defaults to empty string when omitted
- [ ] All existing frontmatter fields (schedule, timezone, cwd, env, enabled) continue to work
- [ ] Existing test fixtures updated to include `agent:` or `run:` field
- [ ] New test fixtures cover all validation edge cases
