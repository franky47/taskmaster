---
# tm-47m1
title: Schema reshape + requirements filter (network-only)
status: todo
type: feature
priority: normal
created_at: 2026-04-22T13:19:28Z
updated_at: 2026-04-22T13:19:28Z
parent: tm-rby1
---

## What to build

End-to-end reshape of the task configuration model and the scheduler's requirement-filtering pipeline, preserving today's connectivity-gating behavior under the new shape. The `enabled` field becomes a plain boolean. A new `requires` field is introduced with exactly one valid token at this stage: `'network'`. A new deep module encapsulates the requirements filter (probe registry, probe-once-per-tick, parallel probing, skip classification). Tick and dispatch are rewired to use this filter. The log event for skipped-for-unmet-requirement is the new structured shape. README updates accompany the change.

See parent PRD `tm-rby1` for full context, including the rationale for orthogonal `enabled` / `requires` axes and the rejected alternatives.

Docs ride with this slice (README frontmatter table, Connectivity / Runtime Requirements section, examples).

## Acceptance criteria

- [ ] `enabled` is parsed as boolean; default `true`; the old three-way union is removed
- [ ] `requires` is parsed as an array of `'network'` literals; default `['network']`; explicit `[]` is valid; unknown tokens are rejected at parse time with a clear error; entries are deduplicated
- [ ] A standalone requirements-filter module exists with the stable `(tasks, probes) -> { ready, skipped: [{ task, unmet }] }` interface
- [ ] Filter probes each referenced requirement at most once per call, only when referenced, in parallel
- [ ] Tick and dispatch both use this filter; their options drop `isOnline?` and gain a `probes?` override
- [ ] Ordering of gates preserved: disabled short-circuit → cron/event match → history dedup → requirements → spawn
- [ ] `tm run <name>` bypasses both `enabled` and `requires`
- [ ] Skipped tasks are logged as `{ event: 'skipped', task, reason: 'requirement-unmet', requirement: [...] }`; the old `reason: 'offline'` literal is retired
- [ ] README reflects the new fields, with an updated Runtime Requirements section listing `network` as the only token
- [ ] All existing offline-skip tests pass, rewritten against the new `probes` test surface
- [ ] Deep-module tests cover: empty input, no-req tasks, single-req pass/fail, probe-once count, no-probe-when-unused, parallel execution, skip reporting shape

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
