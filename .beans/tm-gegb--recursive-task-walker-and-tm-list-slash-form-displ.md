---
# tm-gegb
title: Recursive task walker and tm list slash-form display
status: completed
type: feature
priority: normal
created_at: 2026-05-02T18:12:59Z
updated_at: 2026-05-02T18:26:43Z
parent: tm-rrzs
---

## What to build

Foundational slice for tm-rrzs. Introduce the task name normalizer and the
recursive task walker, and wire them into `tm list` so nested `.md` files
under `~/.config/taskmaster/tasks/` are discovered, displayed in
human-readable slash form, and emitted as canonical underscore form in
`--json` output. Existing flat task files keep working with no change to
their canonical names or downstream artifacts.

The walker follows symlinked directories (the tasks tree is intended to be
populated via `stow`) with realpath-based cycle protection and a soft depth
cap of 10. Dotfiles, dot-directories, and non-`.md` files are silently
skipped during the walk. Each path segment is validated against the
existing `[a-z0-9-]+` rule; an invalid segment produces a warning entry
returned alongside the valid entries.

The normalizer is a pure module that owns the bijection between the three
CLI input forms (`foo/bar.md`, `foo/bar`, `foo_bar`), the walker's
relative-path form, and the canonical underscore name + absolute file path.
This slice introduces the normalizer but its CLI-input use sites land in
the dependent slices.

See parent PRD `tm-rrzs` for the full design rationale, including why the
underscore separator is load-bearing for the bijection.

## Acceptance criteria

- [x] A `lib/task/name.ts` module exports a normalizer that accepts user
      input forms and walker-relative paths, validates each segment, and
      returns canonical name plus absolute file path or a typed error.
- [x] A `lib/task/walk.ts` module recursively walks a tasks directory
      yielding entries plus a warnings list for invalid filenames, with
      symlink-following and cycle protection.
- [x] `listTasks` consumes the walker; nested files are discovered.
- [x] `tm list` text mode prints names in slash form, sorted by canonical.
- [x] `tm list --json` emits canonical underscore names.
- [x] Existing flat task files keep producing the same canonical names they
      do today.
- [x] Normalizer unit tests cover all input forms and error cases.
- [x] Walker integration tests cover nested files, dotfiles, dot-dirs,
      non-`.md` files, invalid-segment files, symlinked subdirectories, and
      a deliberate symlink cycle.
- [x] `list.test.ts` is extended with nested fixtures.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 4
- User story 5
- User story 6
- User story 11
- User story 12
- User story 14
- User story 18

## Summary of Changes

- Added `src/lib/task/name.ts`: pure normalizer accepting `foo/bar.md`, `foo/bar`, `foo_bar`, and walker-relative paths. Returns canonical underscore name + absolute file path, or a `TaskNameError`. Slash form takes priority on mixed input so the segment regex rejects ambiguous separators.
- Added `src/lib/task/walk.ts`: recursive walker with realpath-based cycle protection, soft depth cap of 10, symlink-following (both directory and `.md` leaf forms). Emits typed `WalkWarning` entries carrying the underlying `TaskNameError` rather than a stringified reason. Owns `TasksDirReadError`.
- `src/list/list.ts` now consumes the walker; results are sorted by canonical name. Walker warnings flow through unchanged so downstream code can branch on the tagged error type.
- `src/main.ts` `tm list` text mode renders names through `toDisplayForm` (`foo_bar` → `foo/bar`); `--json` keeps canonical underscore form.
- Migrated `src/dispatch`, `src/status`, `src/tick`, and `src/validate` to import `TasksDirReadError` from `#lib/task/walk`. The validate module no longer re-exports it (greenfield, no compat shim).
- Added `src/lib/task/name.test.ts` (23 tests) and `src/lib/task/walk.test.ts` (12 tests) covering all bean-listed scenarios.
- Extended `src/list/list.test.ts` with nested fixture coverage and a flat-task-name preservation test.
