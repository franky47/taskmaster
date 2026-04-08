---
# tm-yqrq
title: enabled enum schema + display
status: in-progress
type: task
priority: normal
tags:
    - schema
    - display
created_at: 2026-04-08T10:11:15Z
updated_at: 2026-04-08T10:18:00Z
parent: tm-kgff
---

## What to build

Change the `enabled` frontmatter field from a boolean to a three-value enum and update all display surfaces. This is the foundation slice — the type change propagates through parsing, validation, list, and status.

End-to-end: a user writes `enabled: 'always'` or `enabled: 'when-online'` in a task file, `tm validate` accepts it, `tm list` and `tm status` display the value correctly, and `enabled: true` is rejected.

See parent PRD sections: "enabled field schema change", "Display changes".

## Acceptance criteria

- [ ] Zod schema for `enabled` is `z.union([z.literal(false), z.literal('when-online'), z.literal('always')]).default('when-online')`
- [ ] `enabled: true` is rejected by the schema (no backward compat)
- [ ] Omitting `enabled` defaults to `'when-online'`
- [ ] `tm validate` rejects tasks with `enabled: true` with a clear error
- [ ] `tm list` shows `always` tag for `enabled: 'always'` tasks
- [ ] `tm list` shows `enabled` (no extra tag) for `when-online` tasks
- [ ] `tm list` shows `disabled` for `enabled: false` tasks
- [ ] `tm status` displays the enum value for each task
- [ ] `--json` output includes `enabled` as its string/boolean value in both `tm list` and `tm status`
- [ ] Unit tests for schema parsing (all three values, default, rejection of `true`)
- [ ] Unit tests for list and status display formatting

## User stories addressed

- User story 3: sensible default without configuration
- User story 6: `always` tag in `tm list`
- User story 7: enum value in `tm status`
- User story 9: `enabled: true` rejected by validate
- User story 12: JSON output includes enum value
