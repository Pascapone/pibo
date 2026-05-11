# Spec: Chat Web Workflow Session View

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** [Chat Web Projects Area](./chat-web-projects-area.md), [Chat Web Trace and Terminal View](./chat-web-trace-and-terminal-view.md), [Chat Web Browser Shell State](./chat-web-browser-shell-state.md), [Pibo Workflow System V1](../changes/pibo-workflow-system-v1/spec.md)

## Why

Pibo now has a Projects area that can store workflow metadata on Project Sessions before the full workflow runtime is complete. Users still need a safe way to inspect workflow-linked sessions without implying that browser-side workflow creation or editing exists.

The Workflow session view is that read-only inspection surface. It presents a small XState-style UI projection from Project Session metadata, trace data, and live session state while keeping the durable workflow kernel and normal Pibo Session records as the authoritative sources.

## Goal

The Chat Web App SHALL expose a read-only Workflow session view that is selectable like other session views and renders workflow-backed Project Sessions as an inspectable, non-editable XState-style projection.

## Background / Current State

The session-view registry currently exposes two active view ids: `terminal` and `workflow`. The default view is `terminal`. The older nested Trace view remains inactive. Chat and Projects routes can carry `?view=terminal` or `?view=workflow`, and the app stores the last selected session view in browser local storage.

`WorkflowXStateSessionView` only builds a model when the selected Project Session is workflow-backed. A Project Session is treated as workflow-backed when it has a `workflowRunId`, has state `workflow`, or has a workflow id other than `simple-chat`. The view renders a summary, read-only notice, visual state flow, snapshot JSON, node statuses, final output, validation diagnostics, and projection facts.

## Scope

### In Scope

- Active Chat Session View registration for the Workflow view.
- Session-view selection and route/search persistence where it affects Workflow rendering.
- Workflow-backed Project Session detection.
- Read-only XState-style UI projection from Project Session, trace, and session status data.
- Empty-state behavior for non-workflow sessions.
- Final-output and validation-diagnostic extraction from the trace view.
- Explicit communication that workflow creation and editing are deferred.

### Out of Scope

- Workflow definition authoring, graph editing, and raw XState editing — explicitly deferred in the current UI.
- Durable workflow kernel storage and execution — covered by the Workflow System V1 change specs.
- The compact terminal transcript behavior — covered by Chat Web Trace and Terminal View.
- Projects CRUD and Project Session linking APIs — covered by Chat Web Projects Area.

## Requirements

### Requirement: Workflow is an active selectable session view

The system MUST register `workflow` as an active Chat Session View alongside the default `terminal` view.

#### Current

`listChatSessionViews()` returns `terminal` and `workflow`. `getChatSessionView()` falls back to the default `terminal` view when an unknown id is requested. The inactive `trace` view is not returned in the active list.

#### Acceptance

- The header view switcher lists `Terminal` and `Workflow`.
- Selecting `Workflow` calls the same session-view selection path as other views.
- Unknown session-view ids do not crash rendering and fall back to the default view.
- The inactive Trace view is not exposed as an active choice.

#### Scenario: Select Workflow view

- GIVEN the user is viewing a Chat Web session
- WHEN the user selects the `Workflow` view
- THEN the app renders the Workflow session view for the current session
- AND the terminal view is no longer the active rendered view.

### Requirement: Session view selection is route-addressable for session-capable areas

The system MUST preserve a valid selected session view in the route search state for Sessions and Projects navigation.

#### Current

The route parser accepts `view` from route search only when it matches the known session view ids. Navigation to Sessions and Projects routes includes the selected view in search state. The selected view is also stored under `pibo.chat.sessionView` when browser storage is available.

#### Acceptance

- `/apps/chat/rooms/<roomId>/sessions/<piboSessionId>?view=workflow` selects the Workflow view.
- `/apps/chat/projects/<projectId>/sessions/<piboSessionId>?view=workflow` selects the Workflow view.
- Invalid `view` values are ignored by route parsing.
- Browser storage failure does not prevent route-based view selection.

#### Scenario: Deep link to workflow project session

- GIVEN a Project Session route contains `?view=workflow`
- WHEN the Chat Web App loads that route
- THEN the app starts with the Workflow view selected
- AND no local-storage value overrides the valid route selection.

### Requirement: Non-workflow sessions show a read-only unavailable state

The Workflow view MUST avoid fabricating workflow data for sessions that are not linked to workflow metadata.

#### Current

`WorkflowXStateSessionView` returns an unavailable card when no `workflowProjectSession` is supplied or the supplied Project Session is not workflow-backed.

