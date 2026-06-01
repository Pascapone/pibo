# PRD: Pibo Workflow UI Authoring V2 — Project Session Selection and Snapshots

**Status:** Draft  
**Created:** 2026-05-11  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `README.md`

## 1. Executive Summary

- **Problem Statement**: Users need to configure a workflow-backed Project session before execution, but V1 links workflow runs to Projects after runtime start and does not define a normal-user creation flow.
- **Proposed Solution**: Add a Project session creation flow that selects a workflow version, captures allowed session-scoped values, creates an immutable configuration/effective-definition snapshot, and starts the workflow only after explicit user action.
- **Success Criteria**:
  - SC-01: Session creation lets the user set a session name, workflow id/version, input values, prompt overrides, model, thinking level, and fast mode.
  - SC-02: Creating the session persists a configured/not-started Project session and does not create a workflow run.
  - SC-03: Start creates exactly one workflow run for that Project session.
  - SC-04: The selected workflow cannot be changed after Project session creation.
  - SC-05: The run remains inspectable through a snapshot if the workflow definition later changes or is deleted.

## 2. User Experience & Functionality

- **User Personas**:
  - Pibo user creating a workflow-backed Project session.
  - Project collaborator inspecting why a run used specific prompts/model settings.
  - Runtime developer preserving execution and replay invariants.
  - QA engineer testing session lifecycle and immutability.

- **User Stories**:
  - As a Pibo user, I want to configure workflow input before start so that I can review the session setup.
  - As a Pibo user, I want workflow start to be explicit so that creating a session is safe.
  - As a collaborator, I want the run to show the workflow version and effective settings so that I can understand historical behavior.
  - As a runtime developer, I want an immutable snapshot so that deletion or edits do not break run inspection.

- **Acceptance Criteria**:
  - The Project session creation view appears in the main Project session content area.
  - The user selects a published workflow version from the global catalog.
  - The user can configure only allowed V2 session-scoped values: input, prompt overrides, model, thinking level, and fast mode.
  - Session-scoped configuration does not persist back to the workflow definition.
  - V2 rejects agent profile overrides, retry limit overrides, and arbitrary option overrides.
  - The selected workflow is immutable after session creation.
  - The Project session has states equivalent to configured, running, waiting, completed, failed, and cancelled.
  - The one-run-per-session rule does not forbid parallel node execution inside that run when the workflow definition allows it.
  - The runtime executes the effective snapshot, not a mutable live draft.
  - A configured/not-started Project session shows selected workflow id/version, configuration summary, validation state, explicit Start action, and empty run-history state.
  - If validation fails before Project session creation or before start, the UI blocks that action and shows diagnostics linked to the invalid input, override, schema, or missing reference.

- **Non-Goals**:
  - Project-wide workflow defaults.
  - Relinking an existing Project session to another workflow.
  - Multiple primary workflow runs per Project session.
  - Starting workflows from normal Sessions tab.
  - Workflow slash commands for start/run.
  - Session-scoped handler, adapter, guard, retry, or profile overrides in V2.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Workflow catalog/version APIs for selectable published workflows.
  - Input validation against workflow input ports and JSON Schema subset.
  - Prompt override editor and model/thinking/fast-mode selectors.
  - Project Session API to create configured workflow sessions.
  - Workflow runtime API to start a run from a snapshot.

- **Evaluation Strategy**:
  - Integration tests cover configured-session creation without run creation.
  - Start tests assert one run per Project session and reject second-start attempts while preserving allowed parallel node execution inside the run.
  - Immutability tests reject workflow id/version changes after session creation.
  - Snapshot tests verify the full V2 snapshot contract: identity fields, owner scope, base and effective workflow definitions, base/effective hashes, inputs, prompt overrides, workflow-wide model/thinking/fast-mode settings, prompt asset pins, validation result, Project id, Pibo Session id, and timestamp are persisted.
  - Create/start validation tests verify blocked actions show diagnostics and leave the session in the correct pre-run state.
  - Deleted-definition tests verify the historical run still renders snapshot data.

## 4. Technical Specifications

