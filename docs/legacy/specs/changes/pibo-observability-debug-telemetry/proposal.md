---
type: "Historical Record"
title: "Proposal: Pibo Observability and Debug Telemetry"
description: "Historical copy of a completed Pibo change-packet document."
tags: ["pibo-observability-debug-telemetry", "change-packet", "history"]
status: "deprecated"
authority: "historical"
generated:
  by: "process:pibo-okf-b02-completed-history"
  at: "2026-08-30T18:25:11Z"
---
# Proposal: Pibo Observability and Debug Telemetry

## Why

Pibo can accept a user message, enqueue it, stream model output, construct tool calls, execute tools, update Chat Web traces, project live signals, and persist event history. When that path stalls, agents and operators need to discover where it stalled without dumping raw provider streams, full transcripts, or hundreds of thousands of tokens into context.

The current debug CLI is useful for sessions, events, traces, jobs, and runs. It does not expose enough phase-level telemetry to answer questions such as: did the provider send bytes, did Pibo parse them, which tool-call argument phase was active, when was the last normalized event, and why is the session still marked streaming?

## What Changes

Add an observability layer that records compact, correlated runtime telemetry for session turns, provider requests, streams, tool-call construction, tool execution, queue state, and gateway/runtime health. Expose it through progressive `pibo debug` commands that start with summaries and let an agent drill down step by step.

The system must favor bounded summaries, links, counters, and timings over raw dumps. Raw payload capture, if V1 includes it, must be opt-in, size-limited, short-lived, and discoverable through cursors and selectors.

## Capabilities

### New Capabilities

- `runtime-observability-telemetry`: records bounded telemetry spans, phases, counters, timings, links, and provider-stream metadata.
- `debug-telemetry-cli`: exposes progressive, read-oriented commands for telemetry discovery.
- `provider-stream-diagnostics`: captures provider request lifecycle, raw event-type timelines, parse errors, and stream progress metadata.

### Modified Capabilities

- `debug-cli`: gains telemetry branches with compact summaries, drill-down commands, JSON output, and safe payload selection.
- `pibo-event-contract`: gains optional correlation fields and event/telemetry relationships for turns, provider requests, and tool calls.
- `pibo-session-signals`: can surface active phase and stale-phase hints without becoming the full telemetry store.
- `pibo-data-store-and-ingestion`: gains bounded telemetry storage and retention behavior.

## Impact

- **Code:** add telemetry capture around router, routed session, provider request callbacks, normalized event handling, tool-call events, and tool execution.
- **CLI:** add `pibo debug telemetry ...` or an equivalent branch with summary-first commands.
- **Data:** add durable bounded telemetry rows inside `pibo.sqlite`, counters, correlation links, and optional bounded payload references with retention classes.
- **Auth / Security:** default telemetry is metadata-only; raw payload capture, if added, is local-only, opt-in, bounded, and short-lived.
- **Docs:** add durable capability and change specs, plus incident-debug playbooks after implementation.
