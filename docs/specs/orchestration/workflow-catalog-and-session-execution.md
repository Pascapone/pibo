---
type: "Specification"
title: "Workflow Catalog, Publishing, and Session Execution"
description: "Defines the implemented Workflow catalog, publishing, Session linkage, pending starts, inspection, waits, and human actions."
tags: ["orchestration", "workflows", "sessions"]
status: "stable"
authority: "normative"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-05T08:51:15Z"
sources:
  - resource: "scope:Integrated implementation and tests at traceability.commit"
    title: "Workflow catalog and Session-native integration"
implementation:
  state: "current"
  baseline_commit: "14cbaf0fd04cfa321674b570baeb40e543d957cb"
  source_evidence: "performed"
  test_execution: "144 Workflow package tests and complete isolated root suite passed"
  build_typecheck_execution: "clean full build and all typechecks passed"
  browser_execution: "headed Workflow Session creation/start/inspection and desktop/mobile views passed; manual editor QA remains pending"
traceability:
  commit: "14cbaf0fd04cfa321674b570baeb40e543d957cb"
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
        - path: "src/apps/chat/data/legacy-project-migration.ts"
          symbol: "migrateLegacyProjects"
      tests:
        - path: "test/workflow-v2-lifecycle-checklist.test.mjs"
          name: "Workflow library keeps draft, publish, version, duplicate, archive and delete actions"
        - path: "test/web-channel.test.mjs"
          name: "workflow catalog lifecycle APIs create, validate, publish, and expose version resources"
        - path: "test/legacy-project-migration.test.mjs"
          name: "catalog-only upgrades transfer and retire old pibo.sqlite catalog tables without a retired database"
      public: ["/api/chat/workflows*", "pibo-workflows.sqlite"]
      failures:
        - "Invalid definitions cannot publish, and deletion preserves immutable historical snapshots and tombstones."
      confidence: "high"
    - id: "ORCH-WFP-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat/chat-api-routes.ts"
          symbol: "sessionWorkflowResource"
        - path: "src/apps/chat/web-app.ts"
          symbol: "createChatWebApp"
        - path: "src/apps/chat/workflow-sessions.ts"
          symbol: "normalizeWorkflowSessionConfiguration"
        - path: "src/apps/chat/workflow-manual-trigger-runtime.ts"
          symbol: "runWorkflowManualTextTrigger"
      tests:
        - path: "test/web-channel.test.mjs"
          name: "chat web exposes only session-native workflow routes"
        - path: "test/web-channel.test.mjs"
          name: "session-native workflow Sessions share definitions, start idempotently, inspect facts, message, archive, and delete"
        - path: "test/workflow-manual-trigger-recovery.test.mjs"
          name: "manual workflow agent nodes use normal Sessions with workspace and stable workflow linkage"
      public: ["POST /api/chat/workflow-sessions", "GET /api/chat/sessions/:piboSessionId/workflow", "POST /api/chat/sessions/:piboSessionId/workflow/start"]
      failures:
        - "Invalid Workflow selection, input, overrides, or unsupported manual graph shapes fail without fabricated execution state."
      confidence: "high"
    - id: "ORCH-WFP-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/workflow-session-service.ts"
          symbol: "ChatWorkflowSessionService"
        - path: "src/apps/chat/data/workflow-session-model.ts"
          symbol: "PiboWorkflowSessionLink"
        - path: "src/apps/chat/workflow-sessions.ts"
          symbol: "createWorkflowSessionSnapshot"
        - path: "src/apps/chat/web-app.ts"
          symbol: "inspectWorkflowSession"
      tests:
        - path: "test/workflow-session-service.test.mjs"
          name: "start is transactional and idempotent across service instances"
        - path: "test/workflow-session-service.test.mjs"
          name: "inspection accepts canonical editor and kernel runs without inventing configuration snapshots"
        - path: "test/web-channel.test.mjs"
          name: "session-native workflow Sessions share definitions, start idempotently, inspect facts, message, archive, and delete"
      public: ["PiboWorkflowSessionLink", "WorkflowRun", "workflow_session_links", "workflow_session_snapshots"]
      failures:
        - "Mismatched Session, Workflow, version, snapshot, or Run identity fails without changing immutable selection or creating a second Run."
      confidence: "high"
    - id: "ORCH-WFP-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/workflow-session-service.ts"
          symbol: "resolveWorkflowHumanAction"
        - path: "src/apps/chat/workflow-human-actions.ts"
          symbol: "validateWorkflowHumanActionRequest"
        - path: "packages/workflows/src/store/index.ts"
          symbol: "SqliteWorkflowRunStore"
      tests:
        - path: "test/workflow-session-service.test.mjs"
          name: "human actions are run-linked, transactional, auditable and single-use"
        - path: "test/web-channel.test.mjs"
          name: "session-native workflow human actions are validated, persisted, and inspectable"
        - path: "test/workflow-v2-session-run-checklist.test.mjs"
          name: "human action UI submits only actions offered by the inspection response"
      public: ["POST /api/chat/sessions/:piboSessionId/workflow/human-actions", "WorkflowWaitToken", "WorkflowHumanActionRecord"]
      failures:
        - "Unknown, cross-Session, expired, replayed, unregistered, unoffered, or schema-invalid actions fail without resuming the Run."
      confidence: "high"
