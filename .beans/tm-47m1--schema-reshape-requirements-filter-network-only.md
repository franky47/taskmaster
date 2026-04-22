---
# tm-47m1
title: Schema reshape + requirements filter (network-only)
status: completed
type: feature
priority: normal
created_at: 2026-04-22T13:19:28Z
updated_at: 2026-04-22T13:48:17Z
parent: tm-rby1
---

## What to build

End-to-end reshape of the task configuration model and the scheduler's requirement-filtering pipeline, preserving today's connectivity-gating behavior under the new shape. The `enabled` field becomes a plain boolean. A new `requires` field is introduced with exactly one valid token at this stage: `'network'`. A new deep module encapsulates the requirements filter (probe registry, probe-once-per-tick, parallel probing, skip classification). Tick and dispatch are rewired to use this filter. The log event for skipped-for-unmet-requirement is the new structured shape. README updates accompany the change.

See parent PRD `tm-rby1` for full context, including the rationale for orthogonal `enabled` / `requires` axes and the rejected alternatives.

Docs ride with this slice (README frontmatter table, Connectivity / Runtime Requirements section, examples).

## Acceptance criteria

- [x] `enabled` is parsed as boolean; default `true`; the old three-way union is removed
- [x] `requires` is parsed as an array of `'network'` literals; default `['network']`; explicit `[]` is valid; unknown tokens are rejected at parse time with a clear error; entries are deduplicated
- [x] A standalone requirements-filter module exists with the stable `(tasks, probes) -> { ready, skipped: [{ task, unmet }] }` interface
- [x] Filter probes each referenced requirement at most once per call, only when referenced, in parallel
- [x] Tick and dispatch both use this filter; their options drop `isOnline?` and gain a `probes?` override
- [x] Ordering of gates preserved: disabled short-circuit → cron/event match → history dedup → requirements → spawn
- [x] `tm run <name>` bypasses both `enabled` and `requires`
- [x] Skipped tasks are logged as `{ event: 'skipped', task, reason: 'requirement-unmet', requirement: [...] }`; the old `reason: 'offline'` literal is retired
- [x] README reflects the new fields, with an updated Runtime Requirements section listing `network` as the only token
- [x] All existing offline-skip tests pass, rewritten against the new `probes` test surface
- [x] Deep-module tests cover: empty input, no-req tasks, single-req pass/fail, probe-once count, no-probe-when-unused, parallel execution, skip reporting shape

## User stories addressed

Reference by number from parent PRD `tm-rby1`:

- User story 3 (existing default behavior preserved)
- User story 4 (explicit `[]` means always run)
- User story 5 (`enabled: false` still pauses)
- User story 6 (unknown tokens fail validation)
- User story 9 (`tm run` bypasses requirements)
- User story 10 (structured skip log event) — partial, token-agnostic part only
- User story 16 (parallel probes)
- User story 17 (probe once per requirement per tick)
- User story 18 (no probe when unused)
- User story 20 (registry extension point)
- User story 21 (single `probes` override surface)
- User story 22 (Zod parse-time validation)
- User story 23 (dedupe on parse)
- User story 24 (documented token list) — partial, documents `network` only

## Summary of Changes

- Replaced the `enabled: false | 'when-online' | 'always'` union with a plain boolean (`enabled`) and a new `requires: Requirement[]` field. Default `requires: ['network']` preserves today's behavior; explicit `[]` opts out of all runtime requirements.
- Added a new deep module `src/lib/requirements/` with `filterByRequirements(tasks, probes) → { ready, skipped: [{ task, unmet }] }`. The filter probes each referenced requirement at most once per call, only when a ready task references it, and runs probes in parallel via `Promise.all`. Unit tests cover empty input, no-req tasks, single-req pass/fail, probe-once count, no-probe-when-unused, parallel execution, and the skip-report shape.
- A small probe registry (`defaultProbes`) maps `network` to the existing DNS-based `isOnline`. Extension for future tokens is a two-step change: extend the token union and register a probe.
- Rewired `tick` and `dispatch` to use the filter. Their options dropped `isOnline?` and gained `probes?: Probes`. Gate ordering preserved: disabled → cron/event match → history dedup → requirements → spawn.
- Log event `{ event: 'skipped', reason: 'offline' }` retired; replaced with `{ event: 'skipped', reason: 'requirement-unmet', requirement: Requirement[] }`. Logger schema, `readLog`, and all call sites updated accordingly.
- `tm doctor`'s offline-skips diagnostic reinterpreted against the new shape: it counts skips whose `requirement` list includes `'network'`. Hint now suggests `requires: []` instead of `enabled: 'always'`. `checkTaskNeverRan` updated to take a boolean.
- `tm run <name>` bypasses both `enabled` and `requires` unchanged (it never consulted either).
- README updated: frontmatter table gains the `requires` row; the former "Connectivity" section is now "Runtime Requirements", with a token table, default/empty/unknown-token/dedup semantics, and a note about `tm run` bypass.
