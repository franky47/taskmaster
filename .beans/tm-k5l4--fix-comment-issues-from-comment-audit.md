---
# tm-k5l4
title: Fix comment issues from comment audit
status: completed
type: task
priority: normal
created_at: 2026-04-09T11:34:36Z
updated_at: 2026-04-09T13:53:00Z
---

## Context

A comment analysis found the codebase generally well-maintained, but identified inaccurate comments, unnecessary "what" comments, and one real code bug surfaced by a comment.

## Critical Inaccuracies

- [ ] `src/history/purge.ts:41`: Misleading example `(e.g. stderr.txt)` — since stdout+stderr merge, ALL files may not exist. Change to `// Best-effort: file may not exist (legacy or partial history entries)`
- [ ] `src/tick/tick.ts:61-62`: SFE argv comment references `launchd` but runs on all platforms. Standardize with the platform-neutral version from `src/setup/setup.ts:47-49`

## Code Bug (surfaced by comment)

- [ ] `src/setup/setup.ts:307`: `isSchedulerInstalled` uses `.includes()` but line 213 comments explicitly call out `// Idempotency: exact line match (not substring) to avoid false positives` — fix `isSchedulerInstalled` to use exact line match for consistency

## Remove "What" Comments

- [ ] `src/main.ts:39` — `// Resolve timestamp` (code is self-documenting)
- [ ] `src/history/record.ts:63` — `// Write history files`
- [ ] `src/history/record.ts:83` — `// Temp dir lifecycle`
- [ ] `src/history/query.ts:62-63` — `// Read history directory`
- [ ] `src/history/query.ts:75` — `// Parse meta files, sorted newest first`
- [ ] `src/tick/tick.ts:168` — `// Sort newest first by timestamp`

## Improvements

- [ ] `src/task/frontmatter.ts:11-13`: Clarify lowercase restriction is intentional — "subset of ms.StringValue, restricted to lowercase"
- [ ] `src/task/frontmatter.ts:262`: Move inline `return` comment to its own line for visibility
- [ ] `src/task/frontmatter.ts:287-289`: Use `'unreachable: ...'` prefix on invariant throw
- [ ] `src/doctor/checks.ts:129-130`: Rephrase "tick runs every 60s" → "scheduler is configured to tick every minute"
- [ ] `src/lock/ffi.ts:17`: Explain macOS `__error()` vs Linux `__errno_location()` difference, not just "no type assertions"
- [ ] `src/agent/agent.ts:97-98`: Explain gray-matter frontmatter wrapping trick more clearly
- [ ] `src/history/query.ts:89-94`: Add comment about `stdout.txt` fallback being for legacy format (or extract helper)


## Acceptance Criteria

### Critical Inaccuracies

**`purge.ts:41` misleading example**
- Comment is changed to `// Best-effort: file may not exist (legacy or partial history entries)` or similar — no longer singles out `stderr.txt`
- No functional code changes

**`tick.ts:61-62` platform-specific comment**
- Comment no longer references `launchd` specifically
- Comment explains both compiled SFE and dev-mode binary resolution without platform assumptions
- Consistent with the explanation in `setup.ts:47-49`

### Code Bug

**`isSchedulerInstalled` uses `.includes()` instead of exact match**
- `isSchedulerInstalled` in `src/setup/setup.ts` uses exact line matching (split + `===`) instead of `.includes()`
- Matches the approach documented in the comment at line 213
- New test: a crontab containing a line that is a _superset_ of the expected entry does not match as "installed"
- Existing setup tests pass

### Remove "What" Comments

- All 6 listed comments are removed
- No functional code changes
- The `// Record history (non-fatal)` comment in `main.ts:75` is either removed or shortened to just `// non-fatal` (the "(non-fatal)" part has value)

### Improvements

**`frontmatter.ts:11-13` lowercase restriction**
- Comment mentions "subset of ms.StringValue" and that the lowercase restriction is intentional
- No functional code changes

**`frontmatter.ts:262` inline return comment**
- Comment is on its own line above `return`, not trailing on the same line
- No functional code changes

**`frontmatter.ts:287-289` unreachable prefix**
- Error message uses `'unreachable: ...'` prefix instead of `'invariant: ...'`
- No functional code changes beyond the string literal

**`doctor/checks.ts:129-130` tick frequency**
- Comment says "the scheduler is configured to tick every minute" rather than "tick runs every 60s"
- No functional code changes

**`lock/ffi.ts:17` platform errno explanation**
- Comment explains that macOS uses `__error()` and Linux uses `__errno_location()` for thread-local errno access
- No functional code changes

**`agent/agent.ts:97-98` gray-matter trick**
- Comment explains the wrapping-in-frontmatter-delimiters pattern and why (reusing existing dependency)
- No functional code changes

**`history/query.ts:89-94` stdout.txt fallback**
- Either: a comment explains the fallback exists for pre-merge legacy history entries
- Or: the fallback logic is extracted into a named helper that self-documents (e.g. `resolveOutputPath`)
- If duplicated in `queryGlobalHistory`, both sites are updated consistently