- **Architecture Overview**:
  - Project session creation resolves a published workflow version and prepares a configuration snapshot.
  - The snapshot records base workflow identity plus allowed session overrides and effective definition hash.
  - Explicit start validates the snapshot and creates the single workflow run.
  - Nested workflow runs and agent node sessions are linked below the primary Project session when execution creates them.
  - Prompt overrides are stored as node-id-keyed session configuration for nodes that are eligible for prompt override.
  - V2 prompt override eligibility is conservative and explicit:
    - The target node must resolve in the selected workflow version, have `kind: "agent"`, use `runtime: "pibo"`, and expose a direct `promptTemplate`.
    - The node must opt in through Workflow IR metadata with `metadata.sessionOverrides.prompt === true`.
    - Nodes using `promptBuilder`, nested workflow nodes, human nodes, code nodes, adapter nodes, guards, edges, and state mappings are not prompt-override eligible in V2.
    - A prompt override replaces only that eligible Agent node's prompt template in the effective session snapshot. It cannot change profile, tools, skills, context files, routing, retry, handler, adapter, guard, schema, or arbitrary options.
  - Model, thinking level, and fast mode are workflow-session-wide settings in V2. They are stored once on the session snapshot and apply to every Pibo Agent node session started by the primary workflow run or its nested workflow runs. V2 does not expose per-Agent-node model, thinking, or fast-mode overrides.
  - Configured-session fields are immutable after creation and before first start. The selected workflow id/version, input values, prompt overrides, model, thinking level, and fast mode cannot be edited in place; users create a new configured Project session when they need different values. Start still revalidates the stored snapshot before creating the one allowed run.

- **Snapshot Contract Decision**:
  - The V2 configuration/effective-definition snapshot stores an exact execution and inspection record, not a minimal pointer. It includes snapshot id, schema version, createdAt, createdBy/principal id, owner scope, Project id, Pibo Session id, workflow id/version/source/title/description/tags, base definition hash, effective definition hash, the immutable base `WorkflowDefinition`, the immutable effective `WorkflowDefinition`, input values, node-id-keyed prompt overrides, prompt override eligibility policy and eligible node ids, workflow-scoped model/thinking level/fast mode, prompt asset pins (`assetId`, `revisionId`, `contentHash`, `source`), creation validation diagnostics, and deleted-definition fallback display fields.
  - The effective definition applies only allowed prompt overrides before hashing. Model, thinking level, and fast mode remain workflow-scoped settings on the snapshot and do not mutate node IR.
  - Historical run views use the snapshot if the live workflow is archived, changed, missing, or tombstoned; snapshot visibility follows existing Project/session access rules.

- **API Route Contract Decision**:
  - `POST /api/chat/projects/:projectId/workflow-sessions` creates a configured/not-started workflow Project session and snapshot without creating a workflow run.
  - `GET /api/chat/projects/:projectId/workflow-sessions/:piboSessionId` returns configured-session or run state, selected workflow metadata, snapshot summary, validation state, run id/status when present, and deleted-definition display state when applicable.
  - `POST /api/chat/projects/:projectId/workflow-sessions/:piboSessionId/start` revalidates the stored snapshot and creates exactly one workflow run. Repeated start calls return the existing run with `alreadyStarted: true` and never create another run.
  - The generic Project-session update path may update non-workflow presentation fields such as title/archive state only. It must not update workflow id/version, input values, prompt overrides, model, thinking level, or fast mode.

- **Integration Points**:
  - Project service/session APIs for session name, Project id, Pibo Session id, workflow metadata, and configured state.
  - Workflow Registry for version lookup and definition hash.
  - Workflow runtime/store for start, run id, status, output, errors, events, and snapshots.
  - Chat Web Projects UI for creation, configuration review, start button, and run view.

- **Security & Privacy**:
  - Session creation and start require authenticated access to the Project/session context.
  - Snapshot payloads may include prompts, inputs, model settings, and outputs and must follow existing Project/Pibo Session visibility rules.
  - Snapshots should preserve inspectability without granting access to deleted live definitions beyond what the run already recorded.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Select published workflow, create configured session, snapshot base/effective data, explicit start.
  - v1.1: Prompt overrides, model/thinking/fast-mode selectors, richer input validation UI.
  - v1.2: Deleted-definition display, nested workflow links, and historical snapshot diff/inspection.

- **Technical Risks**:
  - Snapshot fields drift from implementation; mitigate by treating the snapshot contract above and `09-implementation-completeness-contract.md` Section 4.4 as normative and testing deleted-definition inspection.
  - Start accidentally runs twice; mitigate with unique run-per-session constraints and idempotent start behavior.
  - Session-scoped overrides mutate shared definitions; mitigate by storing overrides only in configuration snapshots.
