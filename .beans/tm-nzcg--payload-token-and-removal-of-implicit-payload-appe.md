---
# tm-nzcg
title: <PAYLOAD/> token and removal of implicit payload append
status: completed
type: feature
priority: normal
created_at: 2026-04-28T14:43:10Z
updated_at: 2026-04-28T15:48:09Z
parent: tm-ron0
blocked_by:
    - tm-ttdd
---

## What to build

Add `<PAYLOAD/>` as a second substitution token, sharing the module introduced in tm-ttdd, and **remove** the implicit `task.prompt + '\n---\n' + payload` append from the runner. After this slice, the only path a dispatch payload takes into the prompt is via `<PAYLOAD/>` substitution — there is exactly one mechanism for both data sources.

Refer to parent PRD tm-ron0 for: "Solution" (`<PAYLOAD/>` rules), "Implementation Decisions → Frontmatter" (token-on-non-event validation), "Implementation Decisions → Removed behavior", "Implementation Decisions → Modules" (single shared module), "Further Notes" (single-mechanism rationale).

## Acceptance criteria

- [x] Shared substitution module accepts both `<PREFLIGHT/>` and `<PAYLOAD/>` in a single regex pass with a unified substitution map. Replacement strings are never re-scanned for tokens.
- [x] `<PAYLOAD/>` token regex follows the same strict rules as `<PREFLIGHT/>`: uppercase only, optional whitespace before `/>`, no attributes.
- [x] All occurrences of `<PAYLOAD/>` in the body are substituted.
- [x] Payload content is read from the dispatch-written payload file, capped at 1 MB. Oversize payload produces a run-error before agent spawn (history `status: 'payload-error'` with appropriate `error_reason`).
- [x] Leading and trailing whitespace are trimmed from payload before substitution; internal whitespace preserved.
- [x] Parse-time validation: body contains `<PAYLOAD/>` on a task whose `on` is not `event` → `tm validate` rejects the file with a clear error.
- [x] `<PAYLOAD/>` on an event task dispatched without a payload substitutes to the empty string. No error.
- [x] The runner no longer appends `'\n---\n' + payload` to the prompt under any circumstances. Confirmed by regression test asserting that an event task with no `<PAYLOAD/>` token receives the markdown body unchanged when dispatched with payload.
- [x] When `<PAYLOAD/>` substitution produces non-empty content, the resolved prompt is persisted as `<ts>.prompt.txt` (same trigger as preflight injection).
- [x] If a payload contains the literal text `<PREFLIGHT/>`, it is not re-substituted with preflight stdout, and vice versa (single-pass guarantee).

## User stories addressed

Reference by number from parent PRD tm-ron0:

- 14, 15, 16, 17, 20

## Summary of Changes

`src/lib/prompt-template/`: extended `TOKEN_NAMES` to `['PREFLIGHT', 'PAYLOAD']`. Renamed `preflight-output.ts` → `bounded-text.ts` and `decodePreflightStdout` → `decodeBoundedUtf8(buf, maxBytes)` so the same UTF-8 + cap helper covers both preflight stdout and payload bytes. Failure reasons are now generic `'oversize' | 'invalid-utf8'`; the runner translates `'oversize'` to the variant-specific `'oversize-stdout'` (preflight) or `'oversize'` (payload) when populating `error_reason`.

`src/lib/task/frontmatter.ts`: parse-time validation rejects `<PAYLOAD/>` in the body when `on` is not `event`. Caught at the same layer as the `<PREFLIGHT/>`-without-field rule.

`src/run/run.ts`: removed the `task.prompt + '\n---\n' + payload` append entirely. `ExecuteOptions.payload` is now `Buffer` (raw bytes). Payload validation runs before preflight so an oversize/invalid-UTF-8 payload short-circuits without firing preflight side effects. New `kind: 'payload-error'` discriminated variant on `RunResult` with `payload: { bytes, error_reason }`. Substitution binds `PAYLOAD` to `''` on event tasks even when no payload was supplied (so the literal token disappears rather than persisting in the resolved prompt). Both tokens are passed through `substituteTokens` in a single pass — replacement strings are never re-scanned, so a payload containing the literal `<PREFLIGHT/>` is not re-substituted, and vice versa.

`src/history/schema.ts`: new `payloadErrorMeta` variant (`status: 'payload-error'`, `payload: { bytes, error_reason }`). `PAYLOAD_ERROR_REASONS = ['oversize', 'invalid-utf8']` exported. `HistoryMetaInput` extended.

`src/history/query.ts` + `src/lib/logger.ts` + `src/main.ts`: the new `payload-error` status flows through display entries, log entries (`reason: 'preflight-error' | 'payload-error'`), and the CLI's run handler (writes meta, logs, exits 0 with optional JSON payload).

The implicit `\n---\n` append is fully removed: a regression test in `run.test.ts` asserts that an event task without `<PAYLOAD/>` in its body receives the markdown body unchanged when dispatched with payload.