---

# Scope

This specification owns the Workflow catalog, drafts, publishing, assets, lifecycle facts, Workflow-to-Session links, configured starts, inspection, waits, and human actions. [SPC-ORCH-005](/specs/orchestration/workflow-framework-runtime-store.md) owns Workflow IR, runtime primitives, canonical execution facts, and XState projections. [SPC-WEB-008](/specs/web/jobs-and-workflows-ui.md) owns browser interaction.

A Workflow-backed conversation is a normal Pibo Session with a Workflow link. Rooms may supply its workspace. No separate container or Session class participates in Workflow ownership.

# Current behavior

- The Workflow library supports drafts, graph and raw IR editing, validation, immutable published versions, version history, prompt assets, duplication, archive, deletion tombstones, and historical inspection.
- Bounded manual editor execution routes ordinary chat Sessions, waits for final assistant messages, supports deterministic fan-out, and persists canonical definition snapshots, Runs, node attempts, and edge transfers.
- A published Workflow can create a normal Session in a selected or default Room and workspace. Creation freezes its Workflow version, effective definition, eligible overrides, and input configuration.
- Starting a configured Workflow Session is idempotent and records one canonical `pending` Run. It does not start general graph execution. The API returns HTTP 202 for a new record and states: `Workflow run recorded. General graph execution is not connected to this surface; supported manual triggers run from the editor.`
- Session inspection returns the stored link and available definition snapshot, configuration snapshot, Run, waits, human actions, node attempts, edge transfers, and lifecycle events. It does not fabricate progress from a definition.
- Workflow catalog and execution facts share `pibo-workflows.sqlite`. Conversation history and runtime bindings remain in the Pibo data store.

# Public HTTP contract

- `POST /api/chat/workflow-sessions` accepts `roomId`, `workspace`, `profile`, required `workflowId` and `workflowVersion`, and optional title, inputs, eligible prompt overrides, model, thinking level, and fast mode.
- `GET /api/chat/sessions/:piboSessionId/workflow` returns `workflowSession`, available snapshots and Run, and arrays for waits, human actions, node attempts, edge transfers, and lifecycle events. A Session without Workflow linkage returns 404.
- `POST /api/chat/sessions/:piboSessionId/workflow/start` records or returns the one pending Run and reports whether it already existed.
- `POST /api/chat/sessions/:piboSessionId/workflow/human-actions` validates and resolves one action against the linked Session and Run.

# Requirements and invariants

## Requirement: ORCH-WFP-001: Catalog publication is immutable and Workflow-owned

