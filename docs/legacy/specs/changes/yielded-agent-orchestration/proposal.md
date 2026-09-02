---
type: "Historical Record"
title: "Proposal: Yielded Agent Orchestration"
description: "Historical copy of a completed Pibo change-packet document."
tags: ["yielded-agent-orchestration", "change-packet", "history"]
status: "deprecated"
authority: "historical"
generated:
  by: "process:pibo-okf-b02-completed-history"
  at: "2026-08-30T18:25:11Z"
---
# Proposal: Yielded Agent Orchestration

## Why

Before this change, delegated Pibo agents remained directly callable and inherited a ten-minute reply deadline. Long-running work could therefore be cancelled because a foreground waiter expired, while the model could bypass the yielded-run lifecycle that provides durable status, notifications, bounded waiting, reading, and cancellation. The current contract removes that deadline and direct send exposure.

Loop accounting also attributes only the controller session's usage. Child-agent usage is omitted, and profile inspection hides per-agent model and thinking overrides.

## What Changes

- Delegated sends become yielded-only through `pibo_run_start`.
- Delegated requests have no implicit lifetime deadline.
- Agent management context is generated only when enabled delegated agents exist.
- Build Context exposes a read-only runtime resolution manifest for the concrete inspected session without injecting another prompt.
- Observe gains request and role filters.
- Run results preserve the complete terminal tool result and references to full oversized output.
- Goal Loop usage recursively includes delegated descendants and is shown in Chat Web.
- Profile inspection exposes configured and effective per-agent model and thinking values through target-profile fallback resolution.

## Capabilities

### Modified Capabilities

- `subagent-delegation`: yielded-only dispatch, request observation, no implicit lifetime.
- `yielded-run-control`: request identity and complete terminal-result contract.
- `goal-loops`: recursive usage and cost accounting.
- `profiles`: inspectable per-agent runtime overrides.

## Impact

- **Code:** tool assembly, run execution context, session routing, observations, runtime resolution inspection, loop accounting, profile inspection, Chat Web Loop statistics.
- **APIs:** additive request/role filters and usage fields; direct send tool exposure is intentionally removed.
- **Data:** additive JSON accounting fields; no schema migration.
- **UI:** additional operational Loop statistics; no new stop buttons.
