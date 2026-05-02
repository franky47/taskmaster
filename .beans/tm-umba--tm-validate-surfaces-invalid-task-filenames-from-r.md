---
# tm-umba
title: tm validate surfaces invalid task filenames from recursive walk
status: todo
type: feature
created_at: 2026-05-02T18:13:03Z
updated_at: 2026-05-02T18:13:03Z
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

- [ ] `tm validate` consumes the walker and surfaces invalid-filename
      warnings (uppercase, spaces, dots, underscores in a segment, leading
      or trailing dashes, empty segments).
- [ ] Flat `tasks/foo_bar.md` is reported as invalid.
- [ ] Existing parse/frontmatter failure surfacing in `tm validate` is
      preserved and works against nested files.
- [ ] `validate.test.ts` covers a nested fixture, a flat-underscore file,
      and at least one invalid-segment case at depth.

## User stories addressed

- User story 8
- User story 13
