---
# tm-ttdd
title: <PREFLIGHT/> token substitution into prompt body
status: todo
type: feature
priority: normal
created_at: 2026-04-28T14:43:07Z
updated_at: 2026-04-28T14:43:07Z
parent: tm-ron0
blocked_by:
    - tm-v1sy
---

## What to build

Wire preflight stdout into the prompt body via the `<PREFLIGHT/>` token. Introduces a shared substitution module — a deep, single-purpose component that owns token regex, single-pass replacement, per-token 1 MB cap, UTF-8 validation, and leading/trailing whitespace trimming. This slice uses the module for `<PREFLIGHT/>` only; tm-nzcg extends it to handle `<PAYLOAD/>` next.

Refer to parent PRD tm-ron0 for: "Solution" (token semantics), "Implementation Decisions → Frontmatter" (body-token validation), "Implementation Decisions → Runner ordering" (step 5), "Implementation Decisions → Modules" (shared substitution module), "Implementation Decisions → History schema additions" (`<ts>.prompt.txt`).

## Acceptance criteria

- [ ] Shared substitution module exposes a single API that takes a body string and a substitution map (token name → replacement string), runs a single regex pass, and returns the resolved body. No recursive substitution: replacement strings containing token literals are not re-scanned.
- [ ] Token regex is strict: uppercase only, optional whitespace before `/>`, no attributes. `<PREFLIGHT/>` and `<PREFLIGHT />` match; `<preflight/>`, `<PREFLIGHT>`, `<PREFLIGHT></PREFLIGHT>` do not.
- [ ] All occurrences of `<PREFLIGHT/>` in the body are substituted.
- [ ] Preflight stdout is captured as UTF-8; invalid UTF-8 produces `preflight-error` with `error_reason: 'invalid-utf8'`.
- [ ] Stdout > 1 MB produces `preflight-error` with `error_reason: 'oversize-stdout'`. The agent does not run.
- [ ] Leading and trailing whitespace are trimmed from preflight stdout before substitution; internal whitespace is preserved exactly.
- [ ] Parse-time validation: body contains `<PREFLIGHT/>` but no `preflight` field declared → `tm validate` reports an error with the offending file. Caught at the same layer that today rejects unknown frontmatter fields.
- [ ] `preflight` declared but no token in body is allowed (gate-only / side-effect-only use); no warning.
- [ ] When substitution actually replaces at least one token with non-empty content, the resolved prompt is persisted as `<ts>.prompt.txt` next to `<ts>.meta.json`.
- [ ] When the body has no token (or substitution produced empty content), `<ts>.prompt.txt` is not written.
- [ ] Token inside fenced code blocks or HTML comments is still substituted (no markdown-aware logic).

## User stories addressed

Reference by number from parent PRD tm-ron0:

- 10, 11, 12, 13, 17, 18, 19, 29, 36

