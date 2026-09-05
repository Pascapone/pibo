---
type: "Specification"
title: "Workflow Catalog, Publishing, and Session Execution"
description: "Defines the implemented Workflow catalog, publishing, Session linkage, run inspection, wait, and human-action contract."
tags: ["orchestration", "workflows", "sessions"]
status: "draft"
authority: "normative"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-05T07:15:00Z"
sources:
  - resource: "scope:remove-projects integration source pending final commit reconciliation"
    title: "Workflow catalog and Session-native integration"
implementation:
  state: "integration-reconciliation-required"
  baseline_commit: "9932bbd8a85fa68617216346f10b3836bb706fe3"
  source_evidence: "In-progress storage and API sources inspected; final route wiring and migration remain pending"
  test_execution: "unperformed"
  browser_execution: "unperformed"
traceability:
  commit: "9932bbd8a85fa68617216346f10b3836bb706fe3"
  requirements:
    - id: "ORCH-WFP-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat/workflow-persistence.ts"
          symbol: "ChatWorkflowDraftStore"
        - path: "src/apps/chat/workflow-catalog.ts"
          symbol: "buildWorkflowCatalogList"
        - path: "packages/workflows/src/store/schema.ts"
          symbol: "installWorkflowSqliteSchema"
      source_inspected: true
      follow_up: "Bind final catalog migration tests and update the traceability commit after integration."
      public: ["/api/chat/workflows*", "pibo-workflows.sqlite"]
      failures:
        - "Invalid definitions cannot publish, and deletion preserves immutable historical snapshots and tombstones."
      confidence: "medium"
    - id: "ORCH-WFP-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat/chat-api-routes.ts"
          symbol: "sessionWorkflowResource"
        - path: "src/apps/chat/workflow-sessions.ts"
          symbol: "normalizeWorkflowSessionConfiguration"
        - path: "src/apps/chat/workflow-manual-trigger-runtime.ts"
          symbol: "runWorkflowManualTextTrigger"
      source_inspected: true
      follow_up: "Reconcile final route-handler symbols and bind exact API and manual-trigger tests at the integrated commit."
      public: ["POST /api/chat/workflow-sessions", "GET /api/chat/sessions/:piboSessionId/workflow", "POST /api/chat/sessions/:piboSessionId/workflow/start"]
      failures:
        - "Invalid workflow selection, input, overrides, or unsupported manual graph shapes fail before fabricated execution state is returned."
      confidence: "medium"
    - id: "ORCH-WFP-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/workflow-session-service.ts"
          symbol: "ChatWorkflowSessionService"
        - path: "src/apps/chat/data/workflow-session-model.ts"
          symbol: "PiboWorkflowSessionLink"
        - path: "src/apps/chat/workflow-sessions.ts"
          symbol: "createWorkflowSessionSnapshot"
      source_inspected: true
      follow_up: "Bind the final create, inspect, idempotent-start, canonical-store, and upgrade-migration tests and integrated commit."
      public: ["PiboWorkflowSessionLink", "WorkflowRun", "workflow_session_links", "workflow_session_snapshots"]
      failures:
        - "Mismatched Session, workflow, version, snapshot, or run identity fails without changing immutable selection or creating a second run."
      confidence: "medium"
    - id: "ORCH-WFP-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/workflow-session-service.ts"
          symbol: "resolveWorkflowHumanAction"
        - path: "src/apps/chat/workflow-human-actions.ts"
          symbol: "validateWorkflowHumanActionRequest"
        - path: "packages/workflows/src/store/index.ts"
          symbol: "SqliteWorkflowRunStore"
      source_inspected: true
      follow_up: "Bind final wait/action API, schema-validation, replay, expiry, and transaction tests at the integrated commit."
      public: ["POST /api/chat/sessions/:piboSessionId/workflow/human-actions", "WorkflowWaitToken", "WorkflowHumanActionRecord"]
      failures:
        - "Unknown, cross-Session, expired, replayed, unregistered, unoffered, or schema-invalid actions fail without resuming the run."
      confidence: "medium"
---

# Scope

This specification owns the Workflow catalog, drafts, publishing, assets, lifecycle facts, workflow-to-Session links, configured starts, run inspection, waits, and human actions. [SPC-ORCH-005](/specs/orchestration/workflow-framework-runtime-store.md) owns Workflow IR, runtime primitives, canonical execution facts, and XState projections. [SPC-WEB-008](/specs/web/jobs-and-workflows-ui.md) owns browser interaction.

A workflow-backed conversation is a normal Pibo Session with a Workflow link. Rooms may supply its workspace. No separate container or Session class participates in Workflow ownership.

# Current behavior

- The Workflow library supports drafts, graph and raw IR editing, validation, immutable published versions, version history, prompt assets, duplication, archive, deletion tombstones, and historical inspection.
- Manual editor tests execute the supported text-trigger-to-agent subset, including deterministic fan-out. Unsupported joins and graph shapes fail explicitly.
- A published Workflow can create a normal Session in a selected or default Room and workspace. Creation freezes its Workflow version, effective definition, eligible overrides, and input configuration.
- Starting a configured Workflow Session is idempotent and records one initial run in the canonical Workflow store. Start alone does not prove full graph advancement.
- Session inspection returns the stored link and available snapshot, run, waits, human actions, node attempts, edge transfers, and lifecycle events. It does not fabricate progress from the definition.
- Workflow catalog and execution facts share `pibo-workflows.sqlite`. Conversation history and runtime bindings remain in the Pibo data store.

