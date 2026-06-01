# PRD: Pibo Workflow System V1 — Human Actions, CLI, and Project UI

**Status:** Draft  
**Created:** 2026-05-10  
**Related docs:** `../spec.md`, `../design.md`, `../design-authoring-api.md`, `../design-runtime-kernel.md`, `../design-xstate-integration.md`

## 1. Executive Summary

- **Problem Statement**: Human approvals, workflow waits, and workflow inspection are not first-class product surfaces in Pibo, so long-running agent workflows cannot pause, resume, or be operated reliably.
- **Proposed Solution**: Add durable human wait tokens, registry-backed human actions, CLI/debug workflow commands, Projects tab actions, and a dedicated Web UI Workflow/XState visualization tab.
- **Success Criteria**:
  - SC-01: A human node persists a wait token before returning control and remains visible after process restart.
  - SC-02: Approve/reject/resume/cancel actions work through both CLI/debug and Projects tab for the same wait token model.
  - SC-03: Resume payloads validate against the human node schema before workflow execution continues.
  - SC-04: Chat Web shows workflow id, status, current node/state, node statuses, final output, validation errors, and available human actions.
  - SC-05: V1 exposes workflow inspection and visualization but not full workflow creation/editing UI.

## 2. User Experience & Functionality

- **User Personas**:
  - Project reviewer approving or rejecting workflow progress.
  - Operator using CLI/debug to manage workflows.
  - Pibo user monitoring a workflow-backed session.
  - Developer validating human wait behavior.

- **User Stories**:
  - As a reviewer, I want to approve or reject a workflow step in the Projects tab so that work can continue with an auditable decision.
  - As an operator, I want CLI commands to inspect and control workflows so that I can debug without UI dependence.
  - As a user, I want to see why a workflow is waiting or failed so that I know the next action.
  - As a developer, I want custom human actions registered through the Workflow Registry so that future actions do not change the wait-token model.

- **Acceptance Criteria**:
  - CLI/debug commands: `workflow list`, `workflow validate`, `workflow run`, `workflow inspect`, `workflow approve`, `workflow reject`, `workflow resume`, `workflow cancel` or equivalent command names in the existing CLI style.
  - No V1 XState CLI command is added.
  - Human action kinds include built-ins `approve`, `reject`, `resume`, and `cancel`; additional kinds are registered with `registerWorkflowHumanAction(...)`.
  - Wait tokens represent pending/open, resolved, expired, and cancelled states or accepted equivalents; executor results distinguish approved, rejected, submitted, and timed-out decisions when applicable.
  - Projects tab lists pending human actions for associated workflow/project/session and submits payloads with actor metadata.
  - Dedicated Web UI Workflow/XState tab shows visualization from projection data and current runtime snapshot.
  - Full visual creation/editing is explicitly deferred.

- **Non-Goals**:
  - Full workflow visual editor.
  - Cross-user sharing and permissions beyond existing Pibo local runtime rules.
  - Process-local callback-only human waits.
  - Raw XState JSON editing in UI.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Workflow wait token store and human action store.
  - CLI/debug command infrastructure.
  - Chat Web/Projects UI components.
  - Registry for human action definitions.
  - Schema validator for resume payloads.

- **Evaluation Strategy**:
  - Automated tests for wait token creation, listing, resume validation, approve/reject/cancel actions, timeout, and restart visibility.
  - UI-level test or manual validation that pending action appears in Projects tab and updates run state after submission.
  - CLI/manual test for approve/reject/resume/cancel on the same persisted wait token.
  - Negative tests for invalid payload, expired token, already-resolved token, unauthorized/invalid actor, and missing run.

## 4. Technical Specifications

- **Architecture Overview**:
  - Human node or `requestHumanInput` command creates a `workflow_wait_tokens` row and moves node/run to `waiting`.
  - UI/CLI submits `WorkflowHumanAction` with kind, waitTokenId, payload, and actor.
  - Runtime validates token status, action availability, schema, expiry, and run ownership before applying action.
  - Runtime routes approval, rejection, timeout, cancellation, invalid resume, and normal resume through declared normal/error/resume edges when present.
  - Accepted actions write `workflow_human_actions`, resolve token, emit events, and schedule wakeup/resume with correlation id and payload.
  - UI reads workflow run state, node attempts, events, wait tokens, and XState projection snapshot.

- **Integration Points**:
  - Workflow store tables: `workflow_wait_tokens`, `workflow_human_actions`, `workflow_wakeups`, `workflow_events`, `workflow_runs`.
  - Existing Project Session linkage via workflow run `project_id` and `pibo_session_id`.
  - Event stream for Chat Web live updates and trace timeline.
  - XState projection for visualization tab.

- **Security & Privacy**:
  - Human actions include actor metadata and must respect owner/project/session access rules.
  - Resume payloads may contain user data and must be stored under workflow privacy policy.
  - Resolved/expired tokens cannot be reused.
  - UI must not reveal prompts, payloads, or state beyond existing project/session visibility rules.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: CLI inspect/list/validate/run and persisted wait tokens with CLI resume.
  - v1.1: Projects tab human actions and run status surface.
  - v1.2: dedicated Workflow/XState visualization tab with node status and projection snapshot.
  - v2.0: visual workflow creation/editing and richer custom action UI.

- **Technical Risks**:
  - UI and CLI diverge; mitigate by using the same persisted wait token and action APIs.
  - Human waits are lost on restart; mitigate with durable tokens and restart tests.
  - Invalid resume payload corrupts state; mitigate by schema validation before token resolution/resume.
