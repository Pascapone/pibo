---
type: Specification
title: Workflow Framework, Runtime, and Store
description: Defines the implemented workflow framework, runtime, and store contract and its current ownership, security,
  compatibility, and verification boundaries.
tags:
- orchestration
- workflows
status: stable
authority: normative
generated:
  by: openai-codex/gpt-5.6-sol
  at: '2026-09-05T10:02:49Z'
sources:
- resource: scope:Current implementation and tests at traceability.commit
  title: Integrated Workflow framework source and test evidence
implementation:
  state: current
  baseline_commit: 14cbaf0fd04cfa321674b570baeb40e543d957cb
  package: WP-04-ORCHESTRATION
  source_evidence: performed
  focused_test_execution: 144 Workflow package tests and the complete isolated root suite passed
  build_and_typecheck_execution: clean full build and all typechecks passed
  browser_execution: headed supported manual editor authoring, real provider execution, canonical inspection, and desktop/mobile fit passed
traceability:
  commit: 14cbaf0fd04cfa321674b570baeb40e543d957cb
  requirements:
  - id: ORCH-WF-001
    status: implemented
    sources:
    - path: packages/workflows/src/types/index.ts
      symbol: WorkflowDefinition
    - path: packages/workflows/src/types/index.ts
      symbol: WorkflowNodeDefinition
    - path: packages/workflows/src/types/index.ts
      symbol: WorkflowEdgeDefinition
    - path: packages/workflows/src/types/index.ts
      symbol: WorkflowDiagnostic
    - path: packages/workflows/src/registry/index.ts
      symbol: createWorkflowRegistry
    - path: packages/workflows/src/registry/index.ts
      symbol: registerWorkflowDefinition
    - path: packages/workflows/src/registry/index.ts
      symbol: registerProviders
    tests:
    - path: packages/workflows/src/testing/registry.test.ts
      name: rejects duplicate adapter registrations unless override is explicit
    - path: packages/workflows/src/testing/registry.test.ts
      name: registers and resolves extensible human actions
    - path: packages/workflows/src/testing/registry.test.ts
      name: validates fixed Agent Designer profile refs against the Workflow Registry when one is provided
    failures:
    - No inline executable code is part of IR; unknown/archived refs become diagnostics or resolution errors.
    confidence: high
  - id: ORCH-WF-002
    status: implemented
    sources:
    - path: packages/workflows/src/validation/index.ts
      symbol: validateWorkflow
    - path: packages/workflows/src/validation/index.ts
      symbol: validateWorkflowDefinitionSchemas
    - path: packages/workflows/src/validation/index.ts
      symbol: validateWorkflowInput
    - path: packages/workflows/src/validation/index.ts
      symbol: validateNodeOutput
    - path: packages/workflows/src/validation/graph-cycles.ts
      symbol: validateWorkflowGraphCycles
    - path: packages/workflows/src/validation/state-access.ts
      symbol: validateWorkflowGlobalStateWriteConflicts
    tests:
    - path: packages/workflows/src/testing/validation.test.ts
      name: rejects free graph cycles that are not bounded by an explicit loop policy
    - path: packages/workflows/src/testing/validation.test.ts
      name: rejects ambiguous concurrent global state writes without a merge policy
    - path: packages/workflows/src/testing/validation.test.ts
      name: rejects direct edges with incompatible source output and target input ports
    - path: packages/workflows/src/testing/validation.test.ts
      name: rejects object schemas that are not strict Structured Outputs objects
    failures:
    - Validation is diagnostic and non-executing; hidden LLM coercion and undeclared writes are not accepted as compatibility
      behavior.
    confidence: high
  - id: ORCH-WF-003
    status: implemented
    sources:
    - path: packages/workflows/src/store/schema.ts
      symbol: WORKFLOW_SQLITE_FILENAME
    - path: packages/workflows/src/store/schema.ts
      symbol: WORKFLOW_SQLITE_SCHEMA_VERSION
    - path: packages/workflows/src/store/schema.ts
      symbol: WORKFLOW_SQLITE_TABLES
    - path: packages/workflows/src/store/schema.ts
      symbol: installWorkflowSqliteSchema
    - path: packages/workflows/src/store/contracts.ts
      symbol: WorkflowRunStore
    - path: packages/workflows/src/store/contracts.ts
      symbol: WorkflowEventStore
    - path: packages/workflows/src/store/contracts.ts
      symbol: WorkflowCheckpointStore
    - path: packages/workflows/src/store/contracts.ts
      symbol: WorkflowWaitTokenStore
    - path: packages/workflows/src/store/index.ts
      symbol: SqliteWorkflowRunStore
    tests:
    - path: packages/workflows/src/testing/workflow-sqlite-schema.test.ts
      name: creates the workflow-specific pibo-workflows.sqlite schema
    - path: packages/workflows/src/testing/workflow-sqlite-schema.test.ts
      name: keeps normal session trace, transcript, tool-call, and span storage out of the workflow database
    - path: packages/workflows/src/testing/workflow-store-facts.test.ts
      name: persists workflow events, edge transfers, checkpoints, wakeups, waits, and state snapshots
    - path: packages/workflows/src/testing/workflow-run-inspection.test.ts
      name: builds an inspectable completed run summary after SQLite restart
    failures:
    - Store records are JSON-serialized canonical facts; Run lists can filter by `piboSessionId`, and all list filters are bounded.
    confidence: high
  - id: ORCH-WF-004
    status: implemented
    sources:
    - path: packages/workflows/src/runtime/manual-trigger.ts
      symbol: runManualTextTriggerWorkflow
    - path: packages/workflows/src/runtime/manual-trigger.ts
      symbol: validateManualTextTriggerRun
    - path: packages/workflows/src/runtime/agent-node.ts
      symbol: dispatchWorkflowAgentNode
    - path: packages/workflows/src/runtime/code-node.ts
      symbol: dispatchWorkflowCodeNode
    - path: packages/workflows/src/runtime/adapter-node.ts
      symbol: dispatchWorkflowAdapterNode
    - path: packages/workflows/src/runtime/human-node.ts
      symbol: dispatchWorkflowHumanNode
    - path: packages/workflows/src/runtime/nested-workflow-node.ts
      symbol: dispatchWorkflowNestedWorkflowNode
    - path: packages/workflows/src/runtime/retry.ts
      symbol: decideWorkflowNodeRetry
    - path: packages/workflows/src/runtime/state.ts
      symbol: WorkflowStateAccessViolation
    - path: packages/workflows/src/runtime/state.ts
      symbol: applyCodeNodePatches
    tests:
    - path: packages/workflows/src/testing/runtime-manual-trigger.test.ts
      name: keeps the explicit unsupported-join failure under Pibo-owned traversal
    - path: packages/workflows/src/testing/runtime-manual-trigger.test.ts
      name: runs long workflows without an external graph recursion limit
    - path: packages/workflows/src/testing/runtime-mixed-node-workflow.test.ts
      name: dispatches a validated mixed workflow through code, agent, human, adapter, and nested workflow nodes
    - path: test/workflow-manual-trigger-recovery.test.mjs
      name: manual workflow agent nodes wait for message_finished and use the final assistant message
    - path: test/workflow-manual-trigger-recovery.test.mjs
      name: manual workflow agent nodes use normal Sessions with workspace and stable workflow linkage
    failures:
    - Manual traversal persists canonical snapshots, Runs, attempts, and transfers, but it is not the general restart-resuming graph executor. Joins fail explicitly.
    confidence: high
  - id: ORCH-WF-005
    status: implemented
    sources:
    - path: packages/workflows/src/xstate/index.ts
      symbol: WORKFLOW_XSTATE_PROJECTION_VERSION
    - path: packages/workflows/src/xstate/index.ts
      symbol: WORKFLOW_XSTATE_UI_MODEL_VERSION
    - path: packages/workflows/src/xstate/index.ts
      symbol: projectWorkflowToXStateProjection
    - path: packages/workflows/src/xstate/index.ts
      symbol: createWorkflowXStateUiModel
    tests:
    - path: packages/workflows/src/testing/xstate-ui-model.test.ts
      name: exposes a compact Web UI model from the XState machine projection
    - path: packages/workflows/src/testing/xstate-ui-model.test.ts
      name: marks current wait, terminal, and retry-delay states from kernel snapshots or explicit active state ids
    failures:
    - Projection state cannot mutate execution truth and declares exposesPrivatePayloads=false.
    confidence: high
