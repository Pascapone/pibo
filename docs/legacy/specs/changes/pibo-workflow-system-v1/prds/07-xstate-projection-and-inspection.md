# PRD: Pibo Workflow System V1 — XState Projection and Inspection

**Status:** Draft  
**Created:** 2026-05-10  
**Related docs:** `../design-xstate-integration.md`, `../design-framework-architecture.md`, `../design-runtime-kernel.md`

## 1. Executive Summary

- **Problem Statement**: Pibo needs workflow visualization, inspection, actor modeling, guards, delays, and future editing support, but cannot make XState the canonical durable workflow model because Pibo owns runtime sessions, edge payloads, retries, waits, and persistence.
- **Proposed Solution**: Use XState as a real dependency for deterministic projection, visualization, inspection, simulation, and local orchestration support while keeping Pibo IR and kernel records authoritative.
- **Success Criteria**:
  - SC-01: A workflow projects to XState-compatible machine config without losing node ids, edge ids, guards, waits, final states, and actor refs.
  - SC-02: UI state can be reconstructed from kernel records without an XState snapshot.
  - SC-03: Agent, code, nested workflow, adapter, and human nodes appear as actors or states in projection.
  - SC-04: Inspection events cover actor created, event sent, transition, snapshot, action, child output, wait entered, and wait resumed.
  - SC-05: Snapshot tests are deterministic across representative workflow fixtures.

## 2. User Experience & Functionality

- **User Personas**:
  - User viewing workflow progress in Chat Web.
  - Developer debugging transitions, waits, and guards.
  - Future UI editor implementer.
  - Runtime engineer ensuring projection does not own durable truth.

- **User Stories**:
  - As a user, I want a visual workflow state view so that I understand what is running, waiting, failed, or complete.
  - As a developer, I want inspection events so that I can debug actor transitions and child outputs.
  - As a future editor implementer, I want XState projection metadata so that UI can display and later edit Pibo concepts.
  - As a runtime engineer, I want XState snapshots to be optional cache so that recovery remains Pibo-owned.

- **Acceptance Criteria**:
  - XState projection maps workflow definition to machine, nodes to states/invoked actors, edges to transitions, guards to named guards, human waits to waiting states, retry delays to delay states, nested workflows to child actors/machines, and completion/failure/cancel to terminal states.
  - Pibo defines a Pibo-owned actor interface with `start`, `send`, `stop`, `getSnapshot`, optional `persist`, optional `restore`, and optional `inspect`.
  - Snapshot kinds are `kernel`, `xstate`, and `ui`; kernel is authoritative.
  - XState context is a projection of global/local/edge state, not a replacement for workflow state records.
  - V1 UI edits no raw XState JSON and full workflow editing is deferred.

- **Non-Goals**:
  - XState as canonical IR, authoring API, durable persistence format, or complete audit log.
  - Collapsing global/local/edge state into one XState context blob.
  - Relying on in-memory XState timers for durable retry/wakeup behavior.
  - Exposing raw XState internals to workflow authors.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - `xstate` dependency for projection/local orchestration support.
  - Workflow compiler metadata to produce projection.
  - Runtime event stream and persisted records to produce machine snapshots.
  - Chat Web Workflow/XState tab visualization components.

- **Evaluation Strategy**:
  - Deterministic projection snapshot tests for one-node, mixed-node, adapter, human wait, nested workflow, state policy, fan-in, failure, and bounded-loop fixtures.
  - Reconstruction test verifies UI snapshot from kernel records when XState snapshot is deleted.
  - Inspection tests verify required event families emit with runId/actorId/nodeId/edgeId where applicable.
  - Human wait and retry delay tests verify durable store drives resume/wakeup, not process-local XState timer only.

## 4. Technical Specifications

- **Architecture Overview**:
  - Pibo IR is generated from TypeScript workflow definitions.
  - Compiler emits execution plan plus XState projection metadata.
  - Runtime emits workflow/inspection events and kernel snapshots.
  - XState projection is used for Web UI visualization, simulation, inspection streams, and local orchestration slices.
  - Kernel records remain recovery and audit truth.

- **Integration Points**:
  - `src/xstate` provides `projectToXState(definition)` and runtime snapshot projection helpers.
  - `src/runtime` emits inspection events such as `@pibo.workflow.actor.created`, `@pibo.workflow.event.sent`, `@pibo.workflow.transition`, `@pibo.workflow.snapshot`, `@pibo.workflow.action`, `@pibo.workflow.child.output`, `@pibo.workflow.wait.entered`, and `@pibo.workflow.wait.resumed`.
  - Chat Web consumes projection config, current machine snapshot, actor/child hierarchy, guard/action names, tags, descriptions, and metadata.

- **Security & Privacy**:
  - Projection must not expose private runtime payloads unless requested and authorized for debug.
  - UI snapshots are compact and lossy; sensitive inputs/outputs/payloads must follow existing visibility rules.
  - XState snapshots, if persisted, must be versioned and reconstructable from kernel records.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: deterministic machine config projection and snapshot tests.
  - v1.1: runtime snapshot projection and inspection events.
  - v1.2: Workflow/XState Web UI visualization tab.
  - v2.0: UI editing that writes Pibo nodes, edges, ports, adapters, guards, retries, and UI metadata.

- **Technical Risks**:
  - XState semantics leak into Pibo IR; mitigate by storing Pibo IR and generating XState projection.
  - UI recovery depends on optional XState snapshot; mitigate by reconstructing UI state from kernel records.
  - Type complexity grows too fast; mitigate with Pibo-owned actor and utility types.
