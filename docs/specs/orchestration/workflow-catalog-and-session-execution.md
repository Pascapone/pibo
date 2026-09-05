---
type: "Specification"
title: "Workflow Catalog, Publishing, and Session Execution"
description: "Defines the implemented Workflow catalog, publishing, Session linkage, pending starts, inspection, waits, and human actions."
tags: ["orchestration", "workflows", "sessions"]
status: "stable"
authority: "normative"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-05T10:02:49Z"
sources:
  - resource: "scope:Integrated implementation and tests at traceability.commit"
    title: "Workflow catalog and Session-native integration"
implementation:
  state: "current"
  baseline_commit: "7ec71c2cca2108423002be0e7330d2a20c4c5b67"
  source_evidence: "performed"
  test_execution: "one added manual editor API test and 20 focused routed-runtime/UI/manual/header tests passed at the final integration; the complete root-suite count remains historical at 14cbaf0f"
  build_typecheck_execution: "source checks and all typechecks passed after final integration"
  browser_execution: "headed manual editor Room selection, real provider run, canonical inspection, pending explanation reload, Workflow Session, Room, and desktop/mobile acceptance passed"
traceability:
  commit: "7ec71c2cca2108423002be0e7330d2a20c4c5b67"
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
        - path: "src/apps/chat/web-app.ts"
          symbol: "normalizeWorkflowDraftManualTriggerRunBody"
        - path: "src/apps/chat/web-app.ts"
          symbol: "requireRoom"
        - path: "src/apps/chat/chat-request-normalizers.ts"
          symbol: "normalizeRoomWorkspace"
      tests:
        - path: "test/web-channel.test.mjs"
          name: "chat web exposes only session-native workflow routes"
        - path: "test/web-channel.test.mjs"
          name: "session-native workflow Sessions share definitions, start idempotently, inspect facts, message, archive, and delete"
        - path: "test/workflow-manual-trigger-recovery.test.mjs"
          name: "manual workflow agent nodes use normal Sessions with workspace and stable workflow linkage"
        - path: "test/web-channel.test.mjs"
          name: "manual editor runs target normal Rooms and persist canonical inspection facts"
      public: ["POST /api/chat/workflow-sessions", "GET /api/chat/sessions/:piboSessionId/workflow", "POST /api/chat/sessions/:piboSessionId/workflow/start", "POST /api/chat/workflows/drafts/:draftId/manual-trigger-runs"]
      failures:
        - "Invalid Workflow selection, input, overrides, Room permission, workspace, or unsupported manual graph shapes fail without fabricated execution state."
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
- Bounded manual editor execution accepts an optional `roomId` and `workspace`, validates write permission for an explicit Room, otherwise uses the default Room, routes ordinary chat Sessions, inherits the selected Room workspace unless an explicit valid workspace is supplied, waits for final assistant messages, supports deterministic fan-out, and persists canonical definition snapshots, Runs, node attempts, and edge transfers.
- A published Workflow can create a normal Session in a selected or default Room and workspace. Creation freezes its Workflow version, effective definition, eligible overrides, and input configuration.
- Starting a configured Workflow Session is idempotent and records one canonical `pending` Run. It does not start general graph execution. The API returns HTTP 202 for a new record and states: `Workflow run recorded. General graph execution is not connected to this surface; supported manual triggers run from the editor.`
- Session inspection returns the stored link and available definition snapshot, configuration snapshot, Run, waits, human actions, node attempts, edge transfers, and lifecycle events. It does not fabricate progress from a definition.
- Workflow catalog and execution facts share `pibo-workflows.sqlite`. Conversation history and runtime bindings remain in the Pibo data store.

# Public HTTP contract