---
# Spec: Workflow Framework, Runtime, and Store


## Why

Workflow data and execution primitives need a stable boundary between serializable definitions, durable facts, dispatch behavior, and read-only projections.

## Goal

The workflow package defines the current IR, registry, validation, schema-v4 store, manual traversal, dispatch primitives, retries, waits, and deterministic XState/UI projections.

## Authority and ownership

- **Stable concept:** `SPC-ORCH-005`
- **Target path:** `docs/specs/orchestration/workflow-framework-runtime-store.md`
- **Authority:** integrated source and test evidence at `14cbaf0fd04cfa321674b570baeb40e543d957cb`.
- **Normative owner:** This document owns the public surfaces and behavior listed below. Generic reliability schemas, product/session topology, gateway authorization, runtime adapters, resource policy, and Web rendering remain owned by their linked specifications.
- **Evidence rule:** Package source and named-test locators resolve at `14cbaf0fd04cfa321674b570baeb40e543d957cb`; package source is unchanged through final integration `7ec71c2cca2108423002be0e7330d2a20c4c5b67`. The package suite, prior complete root suite, build, final source/typechecks, focused final tests, and scoped headed acceptance are separate evidence classes. Broader general executor acceptance remains pending.

## Public surfaces

- `@pasko70/pibo-workflows`
- `WORKFLOW_SQLITE_SCHEMA_VERSION=4`
- `pibo-workflows.sqlite`
- `Workflow-owned tables`
- `WorkflowDefinition`
- `WorkflowRun`
- `WorkflowEventRecord`
- `NodeAttempt`
- `EdgeTransfer`
- `WorkflowWaitToken`
- `WorkflowHumanActionRecord`

