---
# tm-rby1
title: 'Power-aware task execution (requires: ac-power)'
status: todo
type: epic
priority: normal
created_at: 2026-04-22T13:15:15Z
updated_at: 2026-04-22T13:15:15Z
---

## Problem Statement

Some scheduled tasks use local AI models that are power-hungry. When the laptop is on battery, running these tasks drains the battery quickly. The user wants to skip power-hungry tasks when on battery and allow them only when plugged into AC power, without affecting tasks that are fine to run on battery.

The current scheduler already has the concept of connectivity-aware execution (`enabled: 'when-online'`), but power state is not considered. The `enabled` field is also a union of three literals (`false | 'when-online' | 'always'`) that does not compose — there is no way to express "needs network AND AC power" without growing the union combinatorially.

## Solution

Replace the existing three-way `enabled` union with two orthogonal fields:

1. **`enabled: boolean`** — lifecycle on/off switch. Default `true`.
2. **`requires: Requirement[]`** — list of runtime requirements the environment must satisfy before the task runs. Initial tokens: `'network'` and `'ac-power'`. Default: `['network']`. Explicit `[]` means no requirements (always runs).

When a tick or dispatch evaluates tasks, unmet requirements cause the task to be skipped (not deferred) and logged with a structured event. `tm doctor` surfaces consistent unmet-requirement patterns.

`tm run <name>` continues to bypass both `enabled` and `requires`, matching the existing "manual run is a conscious choice" semantic.

Greenfield project: no backwards-compat migration for the old `enabled` literal values.

## User Stories

1. As a user with a laptop, I want to mark power-hungry tasks with `requires: ['ac-power']`, so that they only run when I am plugged in.
2. As a user, I want to combine requirements (`requires: ['network', 'ac-power']`), so that a task only runs when both conditions are met.
3. As a user, I want the default behavior of tasks to stay the same as today (require network), so that existing mental models still apply.
4. As a user, I want `requires: []` to mean "no requirements, always run", so that I can opt a task out of all gates without disabling it.
5. As a user, I want `enabled: false` to still disable a task without me having to edit the `requires` field, so that I can temporarily pause tasks.
6. As a user, I want unknown requirement tokens (typos) to fail loudly via `tm validate`, so that I catch mistakes before runtime.
7. As a user on a desktop machine with no battery, I want my `requires: ['ac-power']` tasks to run normally, so that the requirement does not penalize machines without batteries.
8. As a user, I want the power probe to fail open (if probing fails, assume AC), so that probe failures never silently block all my work.
9. As a user, I want `tm run <name>` to ignore `requires` and `enabled`, so that I can manually execute any task regardless of current system state.
10. As a user, I want skipped tasks to be logged with the specific unmet requirement, so that I can understand why a task did not run.
11. As a user, I want `tm doctor` to warn me when a task has been skipped 3+ consecutive times for the same requirement, so that I notice misconfigured or chronically-blocked tasks.
12. As a user, I want the power probe to be cheap (one shell-out or file read per tick maximum, only when needed), so that scheduler overhead stays minimal.
13. As a user on macOS, I want AC detection to use `pmset -g ps`, so that detection is native and fast.
14. As a user on Linux, I want AC detection to use `/sys/class/power_supply/*/online`, so that detection is native and fast.
15. As a user, I want event-driven tasks dispatched via `tm dispatch` to honor `requires` the same way scheduled tasks do, so that the semantics are consistent across trigger types.
16. As a user, I want probes to run in parallel within a tick, so that overall tick latency does not grow with the number of requirement types.
17. As a user, I want each requirement probed at most once per tick, so that repeated requirements across tasks do not cause redundant work.
18. As a user, I want the scheduler to skip probing entirely when no ready task references a given requirement, so that the overhead scales with actual need.
19. As a user, I want missed scheduled runs due to unmet requirements to be visible in history or logs, so that I can decide whether to run them manually.
20. As a developer adding a new requirement token in the future, I want a registry-based extension point, so that adding a new requirement does not require rewriting tick/dispatch code.
21. As a developer writing tests, I want to override probe functions individually through a single `probes` option, so that tests can simulate specific environment conditions.
22. As a user, I want the schema change to be validated at parse time (Zod), so that invalid task files are rejected consistently with how other fields are validated today.
23. As a user, I want `requires` entries to be deduplicated automatically, so that redundant tokens in a task file do not cause issues.
24. As a user reading the README, I want a documented list of valid requirement tokens and their semantics, so that I know what I can configure.

## Implementation Decisions

