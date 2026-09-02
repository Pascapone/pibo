---
type: "Plan"
title: "Reconcile Rejected Message Signals"
description: "Directive plan to audit and close exact rejected-dispatch signal and optimistic-message invariants."
tags: ["gateway", "signals", "delivery", "reconciliation"]
status: "draft"
authority: "directive"
generated:
  by: "process:pibo-okf-b01-active-plan-extraction"
  at: "2026-08-30T17:04:59Z"
sources:
  - id: "SPC-GW-001"
    resource: "/specs/gateway/routing-events-and-actions.md"
    title: "Routing, Events, Steering, and Session Actions"
    relation: "shipped dispatch, rejection, and routed-session facts"
  - id: "SPC-DATA-005"
    resource: "/specs/data/signals.md"
    title: "Live Pibo Session Signals"
    relation: "shipped signal projection and reconciliation facts"
  - id: "SPC-WEB-003"
    resource: "/specs/web/composer-delivery-files-and-media.md"
    title: "Chat Web Composer, Delivery, Files, and Media"
    relation: "shipped delivery and error-presentation facts"
  - id: "source-1"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/reconcile-rejected-message-signals/spec.md"
    path: "docs/specs/changes/reconcile-rejected-message-signals/spec.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
links:
  - "/specs/gateway/routing-events-and-actions.md"
  - "/specs/data/signals.md"
  - "/specs/web/composer-delivery-files-and-media.md"
---

# Reconcile Rejected Message Signals

## Observed failure boundary

The removed packet recorded a private reproduction in which dispatch rejected an idle Steer request after optimistic accepted-message projection, leaving activity that appeared live. That reproduction is historical lineage, not proof of current behavior. The accepted canonical specifications now state that rejected sends and emit failures reconcile explicitly, signals are reconstructable rather than durable, and browser overlays do not own signal truth.

The remaining plan audits the exact node and turn-removal invariants below, adds missing focused coverage, and changes implementation only where current code or tests leave a gap. It publishes no private reproduction identifiers or runtime details.

## Active correction scope

- Trace accepted-message projection through dispatch rejection and signal snapshot reconstruction.
- Ensure rejection removes the exact optimistic accepted-message node and any synthetic turn created only for that message.
- Preserve a pre-existing active turn when a separate Steer dispatch rejects.
- Recompute processing, streaming, queue, and status fields from routed-session state after rejection.
- Align durable delivery failure, ephemeral signal state, and browser optimistic presentation without making one layer authority for another.
- Add focused idle-Steer and active-turn regression tests for any invariant not already proven.

### Non-goals

- Delete durable accepted/failed event history solely to clear ephemeral state.
- Change provider/runtime failures that already follow the canonical session-error path.
- Redesign Queue/Steer selection or composer UX.
- Add durable signal persistence; signal state remains reconstructable.
- Claim a live reproduction or browser/provider validation from this plan.

## State invariants

1. A rejected dispatch leaves no active signal node for the rejected message identity.
2. A turn created only by that message disappears before runtime execution starts.
3. An unrelated active turn, running tool, or queued message remains present and correctly counted.
4. `processing`, `streaming`, queue count, status, and compact telemetry hints derive from the routed session after rejection.
5. Durable failed-delivery history and visible error presentation may remain while ephemeral running activity clears.
6. Duplicate, late, or reordered rejection handling is idempotent and cannot remove another message or turn.
7. Reconnect or snapshot replacement converges to the same state as the live patch sequence.

## Regression matrix

| Scenario | Required terminal state |
|---|---|
| Idle Steer rejects before runtime start | Rejected message and synthetic turn absent; Session idle and settled. |
| Steer rejects while another turn runs | Rejected message absent; original turn remains active; counts match routed state. |
| Queue dispatch rejects with existing queue | Only the rejected item clears; remaining queue order and count persist. |
| Failure handling repeats | Second reconciliation is a no-op with no unrelated deletion. |
| Snapshot follows rejection patch | Snapshot and browser overlay converge without stale running hints. |
| Event delivery fails after optimistic UI | Durable error remains visible; ephemeral pending/running state settles. |

## Acceptance and validation

- Source inspection maps each invariant to one router, signal-registry, API, and browser-overlay owner.
- Focused signal-registry tests prove exact identity removal, synthetic-turn removal, active-turn preservation, counts, and idempotency.
- Router tests prove rejected idle and active-turn Steer paths without provider execution.
- API/reducer tests prove snapshot-plus-patch convergence and duplicate/out-of-order handling.
- Existing routing, signal, and pending-delivery suites pass with no weakening of session isolation or bounded output.
- Any later live browser or provider run is recorded separately; this Plan carries no such verification.

Current authority is [SPC-GW-001](../specs/gateway/routing-events-and-actions.md), [SPC-DATA-005](../specs/data/signals.md), and [SPC-WEB-003](../specs/web/composer-delivery-files-and-media.md). The Git-pinned source records rationale and exact lineage only.
