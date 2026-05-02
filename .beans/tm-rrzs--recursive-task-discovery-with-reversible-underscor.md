---
# tm-rrzs
title: Recursive task discovery with reversible underscore canonical names
status: todo
type: epic
created_at: 2026-05-02T18:09:04Z
updated_at: 2026-05-02T18:09:04Z
---

## Problem Statement

I want to organize my taskmaster tasks into directories instead of a flat
`~/.config/taskmaster/tasks/*.md` file list. The current discovery layer only
reads a single directory level, so any nested file is invisible. I also want
to keep collections of related tasks under separate version control and
expose them into the active task tree via `stow` symlinks, which means the
walker needs to follow symlinked directories. The existing task name regex
`[a-z0-9-]+` is the identity used for lock files, history directories, run
archives, prompt tempfiles, and JSONL log fields, so any nested-name scheme
must remain filesystem-safe everywhere it is consumed and remain reversible
back to its source path so derived files are predictable.

## Solution

The tasks directory is walked recursively. Each `.md` file at any depth
becomes a task whose canonical name is built by joining its path segments
with an underscore. The underscore is currently invalid in a single segment,
so the join is a bijection: `tasks/foo/bar.md` becomes `foo_bar`, and there
is no other source path that produces that name. Slashes are not stored in
the canonical name, so every existing downstream consumer (locks, history,
runs, prompts, log fields, marker files) keeps working with no changes to
its filesystem layout. For human display the canonical name is rendered with
underscores converted back to slashes so `tm list` shows `foo/bar`. CLI
subcommands that take a task name accept three input forms — `foo/bar.md`,
`foo/bar`, and `foo_bar` — all routed through a single normalizer that
produces the canonical form and the source file path. Symlinked directories
are followed during the walk so `stow`-managed task collections work, with
realpath-based cycle protection and a depth cap to prevent runaway loops.

## User Stories

1. As a taskmaster user, I want to organize my task files into directories
   under `~/.config/taskmaster/tasks/` so that I can group related tasks
   without flattening everything into one folder.
2. As a taskmaster user, I want nested task files to be discovered
   automatically by `tm list`, `tm tick`, `tm dispatch`, and `tm validate` so
   that organization does not cost me functionality.
3. As a taskmaster user with task collections in separate git repositories,
   I want `stow`-managed symlinks pointing into the tasks directory to be
   walked transparently so that I can version task groups independently.
4. As a taskmaster user, I want each nested task to receive a canonical name
   that is filesystem-safe and unique across the tree so that lock files,
   history directories, and run archives never collide.
5. As a taskmaster user, I want the canonical name to be reversible back to
   the source file path so that I can predict where a task lives from its
   name and vice versa.
6. As a taskmaster user, I want `tm list` to display task names in
   human-readable slash form so that the directory structure is visible at a
   glance.
7. As a taskmaster user, I want `tm run foo/bar`, `tm run foo/bar.md`, and
   `tm run foo_bar` to all execute the same task so that I can copy-paste
   from `tm list`, from a shell tab-completion, or from a log entry without
   thinking about which form I have.
8. As a taskmaster user, I want `tm validate` to surface invalid task
   filenames (uppercase, spaces, dots, underscores in a segment, leading or
   trailing dashes, empty segments) so that I can clean them up before
   running anything.
9. As a taskmaster user, I do NOT want `tm tick` and `tm dispatch` to clutter
   the JSONL log with warnings about invalid filenames every cycle, because
   that signal belongs to `tm validate`.
10. As a taskmaster user, I still want `tm tick` and `tm dispatch` to log
    parse and frontmatter failures on otherwise valid filenames, because a
    typoed schedule on a real task should not silently never run.
11. As a taskmaster user, I want hidden files and dotfile directories
    (`.DS_Store`, `.git/`, `.obsidian/`) inside the tasks tree to be ignored
    silently so that auxiliary tooling does not pollute warnings.
12. As a taskmaster user, I want non-`.md` files (`README`, `notes.txt`) to
    be ignored silently so that I can keep documentation alongside tasks.
13. As a taskmaster user, I want a flat `tasks/foo_bar.md` file to be
    rejected as invalid so that the bijection between canonical names and
    file paths cannot be broken.
14. As a taskmaster user, I want `tm list --json` to emit canonical
    underscore names so that downstream tooling has one stable identifier.
15. As a taskmaster user, I want JSONL log fields, history record
    `task_name` fields, and lock marker payloads to use the canonical
    underscore name so that grep-based investigation has one stable string
    per task.
16. As a taskmaster user, I want `tm history`, `tm logs`, `tm status`, and
    `tm doctor` output to render task names in human slash form for
    readability while keeping their internal identifiers canonical.
17. As a taskmaster user, I want crontab entries generated by taskmaster to
    use the canonical underscore form so that no shell quoting concerns
    arise and the crontab is parser-stable.
18. As a taskmaster user with a deeply or maliciously linked tasks tree, I
    want the walker to refuse to loop forever so that an accidental cycle
    does not hang `tm`.

## Implementation Decisions

- A new pure module owns the bijection between user input, canonical name,
  and source file path. It accepts the three CLI input forms and the
  walker's relative-path form, and returns a canonical name, an absolute
  source file path, and the validated segment list, or a typed error.
