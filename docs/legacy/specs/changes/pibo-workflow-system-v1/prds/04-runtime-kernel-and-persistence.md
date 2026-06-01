# PRD: Pibo Workflow System V1 — Runtime Kernel and Persistence

**Status:** Draft  
**Created:** 2026-05-10  
**Related docs:** `../design-runtime-kernel.md`, `../design-framework-architecture.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: Pibo has session traces but no durable workflow execution kernel that can persist graph progress, node attempts, waits, retries, checkpoints, and edge transfers across restarts.
- **Proposed Solution**: Build a small durable runtime kernel backed by `pibo-workflows.sqlite` that executes compiled workflow plans, persists workflow facts at boundaries, supports replay/resume, and delegates work to node executors.
- **Success Criteria**:
  - SC-01: A workflow can resume after process restart without re-running completed node attempts.
  - SC-02: Completed, failed, waiting, retry-scheduled, and cancelled runs are inspectable from persisted records.
  - SC-03: Expired leases can be reclaimed without two workers owning the same active attempt.
  - SC-04: Retry backoff and human/runtime/child wakeups survive process restart.
  - SC-05: Edge transfers, checkpoints, node attempts, and workflow events reconstruct current workflow status for CLI and Chat Web.

## 2. User Experience & Functionality

- **User Personas**:
  - Operator who starts and inspects long-running workflows.
  - Developer debugging crash/restart and retry behavior.
  - Project user waiting on a durable human action.
  - Runtime engineer maintaining persistence and replay invariants.

- **User Stories**:
  - As an operator, I want failed runs to show failed node and error summary after restart so that I can diagnose them.
  - As a developer, I want node attempts to be first-class so that retries and idempotency are testable.
  - As a user, I want a waiting workflow to preserve my pending approval task after restart.
  - As an engineer, I want workflow persistence separate from normal session stores so that session history remains unchanged.

- **Acceptance Criteria**:
  - Workflow statuses: `pending`, `running`, `waiting`, `failed`, `completed`, `cancelled`.
  - Node attempt statuses: `pending`, `leased`, `running`, `waiting`, `retry_scheduled`, `failed`, `completed`, `skipped`, `cancelled`; if skipped nodes are not persisted as attempts, skipped state is still represented in events and UI/projection snapshots.
  - Runtime persists workflow start, node attempt start, node attempt result, edge transfer, wait, retry scheduling, failure, cancellation, checkpoint, and completion.
  - Kernel rehydration works from workflow run, latest checkpoint, node attempts, edge transfers, wakeups, and wait tokens without requiring XState snapshots.
  - Cancellation propagates to active attempts, child Pibo Sessions when allowed, and nested workflow runs, then records a cancellation event.

- **Non-Goals**:
  - Persisting arbitrary JavaScript call stacks.
  - Distributed multi-worker production scheduler in V1.
  - XState snapshot as the only replay/resume mechanism.
  - Moving normal session traces/tool calls/spans/transcripts into the workflow DB.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Runtime executors for Agent, code, workflow, adapter, and human nodes.
  - Existing Pibo session routing and run-control primitives for long-running work.
  - SQLite access for workflow-specific persistence.
  - Structured diagnostic/error model shared by CLI, UI, tests, and events.

- **Evaluation Strategy**:
  - Crash tests after workflow start, node completion, edge transfer, wait token creation, retry scheduling, and workflow completion.
  - Lease tests for active lease exclusion, heartbeat update, stale lease reclaim, and idempotent retry boundary.
  - Retry tests for fixed, linear, exponential, and none backoff policies.
  - Restart inspection tests for completed, failed, waiting, retry-scheduled, and cancelled runs.

## 4. Technical Specifications

- **Architecture Overview**:
  - Runtime executes only compiled plans.
  - Execution plans include definition id/version, compiled nodes, compiled edges, initial nodes, terminal nodes, loop policies, join policies, state policy, runnable queue seeds, checkpoint namespaces, and XState projection metadata.
  - The execution loop claims runnable work, loads state/checkpoint, leases node attempts, executes through executor, validates output, persists results, applies state, evaluates edges, creates edge transfers, enqueues next attempts, checkpoints, and emits events.
  - Runnable node selection requires available input, satisfied dependencies, passing guards, allowed loop iteration, availableAt <= now, and no active lease by another worker.
  - Kernel snapshots are authoritative; XState/UI snapshots are projections.

- **Integration Points**:
  - Workflow DB `pibo-workflows.sqlite` logical tables: `workflow_definition_snapshots`, `workflow_runs`, `workflow_events`, `workflow_node_attempts`, `workflow_edge_transfers`, `workflow_checkpoints`, `workflow_wakeups`, `workflow_wait_tokens`, `workflow_human_actions`.
  - Existing stores retain Pibo/Pi session data.
  - Events project to trace, Chat Web, CLI/debug, XState-like snapshots, and audit views.
  - Idempotency keys use run id, checkpoint namespace, graph path, node id, attempt number, and loop iteration; nested keys include parent run/node attempt.

- **Security & Privacy**:
  - Store only workflow-specific facts in workflow DB; do not duplicate full session transcript/tool stores unless explicitly required for workflow inspection.
  - Inputs, outputs, state, and edge payloads are persisted and must follow project/user ownership rules.
  - Leases, cancellation, and retry must not bypass environment/isolation policies.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: workflow_runs, workflow_events, node_attempts, basic checkpoints, start/complete/fail inspection.
  - v1.1: edge_transfers, wait_tokens, wakeups, retry scheduling, cancellation.
  - v1.2: stale lease reclaim, nested workflow linkage, compiled definition snapshots.
  - v2.0: distributed scheduler, advanced replay optimizations, external signal integrations.

- **Technical Risks**:
  - Re-running completed node work after crash; mitigate with persisted attempts, checkpoints, idempotency keys, and replay tests.
  - Lease race conditions; mitigate with transactional claim/update semantics and heartbeat expiry tests.
  - Workflow DB grows with payload size; mitigate with compact snapshots, payload references where needed, and retention policy later.
