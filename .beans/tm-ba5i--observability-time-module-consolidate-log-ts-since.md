---
# tm-ba5i
title: 'Observability-time module: consolidate log ts, --since, relative-time, next_run'
status: completed
type: task
priority: normal
created_at: 2026-04-24T12:32:41Z
updated_at: 2026-04-24T13:37:24Z
---

## Problem

The third timestamp family — observability timestamps (log entry `ts`, heartbeat, `next_run`, doctor `--since`) — is handled ad-hoc everywhere it appears. Unlike the run-ID family (RFC: deepen timestamp module) and the `started_at` / `finished_at` codec family, no module owns it. Each caller reinvents format, parse, compare, and relative-time formatting.

Scattered sites:

- `src/lib/logger.ts` ~line 94: `new Date().toISOString()` inline for log entry `ts`
- `src/lib/logger.ts` ~line 136: `--since` filter uses lexicographic string compare (`parsed.ts >= sinceISO`), which works only because of implicit UTC canonicalization
- `src/doctor/doctor.ts` line 72: default `--since` is `new Date(now.getTime() - SEVEN_DAYS_MS)`, with the 7-day constant repeated in other places
- `src/doctor/checks.ts` ~line 133: `formatRelativeTime()` is buried here despite being a generic helper; uses raw `diffMs / 60_000` math
- `src/status/status.ts` ~line 127: `next_run` computed via CronExpressionParser directly, no wrapper, no consistent format
- `src/tick/tick.ts` ~line 187: heartbeat writer uses `now.toISOString()` inline (will be absorbed by the heartbeat RFC but the format contract belongs here)

Risks:

- lexicographic-compare-as-time-compare is correct only for canonical ISO UTC; any caller using a non-UTC ISO string would silently misbehave
- relative-time formatting exists in one direction only (Date → string); a parse-relative input (e.g., `--since "2 hours ago"`) would need a second implementation
- the "ISO UTC" contract is implicit — nothing rejects a local-tz ISO string from entering the log stream

The module is conceptually small but the logic to do it once and well (parse multiple input shapes, format a duration as relative time, compare safely) is non-trivial and keeps being rewritten.

## Proposed Interface

Create `src/lib/observability-time.ts` as the home for all non-run-ID, non-history timestamps:

```ts
// Format & schema
export const isoUtcSchema = z.iso.datetime({ offset: false })
export type IsoUtc = z.infer<typeof isoUtcSchema>  // branded string literal

export function nowIso(now?: Date): IsoUtc

// Parsing user input for --since-style flags
export type SinceInput = string // "2h", "7d", "2026-04-20", ISO timestamp, ...
export function parseSince(input: SinceInput, now?: Date): Date | ParseError

// Relative-time formatting
export function formatRelative(at: Date, now?: Date): string  // "3 minutes ago"

// Safe compare for log filtering
export function isoBefore(a: IsoUtc, b: IsoUtc): boolean  // or cmp(a, b): -1|0|1
```

Usage:

```ts
// logger.ts
entry.ts = nowIso()
const filtered = entries.filter((e) => !isoBefore(e.ts, sinceIso))

// doctor.ts / checks.ts
const since = parseSince(options.since ?? '7d', now)
report(`last tick ${formatRelative(heartbeat.at, now)}`)

// status.ts
next_run: nextRunDate ? nowIsoFromDate(nextRunDate) : null
```

Complexity hidden internally:

- the "ISO UTC, offset-free, string-sortable" invariant
- relative-time unit choice (seconds/minutes/hours/days) and plural rules
- the set of accepted `--since` shapes and the parse grammar
- the SEVEN_DAYS_MS default

## Dependency Strategy

**In-process.** Pure value helpers. No I/O. No external deps beyond Zod (and optionally a relative-time library if we decide not to hand-roll — evaluate during implementation).

## Testing Strategy

New boundary tests at `src/lib/observability-time.test.ts`:

