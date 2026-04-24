---
# tm-4v9m
title: 'Deepen timestamp module: enforce canonical run-ID type'
status: completed
type: task
priority: high
created_at: 2026-04-24T12:32:40Z
updated_at: 2026-04-24T13:21:27Z
---

## Problem

The canonical run-ID format (`YYYY-MM-DDTHH.MM.SSZ`, UTC, dotted) is a load-bearing invariant:

- it is the filesystem join key across `.meta.json`, `.output.txt`, failed-run dir, and running-marker payload
- global history ordering relies on it being fixed-width UTC so `localeCompare` matches chronological order
- marker ↔ log-follow path derivation assumes the exact shape

Today the format is only enforced by the producers happening to behave. `src/history/timestamp.ts` is shallow — three pure helpers (`formatTimestamp`, `manualTimestamp`, `parseTimestampFlag`) — and the shape it produces is treated as opaque `z.string()` everywhere it is persisted:

- `historyMetaSchema.timestamp` in `src/history/schema.ts`
- `RunningMarkerSchema.timestamp` in `src/lib/lock/marker.ts`

Concrete consequences:

- bad data can round-trip through Zod parse (schema cannot reject a malformed marker)
- `status.last_run.timestamp` currently returns `latest.started_at.toISOString()` — a different timestamp family — and nothing at the type level flags that as wrong
- callers construct run IDs in three places (`tick.ts` floor-to-minute, `dispatch.ts` via `manualTimestamp`, `main.ts` via `parseTimestampFlag`) with no central invariant check
- tests hardcode matched pairs of dotted + ISO strings as fixture data because there is no single source of truth to build from

## Proposed Interface

Deepen `src/history/timestamp.ts` from a format helper into the owner of the run-ID type.

Exports:

- `runIdSchema`: a Zod `z.templateLiteral` (or regex-refined string) matching `^\d{4}-\d{2}-\d{2}T\d{2}\.\d{2}\.\d{2}Z$`. Inferred type is a strict string literal union, interoperable with plain `string` per the project's `zod_template_literal` convention.
- `RunId` type: `z.infer<typeof runIdSchema>`.
- Constructors (all return `RunId`, never unvalidated strings):
  - `runIdFromDate(date: Date): RunId` — second precision, UTC
  - `runIdFromMinute(date: Date): RunId` — minute precision for tick slots
  - `runIdNow(): RunId` — `runIdFromDate(new Date())`
  - `parseRunId(raw: string): RunId | TimestampParseError` — accepts dotted form, validates, returns branded literal or error
- `runIdToDate(id: RunId): Date` — inverse, infallible because the type guarantees parseability

Schemas in `src/history/schema.ts` and `src/lib/lock/marker.ts` import `runIdSchema` and compose it into their `timestamp` fields.

Usage example:

```ts
// tick.ts
const slot = runIdFromMinute(now)        // RunId, typed
await runTask({ timestamp: slot, ... })

// dispatch.ts
const wave = runIdNow()

// main.ts --timestamp flag
const parsed = parseRunId(flagValue)
if (parsed instanceof Error) return exitWith(parsed)

// status.ts (the bug fix falls out of the type error)
return { last_run: { timestamp: latest.timestamp } }
```

Complexity hidden internally:

- dotted ↔ colon transform
- milliseconds-truncation contract
- UTC/timezone canonicalization
- format validation (regex/template literal)
- error shape for bad inputs

## Dependency Strategy

**In-process.** Pure value type, no I/O, no external deps beyond Zod. Merge directly; no adapters needed.

## Testing Strategy

New boundary tests at `timestamp.test.ts`:

- every constructor produces a string accepted by `runIdSchema`
- `parseRunId` rejects: empty, ISO with colons, missing Z, non-UTC offset, sub-second precision, wrong separators
- `runIdFromDate` and `runIdToDate` round-trip modulo the ms-truncation contract
- `runIdFromMinute` always zeros the seconds slot
- template-literal inference: a `RunId` is assignable to `string` but a plain `string` is not assignable to `RunId` (use `@ts-expect-error` per `never_weaken_types` memory)

