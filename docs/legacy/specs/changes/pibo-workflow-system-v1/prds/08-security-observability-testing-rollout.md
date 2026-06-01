# PRD: Pibo Workflow System V1 — Security, Observability, Testing, and Rollout

**Status:** Draft  
**Created:** 2026-05-10  
**Related docs:** `../spec.md`, `../tasks.md`, `../references.md`, all workflow design docs

## 1. Executive Summary

- **Problem Statement**: A workflow system that can run agents, TypeScript handlers, nested workflows, adapters, and human actions creates security, privacy, observability, and operational risks if cross-cutting requirements are not explicit.
- **Proposed Solution**: Define release-wide security boundaries, trace/event contracts, diagnostic standards, validation gates, fixture coverage, manual checks, rollout phases, and rollback behavior for Pibo Workflow System V1.
- **Success Criteria**:
  - SC-01: `npm run typecheck` and workflow unit/persistence tests pass before V1 is considered implementation-complete.
  - SC-02: Fixtures cover one-node agent, mixed nodes, adapter, human wait, registry, debug serialization, nested workflow, and bounded review loop.
  - SC-03: Workflow records and events reconstruct current run status for CLI and Chat Web without exposing unauthorized data.
  - SC-04: Security tests verify workflows cannot bypass profile, tool, skill, context, session routing, or compute-worker policies.
  - SC-05: Rollback can disable workflow execution while preserving normal Pibo Sessions and workflow run records for inspection.

## 2. User Experience & Functionality

- **User Personas**:
  - Security reviewer assessing workflow boundaries.
  - QA engineer validating fixtures and persistence behavior.
  - Operator rolling out or disabling workflow execution.
  - Developer using diagnostics and traces to debug implementation.

- **User Stories**:
  - As a security reviewer, I want workflow nodes to obey existing Pibo boundaries so that workflows do not create a privileged path.
  - As a QA engineer, I want deterministic fixtures and validation commands so that the implementation can be verified repeatably.
  - As an operator, I want rollback to preserve normal sessions so that workflow failures do not break core Pibo usage.
  - As a developer, I want structured diagnostics and events so that implementation failures are actionable.

- **Acceptance Criteria**:
  - Workflow diagnostic shape includes code, message, optional path, nodeId, edgeId, severity, and hint.
  - Error families include definition, graph, interface, execution, retry-exhausted, adapter, and node-executor errors.
  - Workflow events include workflow started/waiting/completed/failed, node started/completed/failed, edge transferred, and checkpoint created at minimum.
  - Validation tasks include typecheck, workflow unit tests, persistence tests, manual one-node `pibo-agent`, manual two-workflow adapter composition, and manual bounded review/fix loop.
  - Rollback disables workflow execution and ignores workflow metadata in session routing while leaving normal sessions and persisted workflow records inspectable.

- **Non-Goals**:
  - New cross-user permission model in V1.
  - New general audit/compliance product beyond workflow event records.
  - Production distributed scheduler readiness before core V1 runtime invariants pass.
  - Marketplace approval and sandboxing for third-party workflow packages.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Existing Pibo auth/session/tool boundaries.
  - Structured output/schema validation for AI outputs.
  - Trace/event projection into Chat Web and CLI/debug.
  - Test fixtures and harness utilities under `packages/workflows/src/fixtures` and `src/testing`.

- **Evaluation Strategy**:
  - Validation suite must include accept/reject cases for all node kinds, port types, adapters, guards, joins, state policies, loops, waits, and registry refs.
  - Persistence suite must cover completed, failed, waiting, resumed, retry-scheduled, cancelled, nested child failure, and stale lease reclaim.
  - AI-output eval must verify structured outputs either conform to declared schema or fail before completion/downstream use.
  - Manual release checklist: run `npm run typecheck`, run workflow tests, run persistence tests, run one-node agent workflow, run adapter composition workflow, run bounded review loop.

## 4. Technical Specifications

- **Architecture Overview**:
  - Security boundaries are enforced at validation, capability validation, executor policy resolution, and runtime execution.
  - Observability is event-first: workflow events drive trace, UI, CLI/debug, XState projection, and audit views.
  - Testing uses graph/serialization/projection patterns from Graphlib/Graphology, durable replay patterns from OpenWorkflow, state/command/nested workflow patterns from LangGraphJS, and UI/workflow UX patterns inspired by Archon/XState.
  - Rollout is incremental and keeps normal Pibo Sessions unchanged.

- **Integration Points**:
  - Existing Pibo auth, owner scope, project/session routing, Agent Designer profiles, tools, skills, context files, compute workers, and trace/event contracts.
  - `pibo-workflows.sqlite` for workflow facts only.
  - CLI/debug and Chat Web/Projects UI for status and human actions.
  - Feature flag or equivalent operational switch for workflow execution enable/disable.

- **Security & Privacy**:
  - Workflows must not bypass normal session, tool, compute-worker, auth, profile, or project ownership policy.
  - Code nodes and adapters must be registered trusted handlers; arbitrary inline/user-uploaded code is out of scope.
  - Environment policies must be explicit when not inheriting caller/project/session environment.
  - Inputs, outputs, prompts, state, edge payloads, and human action payloads are sensitive workflow data and need existing visibility/storage protections.
  - Diagnostics should reveal enough to fix errors without leaking hidden payloads in normal UI.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP gate: typecheck, registry/authoring validation, one-node Agent workflow, basic persistence and inspect.
  - v1.1 gate: ports/edges/adapters/state/code nodes with unit tests and diagnostics.
  - v1.2 gate: human waits, nested workflows, restart/resume, Project UI/CLI controls, XState visualization.
  - v2.0 gate: visual editor, advanced scheduling, richer adapter/mapping features, package/marketplace story.

- **Technical Risks**:
  - Security bypass through workflow policy resolution; mitigate with capability validation and negative tests.
  - Observability payload leaks sensitive data; mitigate with privacy-aware projection and redaction where existing trace rules require it.
  - Incomplete tests leave restart/retry bugs; mitigate with crash/replay and lease tests before UI rollout.
  - Feature destabilizes normal sessions; mitigate with separate workflow DB, feature disable path, and no required workflow config for normal sessions.
