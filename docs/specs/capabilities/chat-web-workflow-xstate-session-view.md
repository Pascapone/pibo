# Spec: Chat Web Workflow XState Session View

**Status:** Draft
**Created:** 2026-05-11
**Updated:** 2026-05-17
**Controller / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code
**Related docs:** [Chat Web Projects Area](./chat-web-projects-area.md), [Chat Web Trace and Terminal View](./chat-web-trace-and-terminal-view.md), [Current workflow docs](../../project/workflows.md), [Workflow runtime foundation and manual trigger](../changes/workflow-runtime-foundation-manual-trigger/spec.md), [Legacy Pibo Workflow System V1](../../legacy/specs/changes/pibo-workflow-system-v1/spec.md)

## Why

Chat Web has a dedicated session-view plugin for workflow-backed Project Sessions. The current workflow system is still TypeScript-managed and read-only from the browser, but users need a visible projection that explains which Project Session is linked to a workflow run, what state the run appears to be in, and what final output or validation diagnostics can be inferred from the current trace.

This view must not imply that the browser owns workflow execution or edits workflow definitions. It is a UI projection over Project Session metadata, live session status, and trace data.

## Goal

Chat Web SHALL expose a read-only Workflow/XState session view that derives an XState-style UI model for workflow-backed Project Sessions while preserving the workflow kernel and Project Session records as the durable source of truth.

## Background / Current State

`src/apps/chat-ui/src/session-views/registry.tsx` registers two active session views: `terminal` and `workflow`. The workflow view is implemented in `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx`.

The view receives the selected `PiboProjectSession`, trace view, live selected-session status, session signals, workflow lifecycle events, and session tree data through shared `ChatSessionViewProps`. It treats a Project Session as workflow-backed when it has a `workflowRunId`, has state `workflow`, is configured/running/waiting/completed/failed/cancelled, or uses a workflow id other than `simple-chat`. It then builds a UI-only projection with graph states, configuration summary, definition link, nested-session links, pending human actions, run history, attempt/transfer/error summaries, and a JSON snapshot labeled `pibo.workflow.xstateUiModel`.

## Scope

### In Scope

- Session-view registration and fallback behavior for the Workflow tab.
- Detection of workflow-backed Project Sessions.
- Read-only Workflow/XState projection cards, configured-session execution shell, graph, node statuses, snapshot, final output, validation diagnostics, run inspection summaries, navigation links, and projection facts.
- Status derivation from Project Session archive/state fields and selected-session live status.
- Trace-derived final output and validation diagnostic extraction.
- Clear messaging that Project session inspection does not mutate Workflow IR; authoring belongs in the Workflows tab.

### Out of Scope

- Workflow creation or Workflow IR editing inside the Project session view.
- Durable workflow kernel design and persistence beyond the UI projection.
- Project creation, Project Session routing, and workspace behavior.
- Replacing the default terminal session view.

## Requirements

### Requirement: Workflow view is an explicit registered session view

The browser MUST register the Workflow view as a selectable session-view plugin without making it the default view.

#### Current

`chatSessionViewIds` contains `terminal` and `workflow`, `DEFAULT_CHAT_SESSION_VIEW_ID` is `terminal`, and `getChatSessionView()` falls back to the terminal view for unknown ids.

#### Target

Users can intentionally select the Workflow tab, while existing sessions continue to open in the terminal view unless the browser state chooses otherwise.

#### Acceptance

- The active session-view list contains `workflow` with label `Workflow`.
- The default session view remains `terminal`.
- Unknown or invalid view ids resolve to `terminal`.
- The dormant legacy trace view is not registered as an active session view.

#### Scenario: Unknown stored view id

- GIVEN browser storage contains an unsupported session view id
- WHEN Chat Web renders a selected session
- THEN it falls back to the terminal view instead of failing.

### Requirement: Non-workflow sessions show an empty projection state

The Workflow view MUST render a clear empty state when the selected session is not linked to workflow metadata.

#### Current

`WorkflowXStateSessionView` creates no model when `workflowProjectSession` is absent or does not satisfy workflow-backed detection. It shows either a loading message or a message that no Workflow/XState projection is available, while still rendering the workflow boundary notice.

#### Target

Users understand that normal chat sessions and simple Project Sessions may not have a workflow projection.

#### Acceptance

- A non-Project selected session shows no graph or fake workflow state.
- A simple-chat Project Session without `workflowRunId` and without state `workflow` shows the empty projection state.
- While trace data is loading, the message distinguishes loading from no projection.
- The read-only workflow boundary notice is still visible.

#### Scenario: Simple Project chat

- GIVEN a Project Session has workflow id `simple-chat` and no workflow run id
- WHEN the user opens the Workflow tab
- THEN the view says no Workflow/XState projection is available
- AND it does not fabricate workflow nodes.

### Requirement: Workflow-backed detection is metadata-driven

The Workflow view MUST treat a Project Session as workflow-backed only from Project Session metadata, not from arbitrary trace text.

#### Current

A session is workflow-backed when `workflowRunId` exists, state is `workflow` or one of the configured/run lifecycle states, or `workflowId !== "simple-chat"`.