## Current implemented contract

### Ir Registry

Definitions are serializable typed graphs. Executable behavior is referenced through registered profiles/handlers/adapters/guards/prompt builders/human actions; duplicate registration rejects unless override is explicit. Implicit latest version uses string localeCompare, not semantic-version ordering.

### Validation

Returns structured diagnostics for strict JSON ports/schemas, graph node/edge/port compatibility, registry refs, archived profiles, ambiguous prompt sources, retry/loop policy, bounded guarded cycles, state declarations, and concurrent global writers.

### Store

Schema v4 installs definition/catalog records and durable run/event/attempt/transfer/checkpoint/wakeup/wait/action records. Store save/get/list methods are the durable interface.

### Runtime

Manual text traversal supports trigger/manual plus agent nodes, deterministic fan-out, output validation at source/target, no arbitrary recursion cap, and explicit unsupported joins. Separate dispatchers implement agent/code/adapter/human/nested primitives; mixed-node tests compose them, but there is no evidenced general integrated durable graph executor.

### Wait Retry Projection

Human dispatch creates durable pending wait tokens; action apply checks ownership, pending/expiry/offered registered action/schema and resumes/cancels. Retry decisions support fixed/linear/exponential delays. XState schema v1 and UI model v1 are deterministic inspection projections with durableTruth=kernel and no private payload exposure.

## Scope

### In scope

- @pasko70/pibo-workflows
- WORKFLOW_SQLITE_SCHEMA_VERSION=4
- pibo-workflows.sqlite
- Workflow-owned tables
- WorkflowDefinition
- WorkflowRun
- WorkflowEventRecord
- NodeAttempt
- EdgeTransfer
- WorkflowWaitToken
- WorkflowHumanActionRecord
- The current source-grounded behavior and its explicit limits.
- Cross-owner links needed to use the contract safely.

### Out of scope

- Unimplemented future workflow webhook or Cron triggers.
- A claim that manual traversal and separate dispatch primitives form a universal integrated, restart-resuming graph executor.
- Provider, browser, host, Windows, Pibo2, or real process-path guarantees not established by executed validation.

## Requirements

### Requirement: ORCH-WF-001

The package MUST expose a serializable workflow IR with typed workflow/node ports, explicit node and edge kinds, registered executable references, stable diagnostics, and duplicate-safe registry operations.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

No inline executable code is part of IR; unknown/archived refs become diagnostics or resolution errors.

#### Acceptance evidence

- Exact source evidence:
  - `packages/workflows/src/types/index.ts:348` — `WorkflowDefinition` (type_or_class)
  - `packages/workflows/src/types/index.ts:251` — `WorkflowNodeDefinition` (type_or_class)
  - `packages/workflows/src/types/index.ts:290` — `WorkflowEdgeDefinition` (type_or_class)
  - `packages/workflows/src/types/index.ts:481` — `WorkflowDiagnostic` (type_or_class)
  - `packages/workflows/src/registry/index.ts:29` — `createWorkflowRegistry` (exported_symbol)
  - `packages/workflows/src/registry/index.ts:76` — `registerWorkflowDefinition` (exported_symbol)
  - `packages/workflows/src/registry/index.ts:44` — `registerProviders` (exported_symbol)
- Exact named tests:
  - `packages/workflows/src/testing/registry.test.ts:72` — “rejects duplicate adapter registrations unless override is explicit”
  - `packages/workflows/src/testing/registry.test.ts:110` — “registers and resolves extensible human actions”
  - `packages/workflows/src/testing/registry.test.ts:165` — “validates fixed Agent Designer profile refs against the Workflow Registry when one is provided”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-WF-002

