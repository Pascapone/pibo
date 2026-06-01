# PRD: Pibo Workflow System V1 — Product Overview

**Status:** Draft  
**Created:** 2026-05-10  
**Related docs:** `../proposal.md`, `../spec.md`, `../design.md`, `./README.md`

## 1. Executive Summary

- **Problem Statement**: Pibo can run routed agent sessions, but users cannot define, persist, inspect, or compose agent work as reusable typed workflows. Users must manually copy outputs between sessions, human approvals are not durable workflow primitives, and complex agent work lacks a shared execution contract.
- **Proposed Solution**: Build Pibo Workflow System V1: a TypeScript-defined workflow framework where the smallest unit is a normal Pibo Runtime Agent node, and larger workflows compose Agent, TypeScript code, nested workflow, adapter, and human nodes through typed edges with durable state and inspection.
- **Success Criteria**:
  - SC-01: A one-node `pibo-agent` workflow validates, starts, routes through normal Pibo Runtime, persists, and completes in automated and manual validation.
  - SC-02: Invalid JSON input and invalid JSON output for schema-bound workflows are rejected with structured diagnostics before downstream execution or completion.
  - SC-03: A composed workflow transfers output from node A to node B without manual copy/paste and records an inspectable edge transfer.
  - SC-04: A human approval workflow survives process restart and resumes only after validated approve/reject/resume/cancel action.
  - SC-05: Chat Web/Projects UI and CLI/debug can inspect run status, node statuses, waits, failures, validation errors, and final output from persisted workflow records.

## 2. User Experience & Functionality

- **User Personas**:
  - Pibo user who wants repeatable AI work instead of ad hoc chat sessions.
  - Developer who authors workflows in TypeScript and expects typed contracts, tests, and clear diagnostics.
  - Agent/operator who runs workflows from CLI/debug tools and needs inspectable status and recovery.
  - Project reviewer who approves, rejects, resumes, or cancels workflow waits in the Projects tab.
  - Future UI workflow author who will visualize and later edit Pibo workflow concepts.

- **User Stories**:
  - As a Pibo user, I want a workflow to run a normal Pibo Runtime agent so that workflow behavior matches normal sessions.
  - As a developer, I want to compose workflows with typed inputs and outputs so that data moves safely between steps.
  - As a reviewer, I want approval gates in the Projects tab so that human decisions are durable and auditable.
  - As an operator, I want CLI/debug inspection so that I can list, validate, run, inspect, approve, reject, resume, or cancel workflows.
  - As a product team, I want XState-backed visualization so that current run state is visible without making XState the persisted source of truth.

- **Acceptance Criteria**:
  - The minimal workflow definition requires only id, version, input, output, initial node, and one Agent node.
  - A workflow run records workflow id, version, definition hash, owner scope, status, input, output, current cursor/state, related Pibo Session id, timestamps, and failure details when applicable.
  - A Project UI surface shows workflow-backed session/run metadata, node list, current status, final output, validation errors, and available human actions.
  - CLI/debug commands exist for `list`, `validate`, `run`, `inspect`, `approve`, `reject`, `resume`, and `cancel`.
  - V1 has no full visual workflow editor and no workflow YAML/JSON import/export product surface.

- **Non-Goals**:
  - Clone LangGraph or use LangGraph as the runtime.
  - Build a full visual editor in V1.
  - Build a general data-pipeline DAG engine.
  - Allow invisible schema coercion or hidden agent-assisted adapters.
  - Use XState snapshots as durable execution truth.
  - Add marketplace packaging, cross-user sharing, or third-party node marketplace behavior in V1.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Existing Pibo Runtime/session routing for Agent nodes.
  - Agent Designer profiles, tools, skills, context files, and routing metadata.
  - Workflow Registry for workflows, handlers, adapters, guards, prompt assets, human actions, plugins, and capability metadata.
  - Structured output validation compatible with the OpenAI Structured Outputs / tool-calling JSON Schema subset.
  - CLI/debug and Chat Web integration for workflow inspection and human actions.

- **Evaluation Strategy**:
  - Run fixture workflows: one-node agent, two-node composition, adapter edge, mixed nodes, human wait/resume, nested workflow, bounded review loop.
  - Require 100% pass rate for validation fixtures that should accept/reject definitions.
  - Require restart/resume tests for completed, failed, waiting, and retry-scheduled workflow runs.
  - Require manual validation of one `pibo-agent` workflow and one composed workflow with explicit adapter.
  - Require diagnostics to include code, message, severity, and node/edge/path when applicable.

## 4. Technical Specifications

- **Architecture Overview**:
  - TypeScript authoring code creates canonical Workflow IR.
  - Workflow Registry resolves definitions and implementation refs.
  - Validator checks structure, ports, handlers, adapters, cycles, profiles, prompts, joins, and capabilities.
  - Compiler creates an execution plan and deterministic XState projection metadata.
  - Runtime kernel persists and executes runs through node executors.
  - Executors delegate to Pibo Runtime, registered TypeScript handlers, nested workflow runs, adapter handlers, or durable human waits.
  - Events and persisted records feed CLI/debug, Chat Web, trace views, and XState visualization.

- **Integration Points**:
  - `packages/workflows` package with `src/api`, `src/registry`, `src/types`, `src/validation`, `src/graph`, `src/compiler`, `src/runtime`, `src/store`, `src/xstate`, `src/fixtures`, and `src/testing`.
  - Fresh workflow DB/store `pibo-workflows.sqlite`.
  - Existing session stores for normal Pibo/Pi session history, traces, tool calls, spans, and transcripts.
  - Existing agent profile, tool, skill, context, plugin, event, CLI, and Chat Web systems.

- **Security & Privacy**:
  - Agent and code nodes must obey existing Pibo auth, tool, compute-worker, and session-routing boundaries.
  - TypeScript code nodes use registered handlers; arbitrary inline code is out of scope.
  - Workflow records may store inputs, outputs, prompts, state, and edge payloads subject to existing trace/privacy rules.
  - Workflows must not bypass profile/tool/skill permissions or compute-worker isolation policies.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: `packages/workflows`, registry, one-node Agent workflow, validation, workflow DB, CLI validate/run/inspect.
  - v1.1: text/JSON ports, edges, explicit adapters, code nodes, prompt builders, state policies, fixtures/tests.
  - v1.2: nested workflow nodes, human waits/actions, restart/resume, Project UI inspection.
  - v2.0: full UI authoring/editing, richer adapter forms, marketplace/package discovery, advanced parallel/cyclic semantics.

- **Technical Risks**:
  - Scope growth makes one-node workflows hard to author; mitigate by implementing minimal path first and keeping complexity opt-in.
  - Runtime/XState divergence makes UI misleading; mitigate with deterministic projection tests.
  - Hidden data coercion creates unsafe workflows; mitigate by rejecting incompatible edges without explicit adapters.
  - Restart/resume bugs re-run completed node work; mitigate with node attempts, checkpoints, idempotency keys, and crash tests.