- A new recursive walker module owns directory traversal. It yields a
  stream of valid entries plus a list of warnings for invalid filenames.
  It follows symlinked directories with realpath-based cycle protection and
  a soft depth cap. It silently skips dotfiles, dot-directories, and
  non-`.md` files.
- Canonical task names are joined path segments separated by underscores.
  Each segment must match the existing `[a-z0-9-]+` regex. The underscore is
  introduced only by the join; it is never legal inside a segment. This
  guarantees a bijection between canonical names and source paths.
- A flat file at the tasks root whose basename contains an underscore is
  rejected by segment validation, preserving the bijection.
- The display form converts underscores back to slashes. Display is used for
  human-readable surfaces (`tm list` text mode, `tm history` headers,
  `tm doctor` report markdown, `tm status` text mode, error messages shown
  to users). Canonical underscore form is used for machine-readable
  surfaces (JSONL logs, history records, marker files, lock filenames,
  history dir names, runs dir names, prompt tempfiles, dispatch payload
  filenames, crontab entries, `--json` outputs).
- `listTasks` and `validate` both consume the new walker. `listTasks` returns
  warnings for invalid filenames and parse failures; `validate` surfaces
  both kinds.
- `tick` and `dispatch` consume `listTasks` warnings. They silently drop
  invalid-filename warnings and continue to log parse and frontmatter
  failures.
- CLI entry points that take a task name argument route the user's raw input
  through the normalizer at the argv boundary, then pass only the canonical
  name to subsystems. This includes `tm run`, `tm logs`, `tm status <name>`,
  `tm history <name>`, and any other command that resolves to a single task.
- `taskFilePath` becomes a thin wrapper over the normalizer's `filePath`
  output, or is removed in favor of direct normalizer use, depending on
  cleanup outcome.
- `parseTaskFile` keeps frontmatter parsing only. The filename and segment
  validation it does today moves into the normalizer to centralize the
  bijection rules.
- Symlink cycle protection uses a `Set<string>` of resolved real paths
  populated as the walker recurses, with a soft depth cap of 10. A
  single-leaf symlink to a `.md` file is a normal entry and is not subject
  to cycle tracking.
- Lock filenames, history directory names, runs directory names, prompt
  tempfile names, and dispatch payload tempfile names continue to use the
  canonical name verbatim. No path component changes.
- Existing reverse-iteration sites (history query and history purge enumerate
  `history/<canonical>/` directly) keep working unchanged because directory
  names under `history/` are themselves canonical names.

## Testing Decisions

Good tests in this codebase exercise external behavior through a small
fixture filesystem rather than mocking internals. The walker and normalizer
are amenable to direct functional tests because they are pure or near-pure.

- The normalizer module is tested in isolation with a broad table of input
  shapes: each of the three accepted forms, valid single-segment, valid
  multi-segment, invalid segment characters, empty segments, double
  underscores, leading or trailing separators, trailing slashes, and the
  `.md` suffix. Both success and error branches are asserted.
- The walker module is tested with temporary directory fixtures including
  flat files, nested files, dotfiles, dot-directories, non-`.md` files,
  invalid-segment files, symlinked subdirectories, and a deliberate symlink
  cycle to confirm cycle protection. The walker's emitted entries and
  warnings list are asserted directly.
- `listTasks` and `validate` retain their existing behavioral tests with
  fixture additions covering nested paths and invalid-segment files.
- `tick` and `dispatch` get a small additional fixture-based assertion that
  confirms invalid-filename warnings do not appear in their logs while
  parse failures continue to appear.
- CLI entry point coverage for tri-form input lives in an integration test
  that confirms `tm run foo/bar`, `tm run foo/bar.md`, and `tm run foo_bar`
  all create the same lockfile, history directory, and log entry.

## Out of Scope

- Migration of existing flat task files. Greenfield rule applies; existing
  flat files keep working unchanged because they are depth-1 entries in the
  recursive walk.
- Any change to the on-disk shape of `history/`, `runs/`, `locks/`, or the
  JSONL log file. Canonical names remain filesystem-safe and existing
  records keep their current keys.
- Renaming or moving existing tasks. A task moved from a flat path to a
  nested path will be treated as a new task with a new canonical name and
  separate history; there is no auto-merge of prior history.
- Tab-completion improvements for nested task names. Out of scope here; can
  be added later as a separate epic.
- Cross-collection conflict resolution when two stowed collections expose
  the same canonical name. Out of scope; collisions are detected at walk
  time and surfaced as warnings, but the user resolves them.
- Windows path semantics. Project is darwin-only.

## Further Notes

- The choice of underscore as the canonical join separator is load-bearing:
  it is currently invalid inside a segment, which is what makes the join a
  bijection. Any future relaxation of the segment regex to allow underscores
  would silently break the bijection and must therefore be paired with a
  separator change.
- The recursive walker should follow symlinks because the user maintains
  task collections in separate repositories and exposes them via `stow`. See
  the project memory note `project_tasks_stow_symlinks.md` for context.
- The bean structure for vertical slices should reuse the existing fixture
  conventions in `src/list/` and `src/validate/` for any new walker tests.
