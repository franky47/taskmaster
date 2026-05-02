---
# tm-umba
title: tm validate surfaces invalid task filenames from recursive walk
status: completed
type: feature
priority: normal
created_at: 2026-05-02T18:13:03Z
updated_at: 2026-05-02T19:01:30Z
parent: tm-rrzs
blocked_by:
    - tm-gegb
---

## What to build

Wire `tm validate` to the recursive walker introduced in tm-gegb so it
reports both invalid task filenames and parse/frontmatter failures. A flat
file at the tasks root whose basename contains an underscore (e.g.
`tasks/foo_bar.md`) is treated as invalid because it would break the
bijection between canonical names and source paths.

See parent PRD `tm-rrzs` for the bijection rationale.

## Acceptance criteria

- [x] `tm validate` consumes the walker and surfaces invalid-filename
      warnings (uppercase, spaces, dots, underscores in a segment, leading
      or trailing dashes, empty segments).
- [x] Flat `tasks/foo_bar.md` is reported as invalid.
- [x] Existing parse/frontmatter failure surfacing in `tm validate` is
      preserved and works against nested files.
- [x] `validate.test.ts` covers a nested fixture, a flat-underscore file,
      and at least one invalid-segment case at depth.

## User stories addressed

- User story 8
- User story 13

## Summary of Changes

- Rewrote `src/validate/validate.ts` to consume `walkTasksDir` instead of a flat readdir. Walker warnings (`TaskNameError`) become invalid `ValidationResult` entries; valid entries flow through `parseTaskFile` as before.
- Valid entries report `name = canonical` (underscore form, machine-readable contract). Invalid-by-walker entries report `name = relativePath without .md` (slash form) because there is no canonical for a name that failed segment validation.
- Sort key normalizes `/` to `_` so slash-form and underscore-form entries order by directory position consistently regardless of which surface produced them.
- Dropped the unreachable `TaskFileNameError` special-case from `extractErrors` — the walker enforces `[a-z0-9-]+` per segment before `parseTaskFile` runs, so the parser-level filename check is never triggered via `validate`.
- Added five tests: nested valid task with canonical name, flat-underscore rejection, invalid-segment at depth, nested broken frontmatter, and a mixed-shape sort-order test.

## Notes for downstream slices

- `tm validate` text mode in `main.ts` still prints `name` verbatim. The display-form rewrite (slash form for human-readable surfaces) is scoped to **tm-gals**.
- For machine-readable consumers: `name` may be slash-form when an entry failed walker validation. Downstream tooling cannot assume `name` is always canonical-shaped.