- **Schema replacement.** The `enabled` field becomes a plain boolean (default `true`). The `requires` field is introduced as an array of requirement tokens (default `['network']`). The old three-way union is removed entirely — this is a greenfield project and no migration shim is needed.
- **Requirement token set.** Initial tokens: `'network'` and `'ac-power'`. The schema uses a Zod union of string literals so that unknown tokens fail validation with a clear message.
- **Deduplication.** The `requires` array is deduplicated during Zod parsing so that downstream code can assume uniqueness.
- **Empty array semantics.** `requires: []` is valid and means "no runtime requirements — always run" (subject to `enabled`). Omitting the field falls back to the default `['network']`.
- **Deep module: requirements filter.** A new module encapsulates the logic for filtering a list of ready tasks against the set of requirements they declare. It takes the tasks and a probe map, probes each requirement at most once and only when referenced, runs probes in parallel, and returns the subset of tasks that pass along with per-task unmet-requirement information. This module has a stable interface and is the primary unit of test focus.
- **Probe registry.** A small internal registry maps each requirement token to its probe function. Adding a new token in the future is a two-step change: extend the token union and register a probe.
- **Probes.** The existing `isOnline` function is relocated into a probes subdirectory, unchanged in behavior. A new `isOnAcPower` probe is added: macOS uses `pmset -g ps` and looks for "AC Power" or "Battery Power"; Linux reads `/sys/class/power_supply/*/online` for sources of type `Mains`. Both probes are fail-open — any error results in `true` (assume AC / online-equivalent).
- **Pipeline integration.** The `tick` and `dispatch` orchestrators replace the existing inline connectivity check with a single call to the requirements filter. Their options bags drop the `isOnline?` field and gain a `probes?: Partial<Record<Requirement, Probe>>` field that tests can use to override any probe. Ordering of gates remains: disabled short-circuit → cron/event match → history dedup → requirements filter → spawn.
- **Manual `tm run` behavior.** `tm run` continues to bypass `enabled` and now also bypasses `requires`. This matches the existing "manual run is a conscious override" semantic and avoids surprise when debugging.
- **Log event shape.** Skipped tasks are logged with `event: 'skipped'`, `reason: 'requirement-unmet'`, and `requirement` as an array listing all unmet requirements for that task in that tick. The previous `reason: 'offline'` literal is retired.
- **Doctor diagnostic.** A new check mirrors the existing `consecutive_failures` and `consecutive_timeouts` checks: `consecutive_requirement_skips` warns when a task has been skipped 3+ times in a row for the same unmet requirement. This reuses the existing history-tail query pattern.
- **Schema permissiveness on redundant combinations.** The schema does not warn if `enabled: false` coexists with a non-empty `requires`. The fields are orthogonal and having `requires` persist while temporarily disabling a task is useful.
- **Event-task coverage.** The requirements filter is applied inside `tm dispatch <event>` so event-driven tasks honor `requires` identically to scheduled tasks.
- **Parallel, probe-once semantics.** The filter computes the union of requirements referenced by the ready set, probes each one concurrently (with `Promise.all`), caches the result for the duration of the call, and filters each task against its declared requirements.
- **Documentation update.** The README's frontmatter reference table, the Connectivity section, and the Task File Format examples are updated to reflect the new `enabled` / `requires` split. The Doctor section gains a line describing the new consecutive-requirement-skips finding.

## Testing Decisions

Good tests in this codebase exercise external behavior (inputs → outputs, side effects visible through public interfaces) and avoid asserting on internal structure. Tests colocate with the source file they cover.

- **Requirements filter module (primary focus).** Table-driven tests covering: empty task list, tasks with no requirements, tasks that pass single/multiple requirements, tasks blocked by one vs multiple requirements, probe-once verification via a counting mock, no-probe-when-unused verification, parallel-probe verification, and correct skip reporting (tasks appear once per tick with the full list of unmet requirements). This is the deep module — most of the test budget goes here.
- **AC-power probe.** Fixture-based tests per platform. macOS path tests parse `pmset` output variants (AC Power, Battery Power, unexpected output → fail-open). Linux path tests read fixture directory layouts under a test root (Mains online=1, online=0, no Mains source → fail-open). Probe errors return `true`.
- **Frontmatter schema.** Extend the existing `frontmatter.test.ts` with: new boolean `enabled` defaults, `requires` defaults, explicit `[]`, unknown-token rejection with the expected error message, dedup behavior, coexistence of `enabled: false` with `requires`. Remove tests for the retired three-way union.
- **Tick and dispatch integration.** Thin tests that confirm the orchestrators wire the new `probes` option correctly and that the order-of-gates is preserved. These tests use the probe override to simulate AC/battery and online/offline conditions without going near the real probe implementations. Mirror the existing tick/dispatch tests that today override `isOnline`.
- **Doctor check.** Mirrors the shape of the existing `consecutive_failures` and `consecutive_timeouts` tests in `checks.test.ts`. Seeds a history/log fixture with N consecutive skip events for the same requirement and asserts the finding appears at the expected severity.
- **No mocking of subprocess execution in the filter module tests.** All probe behavior is tested in the probe module's own test file; the filter tests inject fake probe functions directly.

## Out of Scope

- Deferred execution / catch-up runs when a requirement becomes satisfied later. Current design is skip-only.
- Low Power mode / energy-mode detection beyond the binary AC-vs-battery signal.
- Battery-percentage thresholds (e.g., "require >50% battery").
- Windows support for the AC-power probe.
- Additional requirement tokens beyond `network` and `ac-power` (disk space, VPN, specific daemons, etc.) — the registry shape supports future extension but no new tokens are added in this change.
- Event-triggered tasks that fire when a power-state transition occurs (e.g., "run X when I plug in"). This is a separate feature; the current change only gates execution on current state.
- Per-task `--force` flag on `tm run`. Manual `tm run` already bypasses everything and no per-invocation override is introduced.

## Further Notes

- The combination `enabled: false` + `requires: [...]` remains valid because it is useful to pause a task temporarily without rewriting its declared requirements.
- The probe for AC power is designed to be cheap enough to run on every tick that needs it. Both macOS and Linux paths complete in well under 10ms in the common case.
- Desktops without batteries are correctly handled on Linux by the "no Mains source → fail open" rule, and on macOS by `pmset -g ps` reporting "AC Power" regardless.
- Because probes are fail-open, a broken probe biases toward running tasks rather than skipping them. This aligns with the project's bias against silent failures that suppress user work.
