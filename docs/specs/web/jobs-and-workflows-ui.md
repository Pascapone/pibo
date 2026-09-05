---
type: "Specification"
title: "Chat Web Jobs and Workflows UI"
description: "Defines the implemented Chat Web jobs, Workflow authoring, manual runs, and Session-native Workflow UI."
tags: ["web", "chat-web", "jobs", "workflows"]
status: "stable"
authority: "normative"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-05T08:51:15Z"
sources:
  - resource: "scope:Integrated implementation and tests at traceability.commit"
    title: "Chat Web jobs and Workflow UI implementation"
implementation:
  state: "current"
  baseline_commit: "14cbaf0fd04cfa321674b570baeb40e543d957cb"
  source_evidence: "performed"
  test_execution: "62 focused UI source tests and complete isolated root suite passed"
  build_typecheck_execution: "clean full build and all typechecks passed"
  browser_execution: "headed Workflow Session creation/start/inspection and desktop/mobile views passed; manual editor QA remains pending"
traceability:
  commit: "14cbaf0fd04cfa321674b570baeb40e543d957cb"
  requirements:
    - id: "WEB-WORKFLOW-JOBS-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/CronArea.tsx"
          symbol: "CronArea"
        - path: "src/apps/chat-ui/src/LoopArea.tsx"
          symbol: "LoopArea"
        - path: "src/apps/chat-ui/src/RalphArea.tsx"
          symbol: "RalphArea"
      tests:
        - path: "test/chat-ui-loop-area.test.mjs"
          name: "Loop UI displays active Goal time without wall-clock or paused-time totals"
        - path: "test/chat-ui-cron-area-copy.test.mjs"
          name: "Cron Schedule Builder uses consistent English preset and weekday labels"
      public: ["/api/chat/cron*", "/api/chat/loop*", "/api/chat/ralph*"]
      failures: ["Failed or invalid job mutations remain visible and do not fabricate state."]
      confidence: "high"
    - id: "WEB-WORKFLOW-AUTHORING-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/WorkflowsArea.tsx"
          symbol: "WorkflowsArea"
        - path: "src/apps/chat-ui/src/workflows/WorkflowGraphCanvas.tsx"
          symbol: "WorkflowGraphCanvas"
        - path: "src/apps/chat-ui/src/workflows/WorkflowRawIrEditor.tsx"
          symbol: "WorkflowRawIrEditor"
      tests:
        - path: "test/chat-ui-workflow-graph-model.test.mjs"
          name: "workflow graph model projects nodes, edges, positions, and diagnostics"
        - path: "test/workflow-v2-state-mapping-ui.test.mjs"
          name: "Workflow Builder state edits stay in Pibo Workflow IR and run state validation"
      public: ["/workflows", "Workflow editor"]
      failures: ["Invalid raw, form, or graph edits retain diagnostics and cannot silently publish."]
      confidence: "high"
    - id: "WEB-WORKFLOW-LIFECYCLE-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/api-workflows.ts"
          symbol: "postWorkflowDraftPublish"
        - path: "src/apps/chat-ui/src/api-workflows.ts"
          symbol: "deleteWorkflow"
      tests:
        - path: "test/workflow-v2-library-actions-ui.test.mjs"
          name: "Workflow Library renders source/status action metadata from catalog actions"
        - path: "test/workflow-v2-lifecycle-confirmation-ui.test.mjs"
          name: "Workflow Library renders deliberate archive and delete confirmation copy"
      public: ["/api/chat/workflows*", "Workflow library"]
      failures: ["Errors block publish; failed lifecycle mutations leave authoritative version state unchanged and visible."]
      confidence: "high"
    - id: "WEB-WORKFLOW-MANUAL-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat/workflow-manual-trigger-runtime.ts"
          symbol: "runWorkflowManualTextTrigger"
        - path: "src/apps/chat-ui/src/api-workflows.ts"
          symbol: "postWorkflowDraftManualTriggerRun"
      tests:
        - path: "test/workflow-manual-trigger-recovery.test.mjs"
          name: "manual workflow agent nodes wait for message_finished and use the final assistant message"
        - path: "test/workflow-manual-trigger-recovery.test.mjs"
          name: "manual workflow agent nodes use normal Sessions with workspace and stable workflow linkage"
        - path: "test/workflow-manual-trigger-recovery.test.mjs"
          name: "manual workflow preserves deterministic Pibo-owned fan-out execution"
      public: ["POST /api/chat/workflows/:workflowId/draft/run", "manual Workflow run"]
      failures: ["Timeout, error, unsupported shape, or unsupported join fails without inventing downstream output."]
      confidence: "high"
    - id: "WEB-WORKFLOW-SESSION-005"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/workflows/CreateWorkflowSessionDialog.tsx"
          symbol: "CreateWorkflowSessionDialog"
        - path: "src/apps/chat-ui/src/workflows/workflow-session-model.tsx"
          symbol: "createWorkflowHeaderSummary"
        - path: "src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx"
          symbol: "WorkflowXStateSessionView"
        - path: "src/apps/chat-ui/src/api-workflows.ts"
          symbol: "getSessionWorkflow"
      tests:
        - path: "test/workflow-v2-session-configured-ui.test.mjs"
          name: "Workflow Session dialog preserves supported configuration boundaries"
        - path: "test/workflow-session-header.test.mjs"
          name: "Workflow headers report canonical run state independently of ordinary Session activity"
        - path: "test/workflow-v2-session-run-checklist.test.mjs"
          name: "human action UI submits only actions offered by the inspection response"
      public: ["POST /api/chat/workflow-sessions", "GET /api/chat/sessions/:piboSessionId/workflow", "normal Session Workflow view"]
      failures: ["Invalid configuration, failed start, missing inspection, or rejected action stays visible and cannot imply execution progress."]
      confidence: "high"