- `nowIso(date)` always produces a string accepted by `isoUtcSchema`, with no offset
- `parseSince` accepts: `"2h"`, `"7d"`, `"30m"`, absolute ISO, `"YYYY-MM-DD"`; rejects: garbage, negative durations, unknown units
- `formatRelative` across boundaries: just-now, under-a-minute, hours, days; singular vs plural
- `isoBefore` correct under canonical strings; document that non-canonical input is UB (enforced by the schema at module entry)
- property test: `isoBefore(nowIso(a), nowIso(b)) === (a.getTime() < b.getTime())` for second-aligned Dates

Old tests to delete:

- `formatRelativeTime` tests currently in `doctor/checks.test.ts` move here (and broaden)
- ad-hoc log `--since` string-compare tests in `logger.test.ts` simplify once they call `isoBefore` / `parseSince`
- the `7 days` default constant tested against in doctor tests moves with `parseSince` defaults

Test environment: bun test, pure in-memory.

## Implementation Recommendations

The module should own:

- the "ISO UTC, no offset, string-sortable" format contract
- relative-time phrasing (one source of truth, one set of unit rules)
- `--since` input grammar and its default
- the `Date` ↔ observability-string transition

The module should hide:

- parsing edge cases (timezone suffixes, milliseconds vs seconds)
- unit-choice logic for relative formatting
- the lex-sort-works-because-UTC trick

The module should expose: a schema, one formatter, one parser, one comparator, and one "now" constructor. If the interface grows beyond ~6 exports, something is sneaking in that does not belong.

Migration plan:

1. Add `src/lib/observability-time.ts` with the five exports above.
2. Replace `logger.ts` `new Date().toISOString()` with `nowIso()`; tighten the log entry schema's `ts` field to `isoUtcSchema`.
3. Replace `logger.ts` `parsed.ts >= sinceISO` with `!isoBefore(parsed.ts, sinceIso)`.
4. Move `formatRelativeTime` from `doctor/checks.ts` to this module, renaming to `formatRelative`. Delete the original.
5. Replace the `SEVEN_DAYS_MS` constant + `new Date(now.getTime() - SEVEN_DAYS_MS)` in `doctor.ts` with `parseSince('7d', now)` as default.
6. Optional: route `status.ts` `next_run` through `nowIso(nextRunDate)` if consistent format across status output is desired.

Coordinates with adjacent RFCs:

- **Heartbeat RFC**: its Zod schema should import `isoUtcSchema` from here. Land this one first if practical.
- **Run-ID RFC**: orthogonal — that one owns the *dotted* run-ID format; this one owns the *ISO* observability format. Both can land independently.

## Summary of Changes

Added `src/lib/observability-time.ts` with four cohesive primitives:

- `isoUtcSchema` — Zod schema enforcing UTC-only ISO 8601 (offset-less). Becomes the contract for every observability-family timestamp entering/leaving the program.
- `isoNow(now?)` — returns the canonical string; used by `logger.ts` for entry `ts`.
- `formatRelative(from, to)` — moved from `doctor/checks.ts`.
- `parseSinceFlag(value)` — validates CLI `--since` input through `isoUtcSchema`, returns `SinceParseError | Date`. Tightens the previous `new Date(opts.since)` parser in `main.ts` which accepted any input parseable by `Date`.

Callers migrated:
- `src/lib/logger.ts`: `logEntrySchema.ts` fields now use `isoUtcSchema`; serialization uses `isoNow()`.
- `src/doctor/checks.ts`: imports `formatRelative`, local `formatRelativeTime` deleted.
- `src/doctor/checks.test.ts`: `formatRelative` tests moved to the new module's co-located test file.
- `src/main.ts` `tm doctor --since`: uses `parseSinceFlag`, surfaces the typed error message to stderr.

## Deferred (not blocking)

- Heartbeat writer in `tick.ts` still calls `now.toISOString()` inline — absorbing it belongs to **tm-r0q3** (heartbeat module).
- `run.ts` marker `started_at` is the execution-timing family, not observability — out of scope.
- `readLog` compares `since.toISOString()` directly; the sort-on-UTC-string trick is safe because `isoUtcSchema` now guards the entry `ts`, but a future `toIsoUtc(date)` helper could make the invariant more explicit if a second caller appears.