#### Acceptance

- A normal room session opened in the Workflow view shows that no Workflow/XState projection is available.
- A simple Project Session with workflow id `simple-chat`, no workflow run id, and non-`workflow` state shows the same unavailable state.
- The unavailable state still includes the V1 read-only/deferred notice.

#### Scenario: Normal chat session

- GIVEN a user opens a normal non-Project chat session
- WHEN the user switches to the Workflow view
- THEN the view says no Workflow/XState projection is available
- AND it does not show fake workflow nodes or edges.

### Requirement: Workflow-backed sessions produce a bounded UI projection

The Workflow view MUST derive a bounded projection from Project Session metadata, the selected trace view, and the selected session status.

#### Current

The current model contains workflow id, optional workflow run id, Pibo Session id, state label, status, optional trace title/version/latest stream id, three visual nodes, two visual edges, optional final output, validation errors, and a JSON snapshot with `kind: "pibo.workflow.xstateUiModel"` and `schemaVersion: 1`.

#### Acceptance

- Workflow-backed sessions render a summary card with workflow id, optional short run id, state, Pibo Session id, and latest stream id when available.
- The projection contains exactly one entry node, one session actor node, and one terminal node.
- The projection contains an entry-to-session transition and a session-to-terminal transition.
- The JSON snapshot marks the projection as UI state, marks durable truth as `kernel`, and states that private payloads are not exposed.

#### Scenario: Workflow child session is selected

- GIVEN a Project Session has `workflowRunId: "wfr_1"` and `state: "workflow"`
- WHEN the Workflow view renders it
- THEN the summary includes the workflow id and shortened run id
- AND the snapshot includes the linked Pibo Session id as an actor.

### Requirement: Status mapping is explicit and inspectable

The Workflow view MUST map Project Session state and selected session status into a small set of workflow node statuses.

#### Current

The view uses `idle`, `active`, `waiting`, `completed`, `failed`, and `cancelled`. Archived Project Sessions map to `cancelled`. State labels containing complete/done, fail/error, cancel, wait/blocked map to their corresponding statuses. A running selected session maps to `active`; other non-terminal workflow sessions currently remain active.

#### Acceptance

- Archived Project Sessions render cancelled status.
- Error session status or failure-like state text renders failed status.
- Waiting-like state text renders waiting status.
- Completion-like state text renders completed status.
- Active and terminal statuses are visible in graph nodes, node-status rows, and badges.

#### Scenario: Failed workflow state

- GIVEN a workflow-backed Project Session has a failure-like state label
- WHEN the Workflow view renders the graph
- THEN the session-to-terminal transition uses a failure event label
- AND the terminal node is styled and labeled as failed.

### Requirement: Final output is trace-derived and only shown for completed workflows

The Workflow view MUST show final output only when the workflow projection is completed and trace data contains a suitable completed output.

#### Current

The view scans flattened trace nodes from the end. It prefers a done `assistant.message` with `output` or `summary`, then falls back to another done non-user, non-reasoning node with `output`.

#### Acceptance

- Non-completed workflow projections show an empty final-output state.
- Completed workflows prefer the latest completed assistant output.
- Fallback output never uses user-message or model-reasoning nodes.
- Missing trace data does not crash the Workflow view.

#### Scenario: Completed assistant output

- GIVEN the workflow status is completed
- AND the trace contains a done assistant message with output
- WHEN the Workflow view renders Final Output
- THEN it renders that assistant output as structured JSON/text through the JSON renderer.

### Requirement: Validation diagnostics are extracted conservatively

The Workflow view MUST collect validation-like diagnostics from trace nodes and raw event payloads without dumping all raw payload data.

#### Current

The view checks node errors, outputs, summaries, and raw event payload fields such as diagnostics and error. It keeps messages that look validation-related, deduplicates by code/path/message, and limits displayed validation errors to eight.

#### Acceptance

- Validation-like node errors appear in the validation panel.
- Raw event diagnostics with message, code, and path appear with source metadata when present.
- Duplicate validation messages are shown once.
- At most eight validation errors are displayed.
- When no diagnostics exist, the panel states that none were found.

#### Scenario: Raw validation diagnostic

- GIVEN a trace raw event payload contains a diagnostics array with a validation message
- WHEN the Workflow view renders validation errors
- THEN that message appears in the validation panel
- AND unrelated raw payload fields are not displayed.

### Requirement: Workflow authoring controls remain deferred in V1

The Workflow view MUST clearly communicate that workflow creation, visual graph editing, and raw XState JSON editing are not available in V1.

#### Current