---
# Chat Web Jobs and Workflows UI

## Why

Cron/Loop/Ralph controls, Workflow draft authoring, graph/forms/raw IR/assets/pickers, publish lifecycle, supported manual runs, and normal Session integration.

## Scope

This specification describes implemented behavior at integrated traceability commit `14cbaf0fd04cfa321674b570baeb40e543d957cb`.

### In scope

- Owns browser job and Workflow controls, authoring and projection UI, publish gating, supported manual-trigger UI, and Workflow-backed Session interaction.

### Out of scope

- SPC-ORCH-002/003/004 own Cron/Loop/Ralph runtime lifecycle.
- SPC-ORCH-005 owns workflow IR, validation, execution, waits, recovery, and version lifecycle.
- SPC-ORCH-006 owns the Workflow catalog and Session-linked persistence/start semantics.
- SPC-WEB-005 owns read-only workflow Session projection.

## Current behavior

### Routes and state

Method-specific job and workflow routes list/create/update/start/stop/remove drafts, versions, runs, and actions. Draft UI projects one IR through graph, forms, raw editor, assets, and pickers.

### Cache, stream, files, and media

Catalog and action metadata refresh the Workflow library and normal Session Workflow views. Configured start records a canonical `pending` Run but does not activate general graph execution. Header Workflow state comes from the Session's Workflow inspection response; ordinary Session activity never supplies or overrides that state. Workflow media and provider internals are outside this UI owner.

### Lifecycle and failure

Publish is gated on error diagnostics. Graph context menus own focus and keyboard navigation/dismissal/invocation, and edge-adapter selection uses the shared labelled dialog lifecycle. Job failures remain visible. The supported manual text slice waits for message_finished/final assistant, preserves deterministic fan-out, and explicitly rejects unsupported joins.

### Security

Same-origin mutation and App Context apply; raw IR does not grant runtime capabilities or secret access. Human-action tokens are resolved through preserved workflow APIs.

### Accessibility and responsive behavior

Job areas use labeled main regions/status, responsive sidebars at 980px, and bounded tables. Workflow search/listbox/status/form labels, context-menu keyboard ownership, and dialog lifecycle are source-defined. No headful evidence.

### Compatibility and integration

Loop includes Goal-mode accounting notices; Ralph remains a legacy route/area. Future webhook/Cron-trigger workflow execution is not current behavior.

## Requirements and invariants

### Requirement: WEB-WORKFLOW-JOBS-001

