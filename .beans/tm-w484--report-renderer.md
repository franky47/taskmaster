---
# tm-w484
title: Report renderer
status: todo
type: task
priority: high
created_at: 2026-04-07T12:14:08Z
updated_at: 2026-04-07T12:14:08Z
parent: tm-py4h
blocked_by:
    - tm-ymal
    - tm-t4z4
    - tm-rsra
    - tm-g12o
---

## What to build

Add the markdown report renderer for the doctor feature (see parent PRD tm-py4h).

**`renderReport(findings, checkedAt, platform)`** — takes the collected findings array, the "checked at" timestamp, and the platform (`darwin` | `linux`), and produces a markdown string.

Report format:
- First line: `Checked at: <ISO timestamp>`
- One `##` section per finding, with severity tag in heading (e.g., `## Scheduler not running [critical]`)
- Each section includes: explanation, relevant timestamps with relative time, and platform-appropriate investigation commands
- Investigation commands use `tm` CLI commands (e.g., `tm history <name> --failures --last 5`) and platform tools (launchctl on darwin, crontab -l on linux)
- File paths (stderr, run artifacts) referenced as-is for the agent to `cat`/`ls`
- Findings ordered by severity (critical first, then error, warning, info)

Relative time helper (from slice 2) is reused here for timestamp display.

Minimal markdown formatting — no tables, no horizontal rules. Token-efficient for AI agent consumption.

## Acceptance criteria

- [ ] Output starts with `Checked at: <timestamp>`
- [ ] Each finding rendered as a `##` section with severity tag
- [ ] Findings ordered by severity: critical > error > warning > info
- [ ] Investigation commands are platform-appropriate (launchctl on darwin, crontab on linux)
- [ ] Stderr and run artifact paths referenced, not inlined
- [ ] All timestamps include both absolute and relative display
- [ ] Tested with known inputs producing expected markdown output
- [ ] Tested with both darwin and linux platform values

## User stories addressed

- User story 4: Timestamps and relative times
- User story 5: Platform-aware investigation commands
- User story 15: Stderr paths referenced, not inlined
- User story 16: "Checked at" timestamp at top
- User story 18: Run artifact directories referenced
