---
# tm-nzcg
title: <PAYLOAD/> token and removal of implicit payload append
status: todo
type: feature
priority: normal
created_at: 2026-04-28T14:43:10Z
updated_at: 2026-04-28T14:43:10Z
parent: tm-ron0
blocked_by:
    - tm-ttdd
---

## What to build

Add `<PAYLOAD/>` as a second substitution token, sharing the module introduced in tm-ttdd, and **remove** the implicit `task.prompt + '\n---\n' + payload` append from the runner. After this slice, the only path a dispatch payload takes into the prompt is via `<PAYLOAD/>` substitution — there is exactly one mechanism for both data sources.

Refer to parent PRD tm-ron0 for: "Solution" (`<PAYLOAD/>` rules), "Implementation Decisions → Frontmatter" (token-on-non-event validation), "Implementation Decisions → Removed behavior", "Implementation Decisions → Modules" (single shared module), "Further Notes" (single-mechanism rationale).

## Acceptance criteria

- [ ] Shared substitution module accepts both `<PREFLIGHT/>` and `<PAYLOAD/>` in a single regex pass with a unified substitution map. Replacement strings are never re-scanned for tokens.
- [ ] `<PAYLOAD/>` token regex follows the same strict rules as `<PREFLIGHT/>`: uppercase only, optional whitespace before `/>`, no attributes.
- [ ] All occurrences of `<PAYLOAD/>` in the body are substituted.
- [ ] Payload content is read from the dispatch-written payload file, capped at 1 MB. Oversize payload produces a run-error before agent spawn (history `status: 'payload-error'` with appropriate `error_reason`).
- [ ] Leading and trailing whitespace are trimmed from payload before substitution; internal whitespace preserved.
- [ ] Parse-time validation: body contains `<PAYLOAD/>` on a task whose `on` is not `event` → `tm validate` rejects the file with a clear error.
- [ ] `<PAYLOAD/>` on an event task dispatched without a payload substitutes to the empty string. No error.
- [ ] The runner no longer appends `'\n---\n' + payload` to the prompt under any circumstances. Confirmed by regression test asserting that an event task with no `<PAYLOAD/>` token receives the markdown body unchanged when dispatched with payload.
- [ ] When `<PAYLOAD/>` substitution produces non-empty content, the resolved prompt is persisted as `<ts>.prompt.txt` (same trigger as preflight injection).
- [ ] If a payload contains the literal text `<PREFLIGHT/>`, it is not re-substituted with preflight stdout, and vice versa (single-pass guarantee).

## User stories addressed

Reference by number from parent PRD tm-ron0:

- 14, 15, 16, 17, 20