The Web UI MUST expose current Cron, Loop/Goal, and Ralph list/create/update/start/stop/remove controls, preserve writable Room choices, show failures/usage/accounting, and keep runtime lifecycle semantics with the orchestration owners.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/CronArea.tsx` — `CronArea`; `src/apps/chat-ui/src/LoopArea.tsx` — `writableLoopRooms`; `src/apps/chat-ui/src/LoopArea.tsx` — `LoopArea`; `src/apps/chat-ui/src/LoopArea.tsx` — `LoopIdButton`; `src/apps/chat-ui/src/LoopArea.tsx` — `LoopUsageSummary`; `src/apps/chat-ui/src/LoopArea.tsx` — `GoalTokenAccountingNotice`; `src/apps/chat-ui/src/RalphArea.tsx` — `RalphArea`
- Tests: `test/chat-ui-loop-area.test.mjs` — “Loop UI displays active Goal time without wall-clock or paused-time totals”; `test/chat-ui-loop-area.test.mjs` — “new Loop UI defaults to same-session goal mode and exposes legacy Ralph mode”; `test/chat-ui-loop-area.test.mjs` — “Loop UI renders recursive model usage and reported cost”; `test/chat-ui-loop-area.test.mjs` — “Loop UI draft shows uncached after Ralph-to-Goal switch while legacy Goals remain total”; `test/chat-ui-cron-area-copy.test.mjs` — “Cron Schedule Builder uses consistent English preset and weekday labels”
- Public surfaces: `/api/chat/cron*`; `/api/chat/loop*`; `/api/chat/ralph*`; `/api/chat/workflows*`; `CronArea`; `LoopArea`; `RalphArea`; `WorkflowsArea`; `MinimalWorkflowsArea`
- Failure/security boundary: Failed/invalid job mutations remain visible and do not fabricate state; runtime stop/recovery belongs to orchestration.
- Accessibility/responsive boundary: Controls/status/accounting must be labeled and usable without color or pointer-only interaction.
- Compatibility boundary: Existing Ralph route is retained as a legacy-compatible surface.
- Confidence: **high**
- Verification follow-up: Run Loop/Cron/Ralph UI and route tests; headfully exercise all controls, failures, loading states, and narrow sidebars.

### Requirement: WEB-WORKFLOW-AUTHORING-002

Workflow authoring MUST keep graph, forms, raw IR editor, asset references, node/edge configuration, and catalog pickers synchronized to one draft and surface validation diagnostics.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/WorkflowsArea.tsx` — `WorkflowsArea`; `src/apps/chat-ui/src/MinimalWorkflowsArea.tsx` — `MinimalWorkflowsArea`; `src/apps/chat-ui/src/workflows/WorkflowGraphCanvas.tsx` — `WorkflowGraphCanvas`; `src/apps/chat-ui/src/workflows/WorkflowRawIrEditor.tsx` — `WorkflowRawIrEditor`
- Tests: `test/chat-ui-workflow-graph-model.test.mjs` — “workflow graph model projects nodes, edges, positions, and diagnostics”; `test/workflow-v2-state-mapping-ui.test.mjs` — “Workflow Builder exposes simple state mapping dropdown controls”; `test/workflow-v2-state-mapping-ui.test.mjs` — “Workflow Builder state edits stay in Pibo Workflow IR and run state validation”
- Public surfaces: `/api/chat/cron*`; `/api/chat/loop*`; `/api/chat/ralph*`; `/api/chat/workflows*`; `CronArea`; `LoopArea`; `RalphArea`; `WorkflowsArea`; `MinimalWorkflowsArea`
- Failure/security boundary: Invalid raw/form/graph edits retain diagnostics and cannot silently publish or become runtime truth.
- Accessibility/responsive boundary: Graph relationships need nonvisual text/forms and focus order; visual acceptance is pending.
- Compatibility boundary: Pibo Workflow IR remains SPC-ORCH-005 authority.
- Confidence: **high**
- Verification follow-up: Run graph/state-mapping tests; add round-trip tests among forms/graph/raw IR and headfully validate keyboard/pointer editing.

### Requirement: WEB-WORKFLOW-LIFECYCLE-003

