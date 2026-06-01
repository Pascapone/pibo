# PRD: Pibo Workflow UI Authoring V2 — Project Run Inspection, Sidebar, and Human Actions

**Status:** Draft  
**Created:** 2026-05-11  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `README.md`, `../../pibo-workflow-system-v1/prds/06-human-actions-cli-project-ui.md`, `../../pibo-workflow-system-v1/prds/07-xstate-projection-and-inspection.md`

## 1. Executive Summary

- **Problem Statement**: Workflow runs create logical nodes, real Pibo Sessions, nested workflow runs, agent node sessions, and subagent sessions. Without clear Project navigation and run views, users cannot inspect execution or act on waits reliably.
- **Proposed Solution**: Make Projects the execution surface: the sidebar shows only real Pibo Sessions with visual type markers, selected session context chooses Workflow/XState or Terminal view, run history belongs to Project sessions, and human wait actions appear in workflow run views.
- **Success Criteria**:
  - SC-01: Project sidebar shows main workflow, nested workflow, agent node, and subagent sessions as real Pibo Sessions only.
  - SC-02: Code, human, adapter, edge, guard, and state elements are inspectable inside Workflow/XState views, not as sidebar sessions.
  - SC-03: Workflow and nested workflow sessions render Workflow/XState + run view; agent node and subagent sessions render Terminal view.
  - SC-04: Run views show status, current node, node attempts, edge transfers, output, errors, nested workflow links, and available human actions.
  - SC-05: Approve, reject, resume, and cancel actions validate persisted wait tokens and resume payloads before state changes.

## 2. User Experience & Functionality

- **User Personas**:
  - Project user inspecting workflow progress.
  - Reviewer resolving human approval or resume steps.
  - Agent-node user inspecting an underlying Terminal session.
  - Developer debugging nested workflows and subagent session trees.

- **User Stories**:
  - As a Project user, I want the sidebar to show only real sessions so that navigation matches persisted session identity.
  - As a Project user, I want workflow sessions to open graph/run views so that I can inspect workflow progress.
  - As a Project user, I want agent node sessions to open Terminal view so that I can read the agent transcript and tool activity.
  - As a reviewer, I want human actions in the run view so that I can respond without leaving the Project context.
  - As a debugger, I want nested workflow sessions visually distinct from agent and subagent sessions so that hierarchy is clear.

- **Acceptance Criteria**:
  - Projects do not use Room semantics for Workflow UI; Project is the top container.
  - Sidebar entries use icons or equivalent visual hints for main workflow, nested workflow, agent node, and subagent session types.
  - Non-session logical workflow elements appear only inside Workflow/XState/run views.
  - Runs link back to their workflow definition in the Workflows tab when the live or archived definition still exists and the user has access.
  - Deleted or missing definitions produce a clear snapshot-only `definition deleted` state and no broken live-definition link.
  - Configured/not-started workflow sessions show a pre-run state with configuration summary, validation state, Start action, and no current run attempts.
  - Pending human actions list available registered actions and payload requirements.
  - Invalid, missing, expired, already-resolved, or unauthorized wait-token/action refs are rejected with diagnostics.

- **Non-Goals**:
  - Showing logical workflow nodes as Project sidebar sessions.
  - Editing workflow definitions from the Project run view except through links to Workflows tab.
  - Treating XState snapshots as durable recovery truth.
  - New human action model separate from V1 wait tokens.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Workflow runtime/store APIs for run status, node attempts, edge transfers, wait tokens, human actions, events, output, and errors.
  - Pibo Session hierarchy data for parent/child Project session sidebar.
  - XState projection and run snapshot helpers for workflow display.
  - Terminal session view for agent node and subagent sessions.

- **Evaluation Strategy**:
  - UI tests verify sidebar session inclusion/exclusion and visual type markers.
  - View-routing tests verify workflow/nested workflow sessions open Workflow/XState view and agent/subagent sessions open Terminal view.
  - Human action tests verify approve, reject, resume, cancel, invalid payload, missing action ref, expired token, already-resolved token, and deleted-definition display.
  - Nested tests verify nested workflow and subagent session trees remain navigable.

## 4. Technical Specifications

- **Architecture Overview**:
  - Project sidebar reads real Pibo Session parent/child hierarchy and workflow/session kind metadata.
  - Workflow views combine V1 XState projection, kernel/run records, snapshots, and human wait state.
  - Terminal views render normal Pibo Session transcript/tool output for agent node and subagent sessions.
  - Human actions use the V1 persisted wait-token/action model.
  - Definition links use Workflows tab routes only when a live or archived definition/version remains available. Tombstoned or missing definitions render snapshot data from the Project session/run snapshot with a `definition deleted` badge, workflow id/version, effective definition hash, configuration summary, and no live-definition action.

- **Integration Points**:
  - Project service and Pibo Session Store for sidebar hierarchy and selected context.
  - Workflow store for run facts, wait tokens, human actions, events, snapshots, and deleted-definition fallback.
  - Chat Web Workflow/XState session view and Terminal session view.
  - Workflows tab for definition links.

- **Security & Privacy**:
  - Run view and Terminal view must enforce existing Project/session access rules.
  - Human action payloads and actor metadata are sensitive and must be persisted under workflow privacy rules.
  - UI projections must not reveal hidden prompt/input/output/state payloads beyond authorized debug surfaces.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Sidebar real-session filtering, view routing, run status panel, and definition links.
  - v1.1: Nested workflow session links, node attempt/edge transfer detail, and deleted-definition state.
  - v1.2: Human action controls, live refresh, richer error/output inspection, and nested/subagent UI tests.

- **Technical Risks**:
  - Sidebar shows logical nodes and confuses navigation; mitigate with real-Pibo-Session-only invariant and tests.
  - Workflow and Terminal view routing diverges; mitigate with explicit session kind mapping.
  - Human actions race or replay; mitigate with persisted token status validation and idempotent action handling.