Validation MUST reject invalid strict schemas, incompatible/missing ports, unregistered handlers/adapters/guards/actions, undeclared or conflicting state access, invalid retries, and cycles lacking an explicit bounded guarded loop policy.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

Validation is diagnostic and non-executing; hidden LLM coercion and undeclared writes are not accepted as compatibility behavior.

#### Acceptance evidence

- Exact source evidence:
  - `packages/workflows/src/validation/index.ts:43` — `validateWorkflow` (exported_symbol)
  - `packages/workflows/src/validation/index.ts:47` — `validateWorkflowDefinitionSchemas` (exported_symbol)
  - `packages/workflows/src/validation/index.ts:91` — `validateWorkflowInput` (exported_symbol)
  - `packages/workflows/src/validation/index.ts:136` — `validateNodeOutput` (exported_symbol)
  - `packages/workflows/src/validation/graph-cycles.ts:6` — `validateWorkflowGraphCycles` (exported_symbol)
  - `packages/workflows/src/validation/state-access.ts:22` — `validateWorkflowGlobalStateWriteConflicts` (exported_symbol)
- Exact named tests:
  - `packages/workflows/src/testing/validation.test.ts:322` — “rejects free graph cycles that are not bounded by an explicit loop policy”
  - `packages/workflows/src/testing/validation.test.ts:538` — “rejects ambiguous concurrent global state writes without a merge policy”
  - `packages/workflows/src/testing/validation.test.ts:649` — “rejects direct edges with incompatible source output and target input ports”
  - `packages/workflows/src/testing/validation.test.ts:420` — “rejects object schemas that are not strict Structured Outputs objects”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-WF-003

Schema v4 and its store contracts MUST durably save and retrieve definition snapshots, identities, drafts, published versions, archive/tombstone state, Session links and snapshots, Runs, events, node attempts, edge transfers, checkpoints, wakeups, wait tokens, human actions, prompt assets, and lifecycle events in `pibo-workflows.sqlite`. Workflow Runs MUST link by `piboSessionId` and MUST NOT require another container identity.

**Confidence:** `medium`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

Store records are JSON-serialized facts; Run lists can filter by `piboSessionId`, and all list filters are bounded. No test in the designated six directly performs process-restart replay across all record classes.

#### Acceptance evidence

- Exact source evidence:
  - `packages/workflows/src/store/schema.ts:4` — `WORKFLOW_SQLITE_FILENAME` (constant)
  - `packages/workflows/src/store/schema.ts:5` — `WORKFLOW_SQLITE_SCHEMA_VERSION` (constant)
  - `packages/workflows/src/store/schema.ts:7` — `WORKFLOW_SQLITE_TABLES` (constant)
  - `packages/workflows/src/store/schema.ts:328` — `installWorkflowSqliteSchema` (exported_symbol)
  - `packages/workflows/src/store/contracts.ts:32` — `WorkflowRunStore` (type_or_class)
  - `packages/workflows/src/store/contracts.ts:73` — `WorkflowEventStore` (type_or_class)
  - `packages/workflows/src/store/contracts.ts:97` — `WorkflowCheckpointStore` (type_or_class)
  - `packages/workflows/src/store/contracts.ts:79` — `WorkflowWaitTokenStore` (type_or_class)
  - `packages/workflows/src/store/index.ts:170` — `SqliteWorkflowRunStore` (exported_symbol)
- Exact named tests:
  - `packages/workflows/src/testing/runtime-manual-trigger.test.ts:45` — “passes editor text input into one agent node as the complete prompt input”
  - `packages/workflows/src/testing/runtime-manual-trigger.test.ts:119` — “fans the same last source output out to parallel downstream agents”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-WF-004

The package MUST provide the implemented manual trigger traversal and agent/code/adapter/human/nested dispatch primitives, validate transferred payloads, persist dispatch facts when a store is supplied, enforce declared state access, and expose deterministic retry decisions; it MUST NOT be specified as a universal integrated restart-resuming graph executor.

**Confidence:** `medium`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

The recovery-named test verifies message completion/final-output handling, not crash restart resumption. Joins fail explicitly in manual traversal.

#### Acceptance evidence

