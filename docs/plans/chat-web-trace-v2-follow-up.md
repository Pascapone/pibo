---
type: "Plan"
title: "Chat Web Trace V2 Follow-up"
description: "Directive plan for the remaining Trace V2 projection, patch, worker, and validation work."
tags: ["chat", "trace", "streaming", "projection", "workers"]
status: "draft"
authority: "directive"
generated:
  by: "process:pibo-okf-b01-active-plan-extraction"
  at: "2026-08-30T17:04:59Z"
sources:
  - id: "SPC-DATA-001"
    resource: "/specs/data/product-store-history-and-read-models.md"
    title: "Product Store, History, Payloads, and Read Models"
    relation: "shipped payload, history, and read-model facts"
  - id: "SPC-WEB-004"
    resource: "/specs/web/streaming-cache-and-live-projection.md"
    title: "Chat Web Streaming, Cache, and Live Projection"
    relation: "shipped streaming, cache, and live-overlay facts"
  - id: "SPC-WEB-005"
    resource: "/specs/web/trace-terminal-scrolling-and-workflow-projection.md"
    title: "Chat Web Trace, Terminal, Scrolling, and Workflow Projection"
    relation: "shipped trace and terminal projection facts"
  - id: "source-1"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/chat-web-trace-v2-fast-path/design.md"
    path: "docs/specs/changes/chat-web-trace-v2-fast-path/design.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
  - id: "source-2"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/chat-web-trace-v2-fast-path/proposal.md"
    path: "docs/specs/changes/chat-web-trace-v2-fast-path/proposal.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
  - id: "source-3"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/chat-web-trace-v2-fast-path/spec.md"
    path: "docs/specs/changes/chat-web-trace-v2-fast-path/spec.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
  - id: "source-4"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/chat-web-trace-v2-fast-path/tasks.md"
    path: "docs/specs/changes/chat-web-trace-v2-fast-path/tasks.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
links:
  - "/specs/data/product-store-history-and-read-models.md"
  - "/specs/web/streaming-cache-and-live-projection.md"
  - "/specs/web/trace-terminal-scrolling-and-workflow-projection.md"
---

# Chat Web Trace V2 Follow-up

## Current shipped baseline

The canonical specifications own current behavior. Pibo already serves bounded trace summary and timeline pages, keeps raw events and payload detail opt-in, protects payload reads with exact references and limits, renders older history incrementally, and overlays live frames without rewriting durable facts. Session-keyed cache and reconciliation behavior also exists. This plan does not reopen those shipped contracts.

## Active follow-up scope

The remaining directive has four outcomes:

1. Define a durable trace read-model boundary and a versioned persistent projection with source watermarks.
2. Add bounded incremental projection and repair paths for new and historical events.
3. Decide whether a formal Trace V2 patch protocol should replace any remaining broad refreshes; preserve the existing live-overlay contract until that protocol proves equivalent.
4. Move rebuild, backfill, diff, and export work to bounded background execution with progress, cancellation, and resource policy.

Richer payload continuation or download UX may proceed only after access, size, and content-policy decisions are explicit. Compatibility work may retire remaining V1 dependencies only after current debug consumers have a bounded replacement.

### Non-goals

- Reimplement the shipped compact timeline, raw-events split, bounded payload endpoints, or current live overlay.
- Make browser caches or the projection authoritative over durable product events.
- Run unbounded backfill, export, compression, or payload reads in a gateway request.
- Claim visual, browser, provider, deployment, or live-runtime acceptance from this plan.

## Work breakdown and dependencies

### Phase 1 — Read-model and projection contract

- Specify the `TraceReadModel` interface, projection schema, source watermark, projection version, and drift states.
- Define idempotent event-to-node rules and exact payload-reference ownership under SPC-DATA-001.
- Define bounded tail behavior for sessions with no or partial projection.
- Add migration and compatibility fixtures for supported historical event forms.

Dependency: canonical event identity, payload storage, and timeline cursor contracts must remain stable or version explicitly.

### Phase 2 — Incremental projection and repair

- Project new events incrementally and expose projection status without blocking normal reads.
- Implement budgeted lazy backfill and resumable rebuild with deterministic checkpoints.
- Add a projection-versus-source diff command that reports metadata and counts without leaking payload bodies.
- Define cache invalidation from committed projection versions and exact Session identity.

Dependency: worker/job ownership and resource limits must be selected before bulk repair is enabled.

### Phase 3 — Live delta and compatibility closure

- Measure current refresh behavior before defining a patch protocol.
- If needed, define added, updated, terminal-status, preview, and payload-reference patches with cursor and duplicate semantics.
- Prove reconnect, duplicate, abort, error, and stale-session handling against the current overlay invariants.
- Migrate remaining default consumers away from V1 DTO adaptation; retain only bounded debug compatibility with an explicit retirement gate.

### Phase 4 — Operational hardening

- Run rebuild, backfill, and export outside request handlers.
- Expose progress, heartbeat, cancellation, failure, version, and repair status.
- Bound concurrency, bytes, rows, elapsed work, retained status, and retry behavior.
- Add observability for projection lag, drift, cache invalidation, repair failures, and gateway impact without recording private content.

## Acceptance and validation matrix

| Area | Acceptance criterion | Required evidence |
|---|---|---|
| Projection | Replaying the same events is idempotent; version and watermark advance monotonically. | Deterministic projection and migration tests. |
| Partial history | An unprojected or partially projected session opens a bounded tail while backfill remains resumable. | Large historical fixtures and enforced budgets. |
| Live updates | Existing identity, terminal-state, duplicate, and reconnect invariants survive any patch protocol. | Reducer, route, and reconnect tests. |
| Repair | Drift detection identifies mismatches; repair never rewrites source events and can resume or cancel. | Fault-injection and checkpoint tests. |
| Security | Payload and raw-event access remains exact-reference, authorized, bounded, and absent from default responses. | Access, malformed-ref, size, and disclosure tests. |
| Operations | Rebuild load cannot monopolize the gateway or exceed its resource policy. | Worker stress and gateway-responsiveness evidence when implementation exists. |
| Compatibility | Default Chat Web and supported debug consumers no longer require an unbounded V1 representation. | API/client contract tests and deprecation inventory. |

## Source and canonical boundaries

The accepted canonical owners are [SPC-DATA-001](../specs/data/product-store-history-and-read-models.md), [SPC-WEB-004](../specs/web/streaming-cache-and-live-projection.md), and [SPC-WEB-005](../specs/web/trace-terminal-scrolling-and-workflow-projection.md). They define current behavior and override stale packet claims. The four Git-pinned packet files in frontmatter supply historical rationale and unfinished-work lineage only; they are not current specifications or implementation evidence.