#### Target

Trace content alone cannot make a normal session look like a workflow run.

#### Acceptance

- A Project Session with a workflow run id renders a workflow model.
- A Project Session with state `workflow`, `configured`, `running`, `waiting`, `completed`, `failed`, or `cancelled` renders a workflow model.
- A Project Session with workflow id other than `simple-chat` renders a workflow model.
- Trace nodes mentioning workflow terms do not create a workflow model without Project Session metadata.

#### Scenario: Linked workflow run

- GIVEN a Project Session stores `workflowRunId: "wr_1"`
- WHEN the Workflow tab renders
- THEN the projection summary includes the workflow id and shortened run id.

### Requirement: Projection status follows Project Session and live session state

The view MUST derive a bounded workflow node status from archive state, stored Project Session state, and selected-session live status.

#### Current

Archived sessions map to `cancelled`. State labels containing complete/done, fail/error, cancel, or wait/blocked map to `completed`, `failed`, `cancelled`, or `waiting`. A live selected-session status of `running` maps to an active running label, and `error` maps to failed.

#### Target

Workflow graph color, badges, and terminal states reflect the user's current visible session state without changing durable records.

#### Acceptance

- Archived Project Sessions display a cancelled-style projection.
- Stored completed/done states display completed terminal status.
- Stored failed/error states or selected-session error display failed terminal status.
- Stored waiting/blocked states display waiting status.
- Running selected sessions display an active session-actor state.

#### Scenario: Live error overlay

- GIVEN a workflow-backed Project Session has no explicit failed state
- AND the selected session status is `error`
- WHEN the Workflow tab renders
- THEN the projection status is failed
- AND the terminal event is `WORKFLOW.FAIL`.

### Requirement: UI snapshot is explicit, read-only, and non-authoritative

The projection MUST expose a JSON snapshot that identifies itself as a UI model and states that durable truth remains in Workflow IR, Project Session records, snapshots, and workflow run records.

#### Current

The snapshot uses `kind: "pibo.workflow.xstateUiModel"`, `schemaVersion: 1`, `projection.durableTruth: "kernel"`, `projection.exposesPrivatePayloads: false`, and `editing.enabled: false`. The boundary notice says Pibo Workflow IR is the source of truth, XState is projection-only, and authoring stays in the Workflows tab.

#### Target

Developers and users can inspect the projected state without mistaking it for the persisted workflow run record.

#### Acceptance

- The snapshot contains the workflow id and optional run id.
- The snapshot marks editing disabled.
- Projection facts show projection kind, schema, durable truth, private-payload policy, state count, transition count, and trace version or pending.
- The view includes a read-only boundary notice that routes authoring to the Workflows tab and keeps raw XState editing unavailable in Projects.

#### Scenario: Inspect read-only snapshot

- GIVEN a workflow-backed Project Session is selected
- WHEN the user opens the Workflow tab
- THEN the JSON snapshot names `pibo.workflow.xstateUiModel`
- AND states that Workflow IR authoring is outside the Project session view.

### Requirement: Configured-session execution context is visible

The Workflow view MUST expose configured/not-started workflow context, start readiness, linked definitions, nested sessions, and runtime summaries without mutating workflow definitions.

#### Current

The view renders a workflow execution shell, run inspection panel, navigation links, configuration summary, definition-link status, pending human actions, workflow lifecycle-derived run history, node attempts, edge transfers, and runtime errors when those inputs are available through `ChatSessionViewProps` and Project Session enrichment.

#### Target

Users can see whether a workflow Project Session is configured, started, waiting, linked to a live or snapshot-only definition, and associated with nested workflow/agent sessions before they decide what action to take elsewhere in the UI.

#### Acceptance

- A configured/not-started Project Session shows configuration summary and no current run attempts.
- A workflow-backed Project Session with pending human actions lists the available action refs and diagnostics without exposing arbitrary payloads.
- Definition links distinguish live workflow catalog definitions from snapshot-only deleted definitions.
- Nested workflow, agent-node, and subagent session links navigate through normal Project session routing.

#### Scenario: Configured workflow session is inspected

- GIVEN a Project Session has state `configured`, workflow id/version, configuration, and no workflow run id
- WHEN the Workflow tab renders
- THEN the execution shell shows it as configured/not-started
- AND the snapshot and facts remain read-only.

### Requirement: Final output is derived from completed trace content only

The view MUST show final workflow output only when the projected workflow status is completed and trace data contains an eligible completed output.

#### Current

`collectWorkflowFinalOutput()` returns nothing unless status is `completed`. It prefers the last completed `assistant.message` with output or summary, then falls back to the last completed non-user, non-reasoning node with output.

#### Target

The Workflow tab does not present partial, running, user-authored, or reasoning-only data as final workflow output.

#### Acceptance

- Running, failed, waiting, and cancelled projections do not show final output.
- A completed assistant message output is shown as source `assistant.message`.
- If no assistant message output exists, a completed non-user/non-reasoning node output may be shown.
- User messages and model reasoning nodes are not used as final workflow output.