- `POST /api/chat/workflow-sessions` accepts `roomId`, `workspace`, `profile`, required `workflowId` and `workflowVersion`, and optional title, inputs, eligible prompt overrides, model, thinking level, and fast mode.
- `POST /api/chat/workflows/drafts/:draftId/manual-trigger-runs` accepts required `triggerNodeId` and text `input` plus optional `roomId` and `workspace`. An explicit Room requires write permission; without a Room the API uses the default Room. Runtime Sessions inherit the resolved Room workspace unless a valid explicit workspace overrides it.
- `GET /api/chat/sessions/:piboSessionId/workflow` returns `workflowSession`, available snapshots and Run, and arrays for waits, human actions, node attempts, edge transfers, and lifecycle events. A Session without Workflow linkage returns 404.
- `POST /api/chat/sessions/:piboSessionId/workflow/start` records or returns the one pending Run and reports whether it already existed.
- `POST /api/chat/sessions/:piboSessionId/workflow/human-actions` validates and resolves one action against the linked Session and Run.

# Requirements and invariants

## Requirement: ORCH-WFP-001: Catalog publication is immutable and Workflow-owned

The product MUST persist one active draft per editable Workflow, revisioned prompt assets, validation results, immutable content-hashed published versions, archive state, deletion tombstones, and lifecycle events in the Workflow database. Code Workflows MUST remain read-only. Deletion MUST preserve historical snapshots and links.

## Requirement: ORCH-WFP-002: Workflow starts use normal Sessions

Workflow creation and start APIs MUST create or address normal Pibo Sessions by `piboSessionId`. They MUST validate Workflow version, input, eligible overrides, registry references, and no-inline-code boundaries before changing durable state.

Manual editor execution MUST preserve the working text-trigger-to-agent and fan-out slice, use ordinary chat Sessions in a write-authorized selected or default Room, inherit that Room's workspace unless a valid explicit workspace is supplied, and persist canonical Workflow facts. It MUST reject invalid Room/workspace input and unsupported joins, and MUST NOT be described as a general restart-resuming executor.

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

General arbitrary-graph execution, full restart resumption, joins, webhooks, and scheduled Workflow triggers remain gaps in the [runtime follow-up plan](/plans/workflow-trigger-and-runtime-follow-ups.md). Completed headed acceptance covered Workflow Session creation, pending start and reload explanation, inspection, desktop/mobile views, Room workspace editing/inheritance, and real `openai-codex` runs from both a normal Session and the supported manual editor slice. It did not cover headful raw-IR editing, publish, human-action submission, or job controls.

# Verification and traceability

Changed current source contracts and named test locators are bound to final integrated commit `7ec71c2cca2108423002be0e7330d2a20c4c5b67`. After final integration, source checks and all typechecks passed; the added API test “manual editor runs target normal Rooms and persist canonical inspection facts” passed alone, and the focused routed-runtime/UI/manual/header matrix passed 20 tests. The final-code whole-root rerun remains underway and is not claimed. The earlier complete isolated root suite at `14cbaf0fd04cfa321674b570baeb40e543d957cb` reported 2,744 tests: 2,739 passed, 0 failed, 5 skipped, exit 0. All 144 Workflow package tests passed previously, and package source is unchanged.

Headful acceptance created a draft in the UI, added and connected manual-trigger and agent nodes, saved text input/output settings, and selected ordinary Room `Session-native QA` with workspace `/tmp/pibo-session-native-workspace`. Actual `openai-codex` execution returned `MANUAL_NATIVE_ROOM_OK` and `/tmp/pibo-session-native-workspace`. Run `wfr_ac3db39f-229f-4082-9485-4f6e6663a8b5` and ordinary agent Session `ps_04559a0b-fac4-4636-979a-addb1ff91fb0` reopened with completed canonical inspection: two node attempts, one edge transfer, immutable executable definition snapshot, and actual output. An empty-directory package install with `npm install --omit=dev` also created and reopened the canonical persistent Workflow service without a workspace-package symlink or retired storage. Gateway deployment and Pibo2 validation are not claimed.

# Related concepts

- [Workflow framework, runtime, and store](/specs/orchestration/workflow-framework-runtime-store.md)
- [Chat Web jobs and Workflows UI](/specs/web/jobs-and-workflows-ui.md)
- [Rooms and Session trees](/specs/web/rooms-and-session-trees.md)
- [Workflow trigger and runtime follow-ups](/plans/workflow-trigger-and-runtime-follow-ups.md)
