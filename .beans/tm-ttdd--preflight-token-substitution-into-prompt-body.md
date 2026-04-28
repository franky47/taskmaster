---
# tm-ttdd
title: <PREFLIGHT/> token substitution into prompt body
status: completed
type: feature
priority: normal
created_at: 2026-04-28T14:43:07Z
updated_at: 2026-04-28T15:21:32Z
parent: tm-ron0
blocked_by:
    - tm-v1sy
---

## What to build

Wire preflight stdout into the prompt body via the `<PREFLIGHT/>` token. Introduces a shared substitution module — a deep, single-purpose component that owns token regex, single-pass replacement, per-token 1 MB cap, UTF-8 validation, and leading/trailing whitespace trimming. This slice uses the module for `<PREFLIGHT/>` only; tm-nzcg extends it to handle `<PAYLOAD/>` next.

Refer to parent PRD tm-ron0 for: "Solution" (token semantics), "Implementation Decisions → Frontmatter" (body-token validation), "Implementation Decisions → Runner ordering" (step 5), "Implementation Decisions → Modules" (shared substitution module), "Implementation Decisions → History schema additions" (`<ts>.prompt.txt`).

## Acceptance criteria

- [x] Shared substitution module exposes a single API that takes a body string and a substitution map (token name → replacement string), runs a single regex pass, and returns the resolved body. No recursive substitution: replacement strings containing token literals are not re-scanned.
- [x] Token regex is strict: uppercase only, optional whitespace before `/>`, no attributes. `<PREFLIGHT/>` and `<PREFLIGHT />` match; `<preflight/>`, `<PREFLIGHT>`, `<PREFLIGHT></PREFLIGHT>` do not.
- [x] All occurrences of `<PREFLIGHT/>` in the body are substituted.
- [x] Preflight stdout is captured as UTF-8; invalid UTF-8 produces `preflight-error` with `error_reason: 'invalid-utf8'`.
- [x] Stdout > 1 MB produces `preflight-error` with `error_reason: 'oversize-stdout'`. The agent does not run.
- [x] Leading and trailing whitespace are trimmed from preflight stdout before substitution; internal whitespace is preserved exactly.
- [x] Parse-time validation: body contains `<PREFLIGHT/>` but no `preflight` field declared → `tm validate` reports an error with the offending file. Caught at the same layer that today rejects unknown frontmatter fields.
- [x] `preflight` declared but no token in body is allowed (gate-only / side-effect-only use); no warning.
- [x] When substitution actually replaces at least one token with non-empty content, the resolved prompt is persisted as `<ts>.prompt.txt` next to `<ts>.meta.json`.
- [x] When the body has no token (or substitution produced empty content), `<ts>.prompt.txt` is not written.
- [x] Token inside fenced code blocks or HTML comments is still substituted (no markdown-aware logic).

## User stories addressed

Reference by number from parent PRD tm-ron0:

- 10, 11, 12, 13, 17, 18, 19, 29, 36

## Summary of Changes

New `src/lib/prompt-template/` module owns token regex, single-pass non-recursive substitution with leading/trailing trim and non-empty counting (`substitute.ts`), plus UTF-8 + 1 MB cap stdout decoding (`preflight-output.ts`). Token-name set is currently `['PREFLIGHT']`; `<PAYLOAD/>` will join in the next slice (tm-nzcg) with no shape change to the substitution API.

Frontmatter parser (`src/lib/task/frontmatter.ts`) gains a body-token rule: `<PREFLIGHT/>` in the prompt body without a `preflight` field is rejected as a `FrontmatterValidationError` keyed on `preflight`, surfacing through `tm validate`.

Runner (`src/run/run.ts`) substitutes after preflight succeeds. `SpawnPreflightResult` gains `stdout_oversize?` / `stdout_invalid_utf8?` flags (default impl populates via `decodePreflightStdout`). `error_reason` ladder: `timed_out` → `signaled` → `stdout_oversize` → `stdout_invalid_utf8` → `nonzero`. Stdout-shape failures bypass the agent regardless of `exit_code`.

Byte counts are now plumbed through `SpawnPreflightResult.stdout_bytes` / `stderr_bytes` so meta stays accurate when decoded stdout is empty (oversize / invalid-utf8 paths). `main.ts` reads these directly instead of recomputing from the possibly-emptied string.

`<ts>.prompt.txt` is persisted only when substitution produced at least one non-empty replacement AND a timestamp is provided. History schema (`PREFLIGHT_ERROR_REASONS`) extended with `'invalid-utf8'` and `'oversize-stdout'`.