New invariant tests at schema boundaries:

- `historyMetaSchema` rejects a malformed `timestamp` (currently silently accepts any string)
- `RunningMarkerSchema` rejects the same
- writer/reader round-trip preserves the type

Old tests to delete: none outright — existing tests in `timestamp.test.ts` tighten rather than disappear.

The `status.ts` bug (`status.last_run.timestamp` returning `started_at.toISOString()`) surfaces as a type error during migration — that is the intended forcing function and fixing it is part of this change, not a follow-up.

Test environment: Bun test runner; must run `tsc --noEmit` after (per `always_tsc_noEmit` memory) — template literals surface type regressions only at full compile.

## Implementation Recommendations

The module should own:

- the canonical format definition (regex / template-literal pattern)
- every transition between `Date` and run-ID form
- all parse/validate error surfaces

The module should hide:

- the dotted-vs-colon representation
- the precision-truncation contract
- the UTC canonicalization detail

The module should expose a **typed primitive plus a Zod schema**, nothing more. Consumers (schemas, filename builders, CLI flag parsers) compose the schema or call a constructor — they never build or inspect the string directly.

Migration plan:

1. Add `runIdSchema` + `RunId` inferred type + constructors.
2. Update `historyMetaSchema` and `RunningMarkerSchema` to use `runIdSchema`.
3. Convert callers (`tick.ts`, `dispatch.ts`, `run.ts`, `main.ts`, `status.ts`, `history/record.ts`, `history/query.ts`) to use `RunId` in their local types. TypeScript walks the graph.
4. Fix the `status.ts` bug the refactor surfaces: swap `latest.started_at.toISOString()` for `latest.timestamp`.
5. Remove redundant legacy exports if nothing outside the module still imports them (per `no_dead_code` memory).

Adjacent follow-ups (do not bundle into this RFC):

- second-precision collision risk in `manualTimestamp` / dispatch — separate design question, format change with filesystem blast radius.
- marker-clock vs execution-clock divergence — arguably a docs fix, not a refactor.

## Summary of Changes

- Added `runIdSchema` (Zod regex-validated, `.brand('RunId')`) and `RunId` type in `src/history/timestamp.ts`. Regex enforces `^\d{4}-\d{2}-\d{2}T\d{2}\.\d{2}\.\d{2}Z$`.
- `formatTimestamp` now parses its output through `runIdSchema`, returning `RunId`. `manualTimestamp` follows.
- `historyMetaSchema.timestamp` and `RunningMarkerSchema.timestamp` replaced `z.string()` with `runIdSchema`. Schemas now reject malformed timestamps at parse time (previously silently accepted any string).
- Type narrowing walked through callers: `src/main.ts`, `src/run/run.ts` (`ExecuteOptions.timestamp`), `src/dispatch/dispatch.ts` (`spawnRun` signature), `src/tick/tick.ts` (`spawnRun` signature), `src/status/status.ts` (`LastRun.timestamp`, `Running.timestamp`).
- **Fixed `status.last_run.timestamp` bug**: the type error forced the change from `latest.started_at.toISOString()` to `latest.timestamp`. `tm status` now surfaces the canonical run ID matching `tm history` output and filesystem artifacts.
- Test fixtures across 9 files updated to build valid `RunId` via `runIdSchema.parse(...)` (inline or via local `rid` helper). Status tests that previously asserted the buggy ISO output now assert the canonical dotted run ID.
- `runIdSchema` and `RunId` exported from `src/history/index.ts` for cross-module use.

Red/green TDD: red-first tests for schema acceptance/rejection plus schema integration in `historyMetaSchema` and `RunningMarkerSchema`. Full check pipeline clean: fmt, lint, tsc, 559 tests, knip, deprecated scan.
