---
# tm-4mwg
title: DNS connectivity probe
status: todo
type: task
priority: normal
tags:
    - network
created_at: 2026-04-08T10:11:21Z
updated_at: 2026-04-08T10:11:21Z
parent: tm-kgff
---

## What to build

A new `network` module that detects whether the machine has internet connectivity via DNS resolution. The module exports a single `isOnline()` function that probes two public DNS servers in parallel and returns a boolean.

End-to-end: calling `isOnline()` returns `true` if either DNS server responds, `false` if both fail. Tests use dependency injection to avoid real network calls.

See parent PRD section: "Connectivity detection — DNS probe".

## Acceptance criteria

- [ ] New `src/network.ts` module with `isOnline(resolverFactory?): Promise<boolean>`
- [ ] Creates two `dns.Resolver` instances: one with `1.1.1.1`, one with `8.8.8.8`
- [ ] Resolver at `1.1.1.1` resolves `one.one.one.one`; resolver at `8.8.8.8` resolves `dns.google`
- [ ] Both probes run in parallel via `Promise.any`
- [ ] Each probe has a 2-second timeout via `AbortSignal.timeout(2000)`
- [ ] Returns `true` if either probe resolves, `false` if both fail
- [ ] Accepts optional resolver factory for dependency injection in tests
- [ ] Unit tests: both succeed → online
- [ ] Unit tests: one fails, one succeeds → online
- [ ] Unit tests: both fail → offline

## User stories addressed

- User story 10: fast connectivity check
- User story 11: resilient to single DNS provider failure
