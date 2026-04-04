---
# tm-51fy
title: Project scaffolding & task parser
status: in-progress
type: feature
priority: high
created_at: 2026-04-04T19:53:09Z
updated_at: 2026-04-04T20:00:11Z
---

## What to build

Bootstrap the Bun project and implement the task file parser that all other slices depend on. This includes project structure, TypeScript config, oxlint for linting, oxfmt for formatting, test config, and a parser that reads markdown files with YAML frontmatter from `~/.config/taskmaster/tasks/`, validates all fields, and returns a typed `TaskDefinition` or structured error.

See PRD Slice 0 for full specification.

## Acceptance criteria

- [ ] Bun project initialised with TypeScript, oxlint, oxfmt, and test runner configured (S0.1)
- [ ] oxfmt configured as formatter; Claude Code hook runs `oxfmt` on `.ts` files after every write (S0.1a)
- [ ] oxlint configured as linter (S0.1b)
- [ ] tsgo configured for type checking (S0.1c)
- [ ] Task file parser reads YAML frontmatter (schedule, timezone, cwd, claude_args, env, enabled) and markdown body from a .md file (S0.2)
- [ ] Parser validates schedule as a syntactically correct 5-field cron expression (S0.3)
- [ ] Parser validates timezone as a valid IANA identifier when present (S0.4)
- [ ] Parser validates task name (derived from filename) matches [a-z0-9-]+ (S0.5)
- [ ] Parser returns typed TaskDefinition object on success, structured error on failure (S0.6)
- [ ] Unit tests cover valid files, missing required fields, malformed cron, invalid timezone, bad filenames (S0.7)

## User stories addressed

- As a developer, I can clone the repo, run bun install, and have a working project structure
- As a user, I create a .md file with valid frontmatter and it can be parsed by the system
- As a user, I get a clear error if my task file has invalid frontmatter or non-conforming filename
