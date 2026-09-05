---
type: "Specification"
title: "Chat Web Jobs and Workflows UI"
description: "Defines the implemented Chat Web Jobs and Workflows UI contract, including its ownership, source/test/public/failure/accessibility/compatibility boundaries, and explicit evidence limits."
tags:
- web
- chat-web
status: "draft"
authority: "normative"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-05T07:15:00Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:upstream/dev refresh 39090b8850758293e69380a52bb7498d7c955bc2"
    title: "upstream/dev refresh source and named-test evidence"
implementation:
  state: "integration-reconciliation-required"
  baseline_commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  package: "WP-06+07-WEB"
  package_parent: "ba3c2d6611ce8d234f887135af605837333bf751"
  source_evidence: "previous baseline inspected; changed integration paths require final reconciliation"
  focused_test_execution: "unperformed for this change"
  build_typecheck_package_execution: "unperformed for this change"
  visual_provider_gateway_pibo2_execution: "unperformed"
traceability:
  commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  requirements:
    - id: "WEB-WORKFLOW-JOBS-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/CronArea.tsx"
          symbol: "CronArea"
        - path: "src/apps/chat-ui/src/LoopArea.tsx"
          symbol: "writableLoopRooms"
        - path: "src/apps/chat-ui/src/LoopArea.tsx"
          symbol: "LoopArea"
        - path: "src/apps/chat-ui/src/LoopArea.tsx"
          symbol: "LoopIdButton"
        - path: "src/apps/chat-ui/src/LoopArea.tsx"
          symbol: "LoopUsageSummary"
        - path: "src/apps/chat-ui/src/LoopArea.tsx"
          symbol: "GoalTokenAccountingNotice"
        - path: "src/apps/chat-ui/src/RalphArea.tsx"
          symbol: "RalphArea"
      tests:
        - path: "test/chat-ui-loop-area.test.mjs"
          name: "Loop UI displays active Goal time without wall-clock or paused-time totals"
        - path: "test/chat-ui-loop-area.test.mjs"
          name: "new Loop UI defaults to same-session goal mode and exposes legacy Ralph mode"
        - path: "test/chat-ui-loop-area.test.mjs"
          name: "Loop UI renders recursive model usage and reported cost"
        - path: "test/chat-ui-loop-area.test.mjs"
          name: "Loop UI draft shows uncached after Ralph-to-Goal switch while legacy Goals remain total"
        - path: "test/chat-ui-cron-area-copy.test.mjs"
          name: "Cron Schedule Builder uses consistent English preset and weekday labels"
      public:
        - "/api/chat/cron*"
        - "/api/chat/loop*"
        - "/api/chat/ralph*"
        - "/api/chat/workflows*"
        - "CronArea"
        - "LoopArea"
        - "RalphArea"
        - "WorkflowsArea"
        - "MinimalWorkflowsArea"
      failures:
        - "Failed/invalid job mutations remain visible and do not fabricate state; runtime stop/recovery belongs to orchestration."
        - "Accessibility/responsive boundary: Controls/status/accounting must be labeled and usable without color or pointer-only interaction."
        - "Compatibility boundary: Existing Ralph route is retained as a legacy-compatible surface."
      confidence: "high"
    - id: "WEB-WORKFLOW-AUTHORING-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/WorkflowsArea.tsx"
          symbol: "WorkflowsArea"
        - path: "src/apps/chat-ui/src/MinimalWorkflowsArea.tsx"
          symbol: "MinimalWorkflowsArea"
        - path: "src/apps/chat-ui/src/workflows/WorkflowGraphCanvas.tsx"
          symbol: "WorkflowGraphCanvas"
        - path: "src/apps/chat-ui/src/workflows/WorkflowRawIrEditor.tsx"
          symbol: "WorkflowRawIrEditor"
        - path: "src/apps/chat-ui/src/workflows/workflow-context-menu-keyboard.ts"
          symbol: "workflowContextMenuKeyAction"
      tests:
        - path: "test/chat-ui-workflow-graph-model.test.mjs"
          name: "workflow graph model projects nodes, edges, positions, and diagnostics"
        - path: "test/workflow-v2-state-mapping-ui.test.mjs"
          name: "Workflow Builder exposes simple state mapping dropdown controls"
        - path: "test/workflow-v2-state-mapping-ui.test.mjs"
          name: "Workflow Builder state edits stay in Pibo Workflow IR and run state validation"
        - path: "test/chat-ui-workflow-context-menu-accessibility.test.mjs"
          name: "workflow graph context menu owns focus and keyboard events"
        - path: "test/chat-ui-workflow-context-menu-accessibility.test.mjs"
          name: "workflow graph context menu key model covers navigation, dismissal, and invocation"
        - path: "test/chat-ui-workflow-edge-adapter-dialog.test.mjs"
          name: "workflow edge adapter chooser uses the shared accessible dialog lifecycle"
      public:
        - "/api/chat/cron*"
        - "/api/chat/loop*"
        - "/api/chat/ralph*"
        - "/api/chat/workflows*"
        - "CronArea"
        - "LoopArea"
        - "RalphArea"
        - "WorkflowsArea"
        - "MinimalWorkflowsArea"
      failures:
        - "Invalid raw/form/graph edits retain diagnostics and cannot silently publish or become runtime truth."
        - "Accessibility/responsive boundary: Graph relationships need nonvisual text/forms and focus order; visual acceptance is pending."
        - "Compatibility boundary: Pibo Workflow IR remains SPC-ORCH-005 authority."
      confidence: "high"
    - id: "WEB-WORKFLOW-LIFECYCLE-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/WorkflowsArea.tsx"
          symbol: "WorkflowBuilderLanding"
        - path: "src/apps/chat-ui/src/WorkflowsArea.tsx"
          symbol: "WorkflowsArea"
        - path: "src/apps/chat-ui/src/api-workflows.ts"
          symbol: "postWorkflowCreateDraft"
        - path: "src/apps/chat-ui/src/api-workflows.ts"
          symbol: "postWorkflowDraftPublish"
        - path: "src/apps/chat-ui/src/api-workflows.ts"
          symbol: "postWorkflowArchive"
        - path: "src/apps/chat-ui/src/api-workflows.ts"
          symbol: "deleteWorkflow"
      tests:
        - path: "test/workflow-v2-library-actions-ui.test.mjs"
          name: "Workflow Library renders source/status action metadata from catalog actions"
        - path: "test/workflow-v2-publish-gating-ui.test.mjs"
          name: "Workflow Builder publish panel gates publish on error diagnostics"
      public:
        - "/api/chat/cron*"
        - "/api/chat/loop*"
        - "/api/chat/ralph*"
        - "/api/chat/workflows*"
        - "CronArea"
        - "LoopArea"
        - "RalphArea"
        - "WorkflowsArea"
        - "MinimalWorkflowsArea"
      failures:
        - "Errors block publish; failed lifecycle mutations leave authoritative version state unchanged and visible."
        - "Accessibility/responsive boundary: Action/status names, confirmation, errors, and focus must be accessible."
        - "Compatibility boundary: Version/archive semantics remain SPC-ORCH-005/SPC-ORCH-006."
      confidence: "high"
    - id: "WEB-WORKFLOW-MANUAL-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat/workflow-manual-trigger-runtime.ts"
          symbol: "runWorkflowManualTextTrigger"
        - path: "src/apps/chat/workflow-manual-trigger-runtime.ts"
          symbol: "validateWorkflowManualTextTrigger"
        - path: "src/apps/chat/workflow-manual-trigger-runtime.ts"
          symbol: "emitMessageAndWaitForAssistant"
      tests:
        - path: "test/workflow-manual-trigger-recovery.test.mjs"
          name: "manual workflow agent nodes wait for message_finished and use the final assistant message"
        - path: "test/workflow-manual-trigger-recovery.test.mjs"
          name: "manual workflow preserves deterministic Pibo-owned fan-out execution"
        - path: "test/workflow-manual-trigger-recovery.test.mjs"
          name: "manual workflow keeps the explicit unsupported-join failure"
      public:
        - "/api/chat/cron*"
        - "/api/chat/loop*"
        - "/api/chat/ralph*"
        - "/api/chat/workflows*"
        - "CronArea"
        - "LoopArea"
        - "RalphArea"
        - "WorkflowsArea"
        - "MinimalWorkflowsArea"
      failures:
        - "Timeout/error/unsupported join must fail explicitly without inventing downstream outputs."
        - "Accessibility/responsive boundary: Waiting/failure/final-output UI needs stable textual status and later headful checks."
        - "Compatibility boundary: This is a bounded supported slice; workflow kernel owns execution/recovery."
      confidence: "high"
    - id: "WEB-WORKFLOW-SESSION-005"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/workflows/CreateWorkflowSessionDialog.tsx"
          symbol: "CreateWorkflowSessionDialog"
        - path: "src/apps/chat-ui/src/workflows/workflow-session-model.tsx"
          symbol: "isWorkflowLinkedSession"
        - path: "src/apps/chat-ui/src/api-workflows.ts"
          symbol: "getSessionWorkflow"
      source_inspected: true
      follow_up: "Bind final create, inspect, start, human-action, responsive, and headful tests at the integrated code commit."
      public: ["/api/chat/workflow-sessions", "/api/chat/sessions/:piboSessionId/workflow*", "Workflow Session view"]
      failures:
        - "Failed create, inspect, start, or human action remains visible and cannot fabricate Workflow progress."
        - "Workflow status and actions must be labeled and responsive."
      confidence: "medium"
