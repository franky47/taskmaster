---
# tm-r0q3
title: 'Heartbeat: first-class module owning format, I/O, and status'
status: completed
type: task
priority: normal
created_at: 2026-04-24T12:32:40Z
updated_at: 2026-04-24T13:29:01Z
---

## Problem

The scheduler heartbeat is a single-field file that several modules touch directly, each with their own parsing and I/O logic:

- writer in `src/tick/tick.ts` (~line 187): `await fs.writeFile(heartbeatPath, now.toISOString())`
- reader in `src/doctor/doctor.ts` (`defaultReadHeartbeat` ~line 57): `new Date(content.trim())` with inline NaN check
- recency derivation in `src/doctor/checks.ts` builds relative-time strings from the Date

There is no type, no schema, and no validation. Every caller duplicates the path-join (`path.join(cfgDir, 'heartbeat')`), the I/O error handling, and the parse-or-null logic. The format is implicit — whatever `Date.prototype.toISOString()` happens to produce — with no schema guarantee against a truncated or corrupted file slipping through.

Integration risk sits in the seams:

- writer and reader could drift (e.g., if tick added a prefix for a future version, doctor would silently read `null`)
- doctor's "no heartbeat detected" path is hard to distinguish from "heartbeat unreadable"
- tests for tick and doctor both have to construct the format from scratch; there is no shared fixture or builder

The heartbeat itself is a natural deep-module candidate: the public concept is tiny ("when did the scheduler last tick?"), the implementation currently sprawls across three files.

## Proposed Interface

Create `src/tick/heartbeat.ts` as the single owner of the heartbeat file:

```ts
export const heartbeatSchema = z.iso.datetime().transform((s) => new Date(s))

export type HeartbeatPath = string // or a deps-passed path

export async function writeHeartbeat(path: string, now: Date): Promise<void | Error>
export async function readHeartbeat(path: string): Promise<Date | null>

// derived view used by doctor
export type HeartbeatStatus =
  | { ok: true; at: Date; ageMs: number }
  | { ok: false; reason: 'missing' | 'unreadable' | 'malformed' }

export async function heartbeatStatus(path: string, now?: Date): Promise<HeartbeatStatus>
```

Usage:

```ts
// tick.ts
const err = await writeHeartbeat(heartbeatPath, now)
if (err) log({ event: 'error', task: '(heartbeat)', error: err }, logPath)

// doctor.ts
const status = await heartbeatStatus(heartbeatPath, now)
if (!status.ok) { ... }
```

Complexity hidden internally:

- file path convention (fixed under the config dir)
- the ISO-UTC format contract and Zod validation
- the three failure modes (missing file, read error, parse error) collapsed into a typed discriminated union
- age calculation vs `now`

## Dependency Strategy

**Local-substitutable.** Dependency is the local filesystem. Tests run against a real temp directory (`fs.mkdtempSync(os.tmpdir())`) — already the project pattern. No mock FS required.

## Testing Strategy

New boundary tests at `src/tick/heartbeat.test.ts`:

- `writeHeartbeat` → `readHeartbeat` round-trip returns the same instant (modulo ms precision if any)
- `readHeartbeat` returns `null` for: missing file, empty file, whitespace-only file, malformed ISO
- `heartbeatStatus` returns `{ ok: false, reason: 'missing' }` when file absent
- `heartbeatStatus` returns `{ ok: false, reason: 'malformed' }` when content fails the Zod schema
- `heartbeatStatus` returns `{ ok: true, ageMs }` with correct age

Old tests to delete/move:

- heartbeat-format assertions currently sitting in `tick.test.ts` and `doctor.test.ts` collapse into the module's own tests
- tests that wrote raw heartbeat files via `fs.writeFile(..., '2026-...')` switch to calling `writeHeartbeat`
- the inline `defaultReadHeartbeat` function in `doctor.ts` and its implicit tests go away

Test environment: bun test + temp directory. Align with existing tick/doctor test setup.

## Implementation Recommendations

The module should own:

- the filename/path convention (expose via constant or accept as param — do not spread `path.join(cfgDir, 'heartbeat')` across callers)
- the format (ISO UTC via Zod schema — reuse the observability-time module once RFC 3 lands, else define locally)
- all I/O error handling
- the derived `ageMs` / `reason` view for diagnostics

The module should hide:

- `node:fs/promises` usage
- parse/NaN handling
- path-joining details

The module should expose exactly two operations (`write`, `status`) plus an optional raw `read` if any caller needs just the Date. Keep the surface area minimal — if a caller wants more, push the logic into the module instead.

Migration plan:

1. Add `src/tick/heartbeat.ts` with `writeHeartbeat` + `heartbeatStatus`.
2. Replace the write site in `tick.ts` with `writeHeartbeat`.
3. Replace `defaultReadHeartbeat` in `doctor.ts` with `heartbeatStatus`; thread the typed result into doctor deps and checks.
4. Update `checks.ts` to consume `HeartbeatStatus` instead of `Date | null`, removing its own relative-age math if it can reuse what the module derives.
5. Delete the duplicated path-join / parse logic.

Dependency note: landing RFC 3 (observability-time consolidation) first would let this module reuse a shared ISO schema. This bean is sequenceable either way — local schema is fine if RFC 3 slips.

## Summary of Changes

- Added `src/tick/heartbeat.ts` with `writeHeartbeat(path, now): Promise<void | Error>` and `readHeartbeat(path): Promise<Date | null>`. Validation via a private Zod `z.iso.datetime()` schema — export is internal per project knip convention.
- Migrated `src/tick/tick.ts` to call `writeHeartbeat`, removing the inline `fs.writeFile` + try/catch and the `node:fs/promises` import at the module level.
- Migrated `src/doctor/doctor.ts` to call `readHeartbeat`, collapsing `defaultReadHeartbeat` to a one-line path-join delegate and removing the `node:fs/promises` import.
- Colocated tests in `src/tick/heartbeat.test.ts` cover: round-trip, missing file, empty/whitespace content, malformed ISO (date-only, missing Z, Unix ts, garbage), write-side I/O failure.

## Deferred from the RFC

- `heartbeatStatus` discriminated-union convenience (`{ ok, at, ageMs } | { ok: false, reason }`): not shipped — no caller needs it yet. Age + missing checks still live in `src/doctor/checks.ts` via `checkHeartbeat`, which still takes `Date | null`. Adding the typed status view can follow when a second consumer appears.
- Observability-time schema reuse (tm-ba5i): not wired — local schema is fine until that bean lands.
