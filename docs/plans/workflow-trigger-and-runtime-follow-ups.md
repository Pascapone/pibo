---
type: "Plan"
title: "Workflow Trigger and Runtime Follow-ups"
description: "Directive plan for remaining workflow trigger, integrated execution, recovery, and validation gaps."
tags: ["workflows", "runtime", "manual-trigger", "recovery"]
status: "draft"
authority: "directive"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-05T07:04:00Z"
sources:
  - id: "SPC-ORCH-005"
    resource: "/specs/orchestration/workflow-framework-runtime-store.md"
    title: "Workflow Framework, Runtime, and Store"
    relation: "shipped workflow IR, runtime, and store facts"
  - id: "SPC-ORCH-006"
    resource: "/specs/orchestration/workflow-catalog-and-session-execution.md"
    title: "Workflow Catalog, Publishing, and Session Execution"
    relation: "shipped catalog and session-native execution facts"
  - id: "SPC-WEB-008"
    resource: "/specs/web/jobs-and-workflows-ui.md"
    title: "Chat Web Jobs and Workflows UI"
    relation: "shipped workflow product-surface facts"
  - id: "SPC-VAL-001"
    resource: "/specs/validation/validation-contract.md"
    title: "Project Validation Contract"
    relation: "current validation-matrix and evidence boundaries"
  - id: "source-1"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/workflow-runtime-foundation-manual-trigger/design.md"
    path: "docs/specs/changes/workflow-runtime-foundation-manual-trigger/design.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
  - id: "source-2"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/workflow-runtime-foundation-manual-trigger/proposal.md"
    path: "docs/specs/changes/workflow-runtime-foundation-manual-trigger/proposal.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
  - id: "source-3"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/workflow-runtime-foundation-manual-trigger/spec.md"
    path: "docs/specs/changes/workflow-runtime-foundation-manual-trigger/spec.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
  - id: "source-4"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/workflow-runtime-foundation-manual-trigger/tasks.md"
    path: "docs/specs/changes/workflow-runtime-foundation-manual-trigger/tasks.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
links:
  - "/specs/orchestration/workflow-framework-runtime-store.md"
  - "/specs/orchestration/workflow-catalog-and-session-execution.md"
  - "/specs/web/jobs-and-workflows-ui.md"
  - "/specs/validation/validation-contract.md"
---

# Workflow Trigger and Runtime Follow-ups

## Current framework and product boundary

The canonical specifications own current Workflow behavior. Pibo already has Workflow IR, validation and registry helpers, versioned catalog/draft/publish/archive surfaces, an editor, runtime/store components, a bounded manual text-trigger slice with deterministic fan-out through ordinary chat Sessions and canonical runtime facts, and immutable Session configuration plus one pending canonical Run on start. The current manual slice explicitly rejects unsupported joins. Configured Session start explicitly reports that general graph execution is not connected, and no general restart resumption or external webhook/Cron trigger is evidenced.

This plan builds on the shipped kernel and product surfaces. It does not describe them as pending or treat Web state as execution authority.

## Active follow-up scope

- Decide and normalize first-class trigger-node and trigger-envelope semantics across IR, editor, Session, and later provider starts.
- Extend validation for trigger inputs, output ports, edges, adapters, guards, joins, capabilities, and profile/resource availability.
- Connect Session and editor starts to the owned graph executor without duplicating execution in the Web layer.
- Advance supported graphs through agent, adapter, guard/router, human-wait, nested-workflow, and terminal nodes with explicit edge payloads.
- Persist node attempts, edge transfers, waits, retries, checkpoints, cancellation, output, and failure facts for recovery and projection.
- Close restart-resumption, unsupported-join, idempotency, and external-trigger gaps through staged implementation and separate evidence.

### Non-goals

- Replace current catalog, draft, publishing, editor, or package runtime contracts.
- Pass full upstream chat history across edges by default.
- Let raw editor or browser state bypass validation, capability checks, version pinning, or durable runtime facts.
- Claim Session full-graph execution, restart recovery, webhook/Cron triggers, or live provider behavior before dedicated gates pass.
- Conflate root product tests, workflow-package tests, browser checks, and provider checks into one evidence class.

## IR/trigger/runtime decisions

