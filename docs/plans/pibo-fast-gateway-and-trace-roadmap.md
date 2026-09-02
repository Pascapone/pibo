---
type: "Plan"
title: "Pibo Gateway and Trace Architecture Follow-up Roadmap"
description: "Tracks only the unimplemented gateway and trace architecture follow-up work after the shipped hot-path phases."
tags: ["gateway", "performance", "trace"]
status: "draft"
authority: "directive"
migration_lineage:
  source_path: "docs/plans/pibo-fast-gateway-and-trace-roadmap.md"
  source_commit: "debba32a68137205df6351da9f3ae461004ca0c0"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "f04f83a648829039e58572a56d01e2a8304f0895"
  source_bytes: 10484
  source_sha256: "bce63e852d96121a47738b0b3267ca18989ed0a037c79199b9e5ee0c80158d7f"
  source_body_sha256: "bce63e852d96121a47738b0b3267ca18989ed0a037c79199b9e5ee0c80158d7f"
generated:
  by: "process:pibo-okf-p-current-project-plans"
  at: "2026-08-31T22:47:46Z"
---
# Pibo Gateway and Trace Architecture Follow-up Roadmap

This plan retains only the unimplemented work that follows the shipped gateway and Trace V2 hot-path baseline. Implemented gateway, trace, and telemetry behavior is owned by the current canonical specifications; this plan is not a competing description of shipped behavior.

## Canonical current owners

- [Web Host and Channel](/specs/gateway/web-host-and-channel.md)
- [Trace, Terminal, Scrolling, and Workflow Projection](/specs/web/trace-terminal-scrolling-and-workflow-projection.md)
- [Telemetry](/specs/data/telemetry.md)

## Goal

Complete the remaining architecture without moving heavy projection, archive, retention, export, or worker execution onto the gateway request path. The gateway must remain a responsive control plane while raw sources remain authoritative and compact projections remain rebuildable.

## Workstream 1: Formal live trace patches

- Define and version a compact server-sent event trace-patch protocol.
- Apply patches to loaded timeline pages without reloading historical pages for normal streaming deltas.
- Settle provider, turn, and session terminal states correctly after finish, error, cancellation, and reconnect.
- Resume from a bounded cursor or compact delta without replaying full history.

### Acceptance

- Active streaming does not reload historical timeline pages.
- Reconnect resumes through a bounded cursor or compact delta.
- Session and turn status settles correctly after every terminal outcome.

## Workstream 2: Persistent trace projection

- Add compact indexed trace-node, trace-payload, and trace-session-state storage.
- Project new events incrementally while retaining raw sources as the rebuild authority.
- Lazy-backfill older sessions under explicit time, row, payload, and memory budgets.
- Expose bounded projection status, drift diagnostics, and an explicit rebuild operation.

### Acceptance

- Projected sessions read from compact indexed rows.
- Large historical sessions open from a bounded tail while backfill proceeds.
- Projection drift is diagnosable and repairable without blocking the gateway event loop.

## Workstream 3: Telemetry capture and archive isolation

- Keep detailed telemetry disabled by default.
- Add explicit, bounded capture runs with isolated active storage.
- Archive and inspect telemetry through explicit offline or worker-owned operations.
- Keep legacy live telemetry inert unless an operator deliberately invokes bounded maintenance tooling.

### Acceptance

- A fresh installation writes no detailed provider-event telemetry by default.
- A large telemetry archive cannot affect gateway startup or bootstrap.
- Archive inspection, retention, and maintenance never run in request handlers.

## Workstream 4: Worker resource protection

- Move projection rebuild, telemetry inspection, retention, export, and other long maintenance work to managed jobs.
- Give jobs durable progress, heartbeat, cancellation, terminal failure state, and explicit ownership.
- Enforce platform-appropriate resource policies, beginning with Linux systemd/cgroups and documenting Windows Job Object support or an explicit fallback.
- Keep Docker as an optional isolated backend where its lifecycle and resource limits are appropriate.

### Acceptance

- The gateway remains responsive while heavy jobs run.
- Every job exposes progress, heartbeat, cancellation, and terminal state.
- A resource-limit violation terminates or fails the worker job rather than the gateway.

## Release gates

- Focused source and test evidence proves each workstream's implemented contract before its claims move into a stable specification.
- Stress validation demonstrates bounded gateway memory, event-loop delay, response sizes, and browser memory under large-session and large-payload workloads.
- Failure, cancellation, reconnect, rebuild, and rollback paths are tested explicitly.
- Operator diagnostics remain bounded and available when detailed telemetry is disabled.

## Non-negotiable constraints

- Structure is the hot path; payloads are cold paths.
- Debug detail is opt-in and bounded.
- Retention and archive maintenance never run in request handlers.
- UI virtualization does not justify unbounded server or browser payloads.
- Gateway self-observability remains available when detailed telemetry is disabled.
- Raw sources remain authoritative and projections remain rebuildable.