Workflow library actions MUST expose source/status metadata and implement draft, publish/version, archive, and delete UI with publish disabled while error diagnostics exist.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/WorkflowsArea.tsx` — `WorkflowBuilderLanding`; `src/apps/chat-ui/src/WorkflowsArea.tsx` — `WorkflowsArea`; `src/apps/chat-ui/src/api-workflows.ts` — `postWorkflowCreateDraft`; `src/apps/chat-ui/src/api-workflows.ts` — `postWorkflowDraftPublish`; `src/apps/chat-ui/src/api-workflows.ts` — `postWorkflowArchive`; `src/apps/chat-ui/src/api-workflows.ts` — `deleteWorkflow`
- Tests: `test/workflow-v2-library-actions-ui.test.mjs` — “Workflow Library renders source/status action metadata from catalog actions”; `test/workflow-v2-publish-gating-ui.test.mjs` — “Workflow Builder publish panel gates publish on error diagnostics”
- Public surfaces: `/api/chat/cron*`; `/api/chat/loop*`; `/api/chat/ralph*`; `/api/chat/workflows*`; `CronArea`; `LoopArea`; `RalphArea`; `WorkflowsArea`; `MinimalWorkflowsArea`
- Failure/security boundary: Errors block publish; failed lifecycle mutations leave authoritative version state unchanged and visible.
- Accessibility/responsive boundary: Action/status names, confirmation, errors, and focus must be accessible.
- Compatibility boundary: Version/archive semantics remain SPC-ORCH-005/SPC-ORCH-006.
- Confidence: **high**
- Verification follow-up: Run library/publish tests and route lifecycle tests; add conflict/retry/archive/delete confirmation and headful focus/error validation.

### Requirement: WEB-WORKFLOW-MANUAL-004

The currently supported manual text trigger MUST wait for `message_finished` and use the final assistant message, preserve deterministic Pibo-owned fan-out, route ordinary chat Sessions, persist canonical definition snapshots, Runs, attempts, and transfers, and reject unsupported joins explicitly. This bounded slice MUST NOT be described as the general restart-resuming graph executor.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat/workflow-manual-trigger-runtime.ts` — `runWorkflowManualTextTrigger`; `src/apps/chat/workflow-manual-trigger-runtime.ts` — `validateWorkflowManualTextTrigger`; `src/apps/chat/workflow-manual-trigger-runtime.ts` — `emitMessageAndWaitForAssistant`
- Tests: `test/workflow-manual-trigger-recovery.test.mjs` — “manual workflow agent nodes wait for message_finished and use the final assistant message”; `test/workflow-manual-trigger-recovery.test.mjs` — “manual workflow preserves deterministic Pibo-owned fan-out execution”; `test/workflow-manual-trigger-recovery.test.mjs` — “manual workflow keeps the explicit unsupported-join failure”
- Public surfaces: `/api/chat/cron*`; `/api/chat/loop*`; `/api/chat/ralph*`; `/api/chat/workflows*`; `CronArea`; `LoopArea`; `RalphArea`; `WorkflowsArea`; `MinimalWorkflowsArea`
- Failure/security boundary: Timeout/error/unsupported join must fail explicitly without inventing downstream outputs.
- Accessibility/responsive boundary: Waiting/failure/final-output UI needs stable textual status and later headful checks.
- Compatibility boundary: This is a bounded supported slice; workflow kernel owns execution/recovery.
- Confidence: **high**
- Verification follow-up: Execute manual-trigger tests and add separate process-restart recovery evidence under SPC-ORCH-005 before making recovery claims.

### Requirement: WEB-WORKFLOW-SESSION-005

The Web UI MUST create a Workflow-backed normal Session in a selected Room and workspace, preserve the chosen Workflow version, inputs, and eligible overrides, and expose stored snapshot, Run, wait, action, attempt, and transfer facts in that Session's Workflow view. Start MUST record or return one canonical `pending` Run and MUST present the API's explicit general-execution boundary. Header state MUST derive from Workflow inspection, independently of ordinary Session activity. Human actions MUST use the Session-scoped Workflow API.

#### Current

