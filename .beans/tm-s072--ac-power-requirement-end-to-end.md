---
# tm-s072
title: ac-power requirement end-to-end
status: todo
type: feature
priority: normal
created_at: 2026-04-22T13:19:46Z
updated_at: 2026-04-22T13:19:46Z
parent: tm-rby1
blocked_by:
    - tm-47m1
---

## What to build

Add `'ac-power'` as a requirement token, end-to-end. Implement the macOS and Linux AC-power probe with fail-open semantics, extend the schema's requirement union, register the probe in the filter's registry, and verify the behavior through tick and dispatch using the `probes` override. Update the README's Runtime Requirements section to list the new token with its platform coverage.

See parent PRD `tm-rby1` for probe mechanics (pmset, `/sys/class/power_supply`), fail-open rationale, and desktop/VM handling.

Docs ride with this slice.

## Acceptance criteria

- [ ] `'ac-power'` is accepted as a `requires` token; unknown tokens still rejected
- [ ] macOS probe: parses `pmset -g ps` correctly for AC Power, Battery Power, and unexpected output (fail-open)
- [ ] Linux probe: reads `/sys/class/power_supply/*/online` for type=Mains sources; no Mains source returns true; unreadable/errored state returns true (fail-open)
- [ ] Probe is registered in the filter's probe map for production code
- [ ] Tick and dispatch tests confirm `requires: ['ac-power']` tasks are skipped when the probe returns false and run when it returns true, via the `probes` override
- [ ] Tasks with `requires: ['network', 'ac-power']` are skipped if either probe fails; skip event lists all unmet requirements
- [ ] README's Runtime Requirements section documents the `ac-power` token, platform detection mechanism, and fail-open behavior
- [ ] An example task with `requires: ['ac-power']` is added to the README examples section
- [ ] Probe has colocated fixture-based tests per platform

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