- Exact source evidence:
  - `packages/workflows/src/runtime/manual-trigger.ts:82` — `runManualTextTriggerWorkflow` (exported_symbol)
  - `packages/workflows/src/runtime/manual-trigger.ts:281` — `validateManualTextTriggerRun` (exported_symbol)
  - `packages/workflows/src/runtime/agent-node.ts:67` — `dispatchWorkflowAgentNode` (exported_symbol)
  - `packages/workflows/src/runtime/code-node.ts:71` — `dispatchWorkflowCodeNode` (exported_symbol)
  - `packages/workflows/src/runtime/adapter-node.ts:61` — `dispatchWorkflowAdapterNode` (exported_symbol)
  - `packages/workflows/src/runtime/human-node.ts:60` — `dispatchWorkflowHumanNode` (exported_symbol)
  - `packages/workflows/src/runtime/nested-workflow-node.ts:91` — `dispatchWorkflowNestedWorkflowNode` (exported_symbol)
  - `packages/workflows/src/runtime/retry.ts:48` — `decideWorkflowNodeRetry` (exported_symbol)
  - `packages/workflows/src/runtime/state.ts:17` — `WorkflowStateAccessViolation` (type_or_class)
  - `packages/workflows/src/runtime/state.ts:84` — `applyCodeNodePatches` (exported_symbol)
- Exact named tests:
  - `packages/workflows/src/testing/runtime-manual-trigger.test.ts:178` — “keeps the explicit unsupported-join failure under Pibo-owned traversal”
  - `packages/workflows/src/testing/runtime-manual-trigger.test.ts:204` — “runs long workflows without an external graph recursion limit”
  - `packages/workflows/src/testing/runtime-mixed-node-workflow.test.ts:38` — “dispatches a validated mixed workflow through code, agent, human, adapter, and nested workflow nodes”
  - `test/workflow-manual-trigger-recovery.test.mjs:53` — “manual workflow agent nodes wait for message_finished and use the final assistant message”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-WF-005

XState and compact Web UI models MUST be deterministic derived projections of workflow definitions and kernel snapshots, identify projection schema version 1, keep kernel facts authoritative, and omit private payloads.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

Projection state cannot mutate execution truth and declares exposesPrivatePayloads=false.

#### Acceptance evidence

- Exact source evidence:
  - `packages/workflows/src/xstate/index.ts:48` — `WORKFLOW_XSTATE_PROJECTION_VERSION` (constant)
  - `packages/workflows/src/xstate/index.ts:50` — `WORKFLOW_XSTATE_UI_MODEL_VERSION` (constant)
  - `packages/workflows/src/xstate/index.ts:230` — `projectWorkflowToXStateProjection` (exported_symbol)
  - `packages/workflows/src/xstate/index.ts:300` — `createWorkflowXStateUiModel` (exported_symbol)
- Exact named tests:
  - `packages/workflows/src/testing/xstate-ui-model.test.ts:21` — “exposes a compact Web UI model from the XState machine projection”
  - `packages/workflows/src/testing/xstate-ui-model.test.ts:73` — “marks current wait, terminal, and retry-delay states from kernel snapshots or explicit active state ids”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

## Ownership links

- [`adapter-contract.md`](/specs/runtime/adapter-contract.md)
- [`generation-resources-and-portable-tools.md`](/specs/runtime/generation-resources-and-portable-tools.md)
- [`provider-model-controls.md`](/specs/runtime/provider-model-controls.md)
- [`reliability.md`](/specs/data/reliability.md)
- [`sessions-and-runtime-bindings.md`](/specs/data/sessions-and-runtime-bindings.md)
- [`agents-and-profiles.md`](/specs/resources/agents-and-profiles.md)
- [`native-and-curated-tools.md`](/specs/resources/native-and-curated-tools.md)
- Web workflow rendering is a projection and interaction surface; it does not replace this package's durable facts.

## Verification boundary

- Source/test baseline: `14cbaf0fd04cfa321674b570baeb40e543d957cb`.
- The clean full build, all typechecks, all 144 Workflow package tests, and the complete isolated root suite passed. The root suite reported 2,744 tests: 2,739 passed, 0 failed, and 5 skipped; exit 0.
- Headed Room workspace editing and inheritance, Workflow Session creation/start/inspection, desktop/mobile views, and a real normal Session `pwd` through `openai-codex` succeeded.
- Final integration `7ec71c2cca2108423002be0e7330d2a20c4c5b67` passed source checks, all typechecks, one added manual editor API test, and a 20-test routed-runtime/UI/manual/header matrix. Its whole-root rerun remains underway and is not claimed.
- Scoped headful acceptance proved UI authoring of a manual-trigger-to-agent graph, actual `openai-codex` execution in the selected Room workspace, completed canonical inspection with two attempts and one transfer, and desktop/mobile fit.
- General graph restart execution, joins, webhooks, and scheduled triggers remain known gaps. Raw-IR editing, publish, human-action submission, and job controls were not accepted headfully.