Every Workflow view state includes a read-only notice. The snapshot contains an `editing` object with creation, visual editing, and raw XState editing disabled/deferred.

#### Acceptance

- The view shows a read-only V1 workflow surface notice for both unavailable and workflow-backed states.
- The notice says creation and editing are deferred.
- No browser control in this view mutates workflow definitions, workflow graphs, or raw XState JSON.

#### Scenario: User opens Workflow view

- GIVEN any session is open
- WHEN the user opens the Workflow view
- THEN the UI states that creation and editing are deferred
- AND the view only inspects existing session and workflow linkage data.

## Edge Cases

- Route search may contain unsupported view ids; these must be ignored.
- Browser local storage may be unavailable; session view rendering must still work.
- A Project Session can be workflow-backed without a `workflowRunId` when its state is `workflow` or its workflow id is not `simple-chat`.
- Trace data may be loading, missing, paginated, or partially live-patched.
- Validation payloads may be nested; extraction is intentionally bounded by depth and result count.
- The current browser storage reader only restores `terminal` explicitly and otherwise falls back to the default; route search remains the reliable deep-link mechanism for `workflow`.

## Constraints

- **Compatibility:** The default session view remains `terminal`; existing links without `view=workflow` keep terminal behavior.
- **Security / Privacy:** The UI projection must not claim to expose private workflow payloads. Raw payloads remain available only through existing raw/debug surfaces, not through the Workflow projection by default.
- **Performance:** Projection building must stay bounded by using a small fixed graph and capped validation diagnostics.
- **Dependencies:** Workflow projection quality depends on Project Session metadata, Chat Web trace view data, and selected session status. It does not require the durable workflow kernel to be implemented in the browser.

## Success Criteria

- [ ] SC-001: The Chat Web header exposes `Terminal` and `Workflow` session-view buttons, with Terminal as the default.
- [ ] SC-002: Deep links with `?view=workflow` select the Workflow view for both room sessions and project sessions.
- [ ] SC-003: Non-workflow sessions show an unavailable Workflow/XState projection state without fabricated nodes.
- [ ] SC-004: Workflow-backed Project Sessions render summary, graph, node statuses, snapshot, final-output, validation, and projection-facts panels.
- [ ] SC-005: The Workflow view never offers workflow creation, visual editing, or raw XState editing controls in V1.

## Assumptions and Open Questions

### Assumptions

- A browser-side UI projection is useful before the durable workflow runtime and full kernel records are complete.
- Project Session metadata is sufficient to decide whether to show a workflow inspection view.
- The Workflow view may evolve from a minimal three-node projection to a kernel-backed graph without changing the session-view selection contract.

### Open Questions

- Should browser local storage restore `workflow` as a valid stored preference, or should Workflow remain deep-link/tab-session selected only?
- Should the Workflow view move projection construction into a shared tested module instead of keeping it in the React component file?
- Should future workflow-kernel records replace the current trace-derived final-output and validation extraction rules?

## Traceability

| Requirement | Scenario / Story | Source basis | Status |
|---|---|---|---|
| Workflow is an active selectable session view | Select Workflow view | `src/apps/chat-ui/src/session-views/registry.tsx`, `src/apps/chat-ui/src/session-views/types.ts`, `src/apps/chat-ui/src/App.tsx` | Draft |
| Session view selection is route-addressable | Deep link to workflow project session | `src/apps/chat-ui/src/main.tsx`, `src/apps/chat-ui/src/App.tsx` | Draft |
| Non-workflow sessions show unavailable state | Normal chat session | `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx` | Draft |
| Workflow-backed sessions produce bounded projection | Workflow child session is selected | `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx`, `src/apps/chat/data/project-service.ts` | Draft |
| Status mapping is explicit and inspectable | Failed workflow state | `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx` | Draft |
| Final output is trace-derived | Completed assistant output | `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx`, `src/shared/trace-types.ts` | Draft |
| Validation diagnostics are extracted conservatively | Raw validation diagnostic | `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx` | Draft |
| Workflow authoring controls remain deferred | User opens Workflow view | `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx`, `docs/specs/changes/pibo-workflow-system-v1/spec.md` | Draft |

## Verification Basis

This spec was written from the current workspace code, especially:

- `src/apps/chat-ui/src/session-views/types.ts`
- `src/apps/chat-ui/src/session-views/registry.tsx`
- `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/main.tsx`
- `src/apps/chat-ui/src/types.ts`
- `src/apps/chat/data/project-service.ts`
- `docs/specs/changes/pibo-workflow-system-v1/spec.md`
