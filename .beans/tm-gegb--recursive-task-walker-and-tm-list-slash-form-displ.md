---
# tm-gegb
title: Recursive task walker and tm list slash-form display
status: todo
type: feature
created_at: 2026-05-02T18:12:59Z
updated_at: 2026-05-02T18:12:59Z
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

- [ ] A `lib/task/name.ts` module exports a normalizer that accepts user
      input forms and walker-relative paths, validates each segment, and
      returns canonical name plus absolute file path or a typed error.
- [ ] A `lib/task/walk.ts` module recursively walks a tasks directory
      yielding entries plus a warnings list for invalid filenames, with
      symlink-following and cycle protection.
- [ ] `listTasks` consumes the walker; nested files are discovered.
- [ ] `tm list` text mode prints names in slash form, sorted by canonical.
- [ ] `tm list --json` emits canonical underscore names.
- [ ] Existing flat task files keep producing the same canonical names they
      do today.
- [ ] Normalizer unit tests cover all input forms and error cases.
- [ ] Walker integration tests cover nested files, dotfiles, dot-dirs,
      non-`.md` files, invalid-segment files, symlinked subdirectories, and
      a deliberate symlink cycle.
- [ ] `list.test.ts` is extended with nested fixtures.

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