---
# Chat Web Jobs and Workflows UI

## Why

Cron/Loop/Ralph controls, Workflow draft authoring, graph/forms/raw IR/assets/pickers, publish lifecycle, supported manual runs, and normal Session integration.

## Scope

This specification describes implemented behavior at upstream/dev refresh traceability commit `39090b8850758293e69380a52bb7498d7c955bc2`. Its package parent is accepted base `ba3c2d6611ce8d234f887135af605837333bf751`; the stale brief baseline is not authority.

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

Catalog and action metadata refresh the Workflow library and normal Session Workflow views. Workflow media and provider internals are outside this UI owner.

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

The currently supported manual text trigger MUST wait for message_finished and use the final assistant message, preserve deterministic Pibo-owned fan-out, and reject unsupported joins explicitly; it MUST NOT be described as proven restart recovery.

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

The Web UI MUST create a Workflow-backed normal Session in a selected Room and workspace, preserve chosen Workflow version, input, and eligible overrides, and expose true stored snapshot, Run, wait, action, attempt, and transfer facts in that Session's Workflow view. Start and human actions MUST use Session-scoped Workflow APIs without claiming Web-owned execution.

#### Current

The in-progress UI source defines this integration shape. Final source names, tests, and integrated code traceability still require reconciliation.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/workflows/CreateWorkflowSessionDialog.tsx` — `CreateWorkflowSessionDialog`; `src/apps/chat-ui/src/workflows/workflow-session-model.tsx` — `isWorkflowLinkedSession`; `src/apps/chat-ui/src/api-workflows.ts` — `getSessionWorkflow`
- Tests: final integrated test names require reconciliation.
- Public surfaces: `/api/chat/workflow-sessions`; `/api/chat/sessions/:piboSessionId/workflow*`; `CreateWorkflowSessionDialog`; normal Session Workflow view
- Failure/security boundary: Immutable configuration and failed start/link/action must remain visible; Web cannot claim full graph execution.
- Accessibility/responsive boundary: Workflow Session status and actions must be labeled and responsive.
- Compatibility boundary: Catalog/persistence/runtime/human-action semantics remain SPC-ORCH-005/SPC-ORCH-006.
- Confidence: **medium**
- Verification follow-up: Bind final tests and add headful Workflow Session create, start, wait-token action, error, refresh, and responsive scenarios.

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

- Evidence gap: No headful authoring, graph pointer/keyboard, raw editor, mobile sidebar, publish, job-control, or human-action path.
- Evidence gap: No end-to-end workflow recovery or external trigger evidence.

## Reconciled stale claims

- Reject: Workflow-backed work requires a separate container or Session class.
- Reject: The manual-trigger test proves restart recovery.
- Reject: Configured Session start executes the full Workflow graph in the Web layer.
- Reject: Raw editor state is independent execution truth.
- Reject: Webhook/Cron workflow triggers are already implemented.

## Verification and traceability

- Source and named-test locators resolve to regular files at upstream/dev refresh commit `39090b8850758293e69380a52bb7498d7c955bc2`.
- Imported or re-exported symbols use their canonical upstream/dev refresh definition files in traceability.
- Source inspection was performed for every requirement; five package requirements remain source-only exactly where no named test exists.
- Focused tests, the OKF validator suite, typecheck, build, package, diff, link/navigation, and archive-byte checks were run only after authoring and are reported outside this committed package.
- Headful visual/focus/keyboard/pointer/responsive/PWA/iframe/annotation/settings/VS Code acceptance was not performed.
- External provider, gateway restart/deployment, Pibo2, and real same-origin code-server acceptance was not performed.
- Confidence measures trace quality, not execution of an unclaimed evidence class.

Package verification commands:

- `cd /root/code/pibo-okf-docs && node --test test/chat-ui-loop-area.test.mjs test/chat-ui-cron-area-copy.test.mjs test/chat-ui-workflow-graph-model.test.mjs test/workflow-v2-library-actions-ui.test.mjs test/workflow-v2-publish-gating-ui.test.mjs test/workflow-manual-trigger-recovery.test.mjs`

## Related concepts

- SPC-ORCH-002
- SPC-ORCH-003
- SPC-ORCH-004
- SPC-ORCH-005
- SPC-ORCH-006
- SPC-WEB-002
- SPC-WEB-005