Integrated source and focused tests verify normal Session creation, explicit pending start, canonical inspection, inspection-derived headers, and offered human-action submission. Headful acceptance remains pending.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/workflows/CreateWorkflowSessionDialog.tsx` — `CreateWorkflowSessionDialog`; `src/apps/chat-ui/src/workflows/workflow-session-model.tsx` — `createWorkflowHeaderSummary`; `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx` — `WorkflowXStateSessionView`; `src/apps/chat-ui/src/api-workflows.ts` — `getSessionWorkflow`, `postWorkflowSessionStart`, `postWorkflowHumanAction`
- Tests: `test/workflow-v2-session-configured-ui.test.mjs` — “Workflow Session dialog preserves supported configuration boundaries”; `test/workflow-v2-session-configured-ui.test.mjs` — “configured Workflow Session starts explicitly from its normal Session view”; `test/workflow-session-header.test.mjs` — “Workflow headers report canonical run state independently of ordinary Session activity”; `test/workflow-v2-session-run-checklist.test.mjs` — “Workflow view renders canonical run inspection facts and immutable links”; `test/workflow-v2-session-run-checklist.test.mjs` — “human action UI submits only actions offered by the inspection response”
- Public surfaces: `POST /api/chat/workflow-sessions`; `GET /api/chat/sessions/:piboSessionId/workflow`; `POST /api/chat/sessions/:piboSessionId/workflow/start`; `POST /api/chat/sessions/:piboSessionId/workflow/human-actions`; normal Session Workflow view
- Failure/security boundary: Invalid immutable configuration, failed start/link/action, and unavailable inspection remain visible; the Web UI cannot claim full graph execution.
- Accessibility/responsive boundary: Workflow Session status and actions must be labeled and responsive.
- Compatibility boundary: Catalog, persistence, runtime, and human-action semantics remain SPC-ORCH-005/SPC-ORCH-006.
- Confidence: **high**
- Verification follow-up: Add headful Workflow Session create, start, wait-token action, error, refresh, and responsive scenarios.

## Interfaces and ownership

**Capability IDs:** pibo.chat-web.jobs-workflows

**Public surfaces:**

- /api/chat/cron*
- /api/chat/loop*
- /api/chat/ralph*
- /api/chat/workflows*
- CronArea
- LoopArea
- RalphArea
- WorkflowsArea
- MinimalWorkflowsArea

**Non-owned links:**

- SPC-ORCH-002/003/004 own Cron/Loop/Ralph runtime lifecycle.
- SPC-ORCH-005 owns workflow IR, validation, execution, waits, recovery, and version lifecycle.
- SPC-ORCH-006 owns the Workflow catalog and Session-linked persistence/start semantics.
- SPC-WEB-005 owns read-only workflow Session projection.

## Failure and security behavior

- Publish is gated on error diagnostics. Job failures remain visible. The supported manual text slice waits for message_finished/final assistant, preserves deterministic fan-out, and explicitly rejects unsupported joins.
- Same-origin mutation and App Context apply; raw IR does not grant runtime capabilities or secret access. Human-action tokens are resolved through preserved workflow APIs.

Web browser state, caches, projections, overlays, annotations, and iframe presence do not grant authorization or become durable product authority.

## Accessibility and responsive behavior

Job areas use labeled main regions/status, responsive sidebars at 980px, and bounded tables. Workflow search/listbox/status/form labels are source-defined. No headful evidence.

Source-defined DOM, CSS, and ARIA are implementation evidence only. They do not constitute headful focus, keyboard, pointer, zoom, responsive, screen-reader, PWA, iframe, annotation, or settings acceptance.

## Compatibility and integration behavior

Loop includes Goal-mode accounting notices; Ralph remains a legacy route/area. Future webhook/Cron-trigger workflow execution is not current behavior.

## Known limits

- Evidence gap: No completed headful authoring, graph pointer/keyboard, raw editor, publish, job-control, or human-action path; manual editor QA remains underway.
- Evidence gap: No general arbitrary-graph restart recovery, join, webhook, or scheduled-trigger evidence.

## Reconciled stale claims

- Reject: Workflow-backed work requires a separate container or Session class.
- Reject: The manual-trigger test proves restart recovery.
- Reject: Configured Session start executes the full Workflow graph in the Web layer.
- Reject: Raw editor state is independent execution truth.
- Reject: Webhook/Cron workflow triggers are already implemented.

## Verification and traceability

- Source and named tests are bound to integrated commit `14cbaf0fd04cfa321674b570baeb40e543d957cb`.
- The clean full build, all typechecks, the UI delegate's 62 focused source tests, and complete isolated root suite passed. The root suite reported 2,744 tests: 2,739 passed, 0 failed, and 5 skipped; exit 0.
- Headed Workflow Session creation/start/inspection and desktop/mobile views passed. A real normal Session `pwd` through `openai-codex` also succeeded.
- Manual editor QA remains underway. Desktop PWA, gateway deployment, and Pibo2 acceptance are not claimed.

## Related concepts

- SPC-ORCH-002
- SPC-ORCH-003
- SPC-ORCH-004
- SPC-ORCH-005
- SPC-ORCH-006
- SPC-WEB-002
- SPC-WEB-005