# Public HTTP contract

- `POST /api/chat/workflow-sessions` accepts `roomId`, `workspace`, `profile`, required `workflowId` and `workflowVersion`, and optional title, inputs, eligible prompt overrides, model, thinking level, and fast mode. It returns the normal `session`, `workflowSession`, Workflow/configuration/snapshot data, validation, and diagnostics.
- `GET /api/chat/sessions/:piboSessionId/workflow` returns `workflowSession` plus available snapshot and run facts and arrays for waits, human actions, node attempts, edge transfers, and lifecycle events. A Session without Workflow linkage returns 404.
- `POST /api/chat/sessions/:piboSessionId/workflow/start` returns the link, run, available snapshot and Workflow data, `alreadyStarted`, validation, diagnostics, and a message.
- `POST /api/chat/sessions/:piboSessionId/workflow/human-actions` validates and resolves one action against the linked Session and run.

# Requirements and invariants

## Requirement: ORCH-WFP-001: Catalog publication is immutable and Workflow-owned

The product MUST persist one active draft per editable Workflow, revisioned prompt assets, validation results, immutable content-hashed published versions, archive state, deletion tombstones, and lifecycle events in the Workflow database. Code Workflows MUST remain read-only. Deletion MUST preserve historical snapshots and links.

## Requirement: ORCH-WFP-002: Workflow starts use normal Sessions

Workflow creation and start APIs MUST create or address normal Pibo Sessions by `piboSessionId`. They MUST validate Workflow version, input, eligible overrides, registry references, and no-inline-code boundaries before changing durable state.

Manual editor execution MUST preserve the working text-trigger-to-agent and fan-out slice. It MUST reject unsupported joins and MUST NOT be described as a general restart-resuming executor.

## Requirement: ORCH-WFP-003: Session links and Runs use one canonical store

`PiboWorkflowSessionLink` MUST own only Workflow linkage and configuration. It MUST NOT own Room/container identity, title, profile, archive state, Session hierarchy, or conversation history.

Configured Session snapshots MUST freeze effective definitions and selected assets. Start MUST create at most one root Run for that configured Session. Runs, waits, actions, attempts, transfers, checkpoints, wakeups, outputs, and diagnostics MUST use the canonical `SqliteWorkflowRunStore`; no parallel lifecycle store may compete with it.

## Requirement: ORCH-WFP-004: Waits and human actions are scoped to Session-linked Runs

Wait tokens and human actions MUST be scoped by Workflow Run and linked Pibo Session. Resolution MUST verify token existence, ownership, pending state, expiry, offered registered action, action kind, and required payload schema before atomically resuming or cancelling the run.

Unknown, expired, replayed, cross-Session, unoffered, unregistered, and schema-invalid actions MUST fail without changing run state.

# Persistence and migration

`pibo-workflows.sqlite` owns Workflow links, immutable Session snapshots, catalog facts, Runs, lifecycle events, waits, actions, node attempts, edge transfers, checkpoints, wakeups, outputs, and diagnostics. The Pibo data store owns normal Sessions, Room membership, history, and runtime bindings.

On upgrade, migration validates legacy references and conflicts before converting recoverable container, Session-link, catalog, snapshot, Run, wait, and action facts. It preserves canonical Pibo Session IDs and archives recoverable source storage only after a durable completion marker. A restart after that marker may finish archival but must not reopen or re-import the migrated source. Fresh installs do not create legacy storage.

# Failure and security behavior

- Workflow mutations require authentication and same-origin JSON where applicable.
- Stored and returned diagnostics must not expose credentials or private payloads by default.
- Immutable selection, version, configuration, snapshot, and run links reject conflicting rewrites.
- XState and browser views remain read-only projections of canonical Workflow facts.

# Known limits

- General arbitrary-graph execution, full restart resumption, joins, webhooks, and scheduled Workflow triggers remain gaps in the [runtime follow-up plan](/plans/workflow-trigger-and-runtime-follow-ups.md).
- Final migration path, route-handler symbols, test names, and the integrated traceability commit require reconciliation.
- No focused tests, upgrade fixture, browser validation, provider validation, typecheck, or build ran in this docs workstream.

# Verification and traceability

The listed in-progress storage and API symbols were inspected in their owner worktrees. The traceability commit remains the shared pre-integration base and therefore does not contain every listed path. The final integrator must update it to the integrated code commit, reconcile source names, add exact test locators, and run the required validation matrices before promoting this draft.

# Related concepts

- [Workflow framework, runtime, and store](/specs/orchestration/workflow-framework-runtime-store.md)
- [Chat Web jobs and Workflows UI](/specs/web/jobs-and-workflows-ui.md)
- [Rooms and Session trees](/specs/web/rooms-and-session-trees.md)
- [Workflow trigger and runtime follow-ups](/plans/workflow-trigger-and-runtime-follow-ups.md)
