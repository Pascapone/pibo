---
type: "Historical Record"
title: "Spec: Immediate history loading at the Terminal edge"
description: "Historical copy of a completed Pibo change-packet document."
tags: ["immediate-top-trace-pagination", "change-packet", "history"]
status: "deprecated"
authority: "historical"
generated:
  by: "process:pibo-okf-b02-completed-history"
  at: "2026-08-30T18:25:11Z"
---
# Spec: Immediate history loading at the Terminal edge

**Status:** Done
**Created:** 2026-08-07
**Requester / Source:** Pibo2 historical trace pagination investigation

## Why

Compact Terminal deliberately waits 700 ms for active scroll intent to settle before requesting an older trace page. On Pibo2 the API itself returns historical pages in roughly 48–84 ms, but an exact scroll to the history edge did not start the first request until 703.5 ms. The artificial delay dominates perceived historical-span loading.

## Goal

Reaching the exact top of Compact Terminal starts historical pagination immediately while near-top prefetch retains its scroll-settle protection.

## Scope

### In Scope

- Cancel any pending near-top settle timer when the exact top is reached.
- Start exact-top pagination without the 700 ms intent delay.
- Keep near-top prefetch, request deduplication, prepend anchoring, and pagination semantics unchanged.
- Validate the real authenticated infinite-scroll path on Pibo2.

### Out of Scope

- Changing page size, trace projection, cursor semantics, or API queries.
- Removing the settle delay from speculative near-top prefetch.
- Changing the non-Terminal trace view.

## Requirements

### Requirement: Exact-top pagination is immediate

The Compact Terminal MUST request the next historical page without applying the near-top scroll-intent settle delay when the user reaches the exact history edge.

#### Scenario: Near-top scrolling

- GIVEN the user is scrolling upward near the history edge
- WHEN the viewport has not reached the exact top
- THEN prefetch MAY wait for the existing 700 ms intent-settle interval.

#### Scenario: Exact history edge

- GIVEN older trace events exist
- WHEN the viewport reaches the exact top
- THEN a pending settle timer is cancelled and the request starts immediately.

## Acceptance Criteria

- Focused infinite-scroll tests distinguish near-top settled loading from exact-top immediate loading.
- Typecheck, production build, and `git diff --check` pass.
- The real Pibo2 exact-top request-start delay is materially lower than the measured 703.5 ms baseline.
- Historical rows remain ordered, cursor requests do not duplicate within one continuous scroll run, and the final latest row remains intact.

## Assumptions / Open Questions

- Existing prepend anchoring is sufficient when the exact-top request starts earlier.
- No open question blocks this narrow timing change.