The product MUST persist one active draft per editable Workflow, revisioned prompt assets, validation results, immutable content-hashed published versions, archive state, deletion tombstones, and lifecycle events in the Workflow database. Code Workflows MUST remain read-only. Deletion MUST preserve historical snapshots and links.

## Requirement: ORCH-WFP-002: Workflow starts use normal Sessions

Workflow creation and start APIs MUST create or address normal Pibo Sessions by `piboSessionId`. They MUST validate Workflow version, input, eligible overrides, registry references, and no-inline-code boundaries before changing durable state.

Manual editor execution MUST preserve the working text-trigger-to-agent and fan-out slice, use ordinary chat Sessions, and persist canonical Workflow facts. It MUST reject unsupported joins and MUST NOT be described as a general restart-resuming executor.

## Requirement: ORCH-WFP-003: Session links and Runs use one canonical store

`PiboWorkflowSessionLink` MUST own only Workflow linkage and configuration. It MUST NOT own Room identity, title, profile, archive state, Session hierarchy, or conversation history.

Configured Session snapshots MUST freeze effective definitions and selected assets. Start MUST create at most one `pending` root Run for that configured Session and MUST NOT imply graph execution. Runs, waits, actions, attempts, transfers, checkpoints, wakeups, outputs, and diagnostics MUST use the canonical `SqliteWorkflowRunStore`.

## Requirement: ORCH-WFP-004: Waits and human actions are scoped to Session-linked Runs

Wait tokens and human actions MUST be scoped by Workflow Run and linked Pibo Session. Resolution MUST verify token existence, ownership, pending state, expiry, offered registered action, action kind, and required payload schema before atomically resuming or cancelling the Run.

# Persistence and migration

`pibo-workflows.sqlite` owns Workflow links, immutable Session snapshots, catalog facts, Runs, lifecycle events, waits, actions, node attempts, edge transfers, checkpoints, wakeups, outputs, and diagnostics. The Pibo data store owns normal Sessions, Room membership, history, and runtime bindings.

Migration validates legacy references and conflicts before conversion. It commits both WAL targets with `synchronous=FULL`, writes matching receipts, and archives recoverable source storage only after both commits return. A partial commit can replay either lost target from retained source facts. Catalog-only upgrades transfer and retire old Pibo-store catalog tables without retired container storage. Restart can complete interrupted base, WAL, and SHM archive renames without reopening migrated facts.

# Failure and security behavior

Workflow mutations require authentication and same-origin JSON. Stored and returned diagnostics omit credentials and private payloads by default. Immutable selection, version, configuration, snapshot, and Run links reject conflicting rewrites. XState and browser views remain projections of canonical Workflow facts.

# Known limits

General arbitrary-graph execution, full restart resumption, joins, webhooks, and scheduled Workflow triggers remain gaps in the [runtime follow-up plan](/plans/workflow-trigger-and-runtime-follow-ups.md). Headed Workflow Session creation, pending start, inspection, desktop/mobile views, and a real normal Session provider turn passed. Manual editor headful QA remains underway.

# Verification and traceability

Source and named tests are bound to integrated commit `14cbaf0fd04cfa321674b570baeb40e543d957cb`. The clean full build, all typechecks, 144 Workflow package tests, 56 focused migration/storage/router/header tests, 62 focused UI source tests, and complete isolated root suite passed. The root suite reported 2,744 tests: 2,739 passed, 0 failed, and 5 skipped; exit 0. Headed Workflow Session creation/start/inspection and desktop/mobile views and a real normal Session `pwd` through `openai-codex` succeeded. Manual editor QA, gateway deployment, and Pibo2 validation are not claimed.

# Related concepts

- [Workflow framework, runtime, and store](/specs/orchestration/workflow-framework-runtime-store.md)
- [Chat Web jobs and Workflows UI](/specs/web/jobs-and-workflows-ui.md)
- [Rooms and Session trees](/specs/web/rooms-and-session-trees.md)
- [Workflow trigger and runtime follow-ups](/plans/workflow-trigger-and-runtime-follow-ups.md)
