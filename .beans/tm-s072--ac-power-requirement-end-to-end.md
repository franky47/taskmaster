---
# tm-s072
title: ac-power requirement end-to-end
status: completed
type: feature
priority: normal
created_at: 2026-04-22T13:19:46Z
updated_at: 2026-04-22T14:02:57Z
parent: tm-rby1
blocked_by:
    - tm-47m1
---

## What to build

Add `'ac-power'` as a requirement token, end-to-end. Implement the macOS and Linux AC-power probe with fail-open semantics, extend the schema's requirement union, register the probe in the filter's registry, and verify the behavior through tick and dispatch using the `probes` override. Update the README's Runtime Requirements section to list the new token with its platform coverage.

See parent PRD `tm-rby1` for probe mechanics (pmset, `/sys/class/power_supply`), fail-open rationale, and desktop/VM handling.

Docs ride with this slice.

## Acceptance criteria

- [x] `'ac-power'` is accepted as a `requires` token; unknown tokens still rejected
- [x] macOS probe: parses `pmset -g ps` correctly for AC Power, Battery Power, and unexpected output (fail-open)
- [x] Linux probe: reads `/sys/class/power_supply/*/online` for type=Mains sources; no Mains source returns true; unreadable/errored state returns true (fail-open)
- [x] Probe is registered in the filter's probe map for production code
- [x] Tick and dispatch tests confirm `requires: ['ac-power']` tasks are skipped when the probe returns false and run when it returns true, via the `probes` override
- [x] Tasks with `requires: ['network', 'ac-power']` are skipped if either probe fails; skip event lists all unmet requirements
- [x] README's Runtime Requirements section documents the `ac-power` token, platform detection mechanism, and fail-open behavior
- [x] An example task with `requires: ['ac-power']` is added to the README examples section
- [x] Probe has colocated fixture-based tests per platform

## User stories addressed

Reference by number from parent PRD `tm-rby1`:

- User story 1 (mark power-hungry tasks with ac-power requirement)
- User story 2 (combine requirements)
- User story 7 (no-battery machines run normally)
- User story 8 (fail-open probe)
- User story 12 (cheap probe, only when needed) — validated by slice 1 mechanics now exercised by a second token
- User story 13 (macOS pmset)
- User story 14 (Linux /sys/class/power_supply)
- User story 15 (event tasks honor requires) — applies identically
- User story 19 (missed runs visible in logs) — ac-power skips surface in log stream
- User story 24 (documented token list) — completes `ac-power` documentation

## Summary of Changes

- New `src/lib/requirements/ac-power.ts` exposing `isOnAcPower(deps)`. Platform dispatch: darwin shells out to `pmset -g ps` and treats anything other than an explicit `Battery Power` line as AC (so unexpected output fails open); linux walks `/sys/class/power_supply/*`, filters by `type=Mains`, and returns true if any Mains source has `online=1` — no Mains source at all (desktops/VMs) also returns true; all other platforms return true. Every error path is fail-open.
- DI surface uses small opt-in hooks (`execPmset`, `listPowerSupplies`, `readPowerSupplyFile`) so the per-platform tests drive each branch without touching subprocesses or fs. Mirrors the `isOnline` `ResolverFactory` style.
- Registered in `defaultProbes` under the `ac-power` key; `REQUIREMENT_TOKENS` extended to `['network', 'ac-power']`. The existing Zod parser, dedup logic, unknown-token rejection, and requirements filter absorb the new token with no code changes.
- Tests: colocated `ac-power.test.ts` covering darwin (AC / Battery / unexpected / exec throw), linux (Mains online=1, all Mains online=0, no Mains, readdir error, type error, Mains online error, mixed with partial error), and win32 fail-open. Added frontmatter tests for `['ac-power']` and `['network', 'ac-power']`. Added tick tests for `requires: ['ac-power']` under battery and AC, plus a combined-requires test asserting the skip log lists both unmet tokens. Added dispatch tests for the same two shapes on an event task.
- README: new row in the Runtime Requirements token table documenting detection mechanism and fail-open behavior; new Power-Aware example task with `requires: ['ac-power']`.
- `AcPowerDeps` kept module-private (knip enforces export-consumer parity).
