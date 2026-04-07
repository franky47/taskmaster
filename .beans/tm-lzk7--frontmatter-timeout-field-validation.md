---
# tm-lzk7
title: Frontmatter timeout field + validation
status: completed
type: task
priority: normal
created_at: 2026-04-07T12:28:50Z
updated_at: 2026-04-07T14:45:52Z
parent: tm-7fv4
---

## What to build

Add a `timeout` optional string field to the task frontmatter Zod schema. The field accepts human-friendly duration strings (e.g. `"30s"`, `"5m"`, `"2h"`) parsed by the `ms` npm package. The Zod refinement rejects values that `ms()` cannot parse or that resolve to less than 1000ms. The schema transform converts the string to a number (milliseconds) in the output type. The field threads through both the agent and run discriminated union variants.

`tm validate` rejects invalid timeout values with clear error messages. `tm list` shows the field if present.

## Acceptance criteria

- [x] `timeout` field added to `rawFrontmatter` Zod schema as optional string
- [x] Valid duration strings (`"30s"`, `"5m"`, `"2h"`) are accepted and converted to milliseconds
- [x] Invalid strings (e.g. `"abc"`, `""`) are rejected with a descriptive error
- [x] Values under 1 second (e.g. `"500ms"`, `"0s"`) are rejected with a descriptive error
- [x] The field threads through both agent and run variants in the schema transform
- [x] `tm validate` catches invalid timeout values
- [x] Tests cover valid inputs, invalid inputs, boundary cases (exactly 1s), and both variants

## User stories addressed

- User story 2: human-readable duration string
- User story 3: optional with no default
- User story 4: validation rejects invalid values


## Summary of Changes

Added `timeout` optional field to task frontmatter using `z.templateLiteral` with a time unit enum to produce types assignable to `ms.StringValue` without type assertions. The schema validates format, rejects sub-1s values, and transforms to milliseconds. `TaskListEntry` updated to include timeout.