1. **Trigger representation:** select a durable trigger node shape and versioning rule that can support manual, webhook, and scheduled providers without changing executor contracts.
2. **Start envelope:** define workflow/version, trigger kind, typed input, idempotency key, Room/workspace selection, linked Pibo Session IDs, actor, capability snapshot, and requested execution policy.
3. **Edge envelope:** default to explicit minimal values and content type; require registered adapters for incompatible ports and forbid implicit full-history transfer.
4. **Routing:** define deterministic guard evaluation, multi-edge choice, unsupported joins, judge-agent output, and terminal/cancel semantics.
5. **Session ownership:** each agent node uses a linked Pibo Session with immutable workflow/run/node identity and bounded input/output projection.
6. **Persistence:** durable facts own attempts, transfers, waits, retries, outputs, failures, and checkpoints; UI and XState views remain projections.
7. **Recovery:** define lease/heartbeat, idempotent resume, in-flight agent reconciliation, retry budget, wait expiry, cancellation, and non-idempotent node policy.
8. **External triggers:** webhook/Cron providers remain later slices with auth, replay, idempotency, rate limits, and delivery diagnostics.

## Execution and recovery phases

### Phase 1 — IR and validation closure

- Adopt the trigger shape and start/edge envelopes.
- Validate trigger presence, input schema, outgoing compatibility, adapters, guards, joins, profiles, and capabilities.
- Preserve loading and editing of older drafts through explicit migration or compatibility diagnostics.
- Add nonvisual editor controls and diagnostics for the chosen trigger representation.

### Phase 2 — Shared start and executor integration

- Route editor test and Session start through one orchestration-owned start contract.
- Reuse current kernel/runtime implementations for supported node kinds.
- Persist attempt and edge-transfer facts and link agent-node Pibo Sessions.
- Keep unsupported paths blocked with actionable diagnostics rather than partial execution.

Dependency: current Session-start idempotency and immutable configuration/version snapshots must remain intact.

### Phase 3 — Graph breadth and control flow

- Integrate adapters, guards, deterministic routing, human waits, nested workflows, joins, retries, and cancellation in bounded slices.
- Define output selection and failure propagation at each node and edge.
- Add explicit support matrices so UI only offers executable combinations.

### Phase 4 — Recovery and projection

- Persist checkpoints before externally visible transitions.
- Reconcile interrupted attempts, leases, waits, retries, and child Sessions after process restart.
- Resume only idempotent or explicitly recoverable operations; require operator-visible intervention otherwise.
- Project current and historical facts into Session and workflow views without making projections authoritative.

### Phase 5 — Later trigger providers

- Add webhook and scheduled trigger specifications before implementation.
- Enforce authentication, replay defense, idempotency, rate limits, secret handling, and delivery diagnostics.
- Reuse the same start envelope and executor; provider adapters do not fork runtime semantics.

## Acceptance and validation matrix

| Area | Acceptance criterion | Required evidence |
|---|---|---|
| IR | Trigger and edge forms round-trip, version, migrate, and reject incompatible graphs deterministically. | Workflow-package registry/validation tests. |
| Manual start | Editor and Session use one envelope; valid manual input starts once and invalid input cannot create a run. | Root API/service plus package tests. |
| Execution | Supported node and edge kinds record attempts/transfers and never pass implicit full history. | Mixed-node and ownership tests. |
| Routing | Guards, adapters, judge output, joins, and terminal paths produce explicit deterministic diagnostics. | Table-driven graph tests. |
| Recovery | Restart resumes or blocks according to checkpoint and idempotency policy without duplicate effects. | SQLite restart, fault-injection, lease, and retry tests. |
| Session integration | Immutable snapshots and one-run start semantics remain intact while graph advancement moves to orchestration ownership. | Workflow Session service and integration tests. |
| Security | Starts, actions, assets, profiles, and child Sessions enforce exact App Context and capability ownership. | Auth, capability, redaction, and cross-owner rejection tests. |
| UI | Forms, graph, raw IR, status, errors, waits, and outputs remain synchronized and accessible. | Deterministic UI tests, followed by separate headful evidence. |
| Validation accounting | Root product, workflow-package, browser, provider, and restart matrices are reported separately. | Commands and counts required by SPC-VAL-001. |

Canonical authority remains [SPC-ORCH-005](../specs/orchestration/workflow-framework-runtime-store.md), [SPC-ORCH-006](../specs/orchestration/workflow-catalog-and-session-execution.md), [SPC-WEB-008](../specs/web/jobs-and-workflows-ui.md), and [SPC-VAL-001](../specs/validation/validation-contract.md). The four Git-pinned packet files preserve historical rationale and unfinished-work lineage only.