#### Scenario: Completed assistant output

- GIVEN a completed workflow projection
- AND the trace contains a done assistant message with structured output
- WHEN the Workflow tab renders
- THEN the Final Output panel shows that output with source `assistant.message`.

### Requirement: Validation diagnostics are extracted conservatively

The view MUST surface validation-like errors from trace nodes and raw events while bounding duplicates and result size.

#### Current

Validation extraction scans flattened trace nodes for validation-like errors in `error`, `output`, or `summary`, scans raw event payloads through `diagnostics`, nested `error`, and selected payload/result fields to depth four, deduplicates by code/path/message, and shows at most eight diagnostics.

#### Target

Users see likely workflow validation failures without a noisy dump of every trace or event error.

#### Acceptance

- Diagnostics include message and optional code, path, and source when present.
- Non-validation-looking generic errors are ignored by the validation panel.
- Duplicate diagnostics with the same code, path, and message are shown once.
- The rendered validation list is capped at eight entries.

#### Scenario: Raw event diagnostics

- GIVEN a raw trace event payload contains `diagnostics` with validation messages
- WHEN the Workflow tab renders
- THEN the Validation panel lists those diagnostics once
- AND includes available code and path fields.

## Edge Cases

- Missing trace data still renders summary, graph, status list, snapshot, and projection facts with trace marked pending.
- Unknown Project Session state strings are displayed after replacing underscores and otherwise treated as active unless they match known completed, failed, cancelled, waiting, or blocked terms.
- A workflow run may be archived while live status is running; archive state wins and displays cancelled.
- Very long workflow ids, run ids, and session ids are shortened in visible badges but remain part of the input data.

## Constraints

- **Product Boundary:** The browser projection is not a workflow kernel, registry, or durable workflow store.
- **Compatibility:** The default terminal view and existing Project Session routes remain unchanged.
- **Security / Privacy:** The projection states that private payloads are not exposed; it uses only data already present in the authenticated Projects bootstrap and trace responses.
- **Performance:** The view flattens current trace nodes and scans raw events in memory for the selected session only.

## Success Criteria

- [ ] SC-001: The session-view registry lists `workflow`, keeps `terminal` as default, and falls back to `terminal` for invalid ids.
- [ ] SC-002: Non-workflow sessions show an empty Workflow/XState state without fabricated nodes.
- [ ] SC-003: Workflow-backed Project Sessions render summary, execution shell, run inspection, navigation links, graph, node statuses, JSON snapshot, result/validation panel, and projection facts.
- [ ] SC-004: Status mapping covers active, waiting, completed, failed, cancelled, archived, and live error/running inputs.
- [ ] SC-005: Final output appears only for completed projections and ignores user-message or reasoning-only nodes.
- [ ] SC-006: Validation diagnostics are deduplicated and capped.
- [ ] SC-007: The view clearly states that Project session inspection is read-only and Workflow IR authoring belongs in the Workflows tab.

## Assumptions and Open Questions

### Assumptions

- Project Session metadata is the only current source for deciding whether a session is workflow-backed.
- The core graph projection is intentionally small: entry, one session actor, and one terminal state; surrounding panels may summarize configured-session and run-inspection facts.
- Future workflow-kernel APIs may replace parts of the inferred trace-based projection.

### Open Questions

- Should the workflow projection model move from client-only derivation to a server-provided trace projection once the workflow kernel is durable?
- Should validation extraction use structured workflow event types instead of text heuristics when those events are available?
- Should the selected Workflow/Terminal view be session-scoped rather than browser-global?

## Traceability

| Requirement | Scenario / Story | Source Basis | Status |
|---|---|---|---|
| REQ-001 Workflow view is registered | Unknown stored view id | `src/apps/chat-ui/src/session-views/registry.tsx`, `src/apps/chat-ui/src/session-views/types.ts` | Implemented |
| REQ-002 Non-workflow empty state | Simple Project chat | `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx` | Implemented |
| REQ-003 Metadata-driven detection | Linked workflow run | `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx`, `src/apps/chat-ui/src/types.ts` | Implemented |
| REQ-004 Status derivation | Live error overlay | `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx`, `src/apps/chat-ui/src/App.tsx` | Implemented |
| REQ-005 Read-only snapshot | Inspect read-only snapshot | `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx` | Implemented |
| REQ-006 Configured-session execution context | Configured workflow session is inspected | `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx`, `src/apps/chat-ui/src/App.tsx`, `src/apps/chat/web-app.ts` | Implemented |
| REQ-007 Final output derivation | Completed assistant output | `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx` | Implemented |
| REQ-008 Validation diagnostics | Raw event diagnostics | `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx` | Implemented |

## Verification Basis

This spec was derived from the current implementation in `src/apps/chat-ui/src/session-views/registry.tsx`, `src/apps/chat-ui/src/session-views/types.ts`, `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx`, `src/apps/chat-ui/src/App.tsx`, `src/apps/chat-ui/src/types.ts`, and the related Project Session behavior specified in `docs/specs/capabilities/chat-web-projects-area.md`.
