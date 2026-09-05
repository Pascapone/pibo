---
type: "Specification"
title: "Chat Web Rooms and Session Trees"
description: "Defines the implemented Chat Web Room, workspace, normal Session, migration, and Session-tree contract."
tags: ["web", "chat-web", "rooms", "sessions", "workspaces"]
status: "stable"
authority: "normative"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-05T08:51:15Z"
sources:
  - resource: "scope:Integrated implementation and tests at traceability.commit"
    title: "Rooms and normal Pibo Sessions implementation"
implementation:
  state: "current"
  baseline_commit: "14cbaf0fd04cfa321674b570baeb40e543d957cb"
  source_evidence: "performed"
  test_execution: "complete isolated root suite passed: 2744 tests, 2739 passed, 0 failed, 5 skipped"
  build_typecheck_execution: "clean full build and all typechecks passed"
  browser_execution: "headed Room workspace editing/inheritance and desktop/mobile views passed"
traceability:
  commit: "14cbaf0fd04cfa321674b570baeb40e543d957cb"
  requirements:
    - id: "WEB-TOPOLOGY-CONTAINERS-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "ChatRoomService"
        - path: "src/apps/chat/data/legacy-project-migration.ts"
          symbol: "migrateLegacyProjects"
        - path: "src/apps/chat/web-app.ts"
          symbol: "createChatWebApp"
      tests:
        - path: "test/web-channel.test.mjs"
          name: "chat web app starts new room sessions in the room workspace"
        - path: "test/legacy-project-migration.test.mjs"
          name: "fresh storage does not create or open the retired database"
        - path: "test/legacy-project-migration.test.mjs"
          name: "catalog-only upgrades transfer and retire old pibo.sqlite catalog tables without a retired database"
        - path: "test/legacy-project-migration.test.mjs"
          name: "migration durably commits both WAL targets before retiring sources and restores normal settings"
        - path: "test/legacy-project-migration.test.mjs"
          name: "a partial target receipt is detected and idempotently replayed before source retirement"
        - path: "test/legacy-project-migration.test.mjs"
          name: "partial migration reconstructs an entirely missing Workflow target from the retained source"
        - path: "test/legacy-project-migration.test.mjs"
          name: "partial migration replays Pibo target changes when only the Workflow target committed"
        - path: "test/legacy-project-migration.test.mjs"
          name: "archive recovery completes a WAL rename interrupted after the base database moved"
        - path: "test/session-native-product-boundary.test.mjs"
          name: "retired container modules are absent rather than disabled or left unreferenced"
      public: ["/api/chat/rooms*", "PiboRoom"]
      failures:
        - "Missing Rooms and cyclic hierarchy changes fail without creating another container namespace."
      confidence: "high"
    - id: "WEB-TOPOLOGY-SESSIONS-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/session-query-service.ts"
          symbol: "ChatSessionQueryService"
        - path: "src/sessions/pibo-data-store.ts"
          symbol: "PiboDataSessionStore"
        - path: "src/sessions/workflow-session-kind.ts"
          symbol: "workflowSessionKindFromMetadata"
        - path: "src/apps/chat/data/legacy-project-migration.ts"
          symbol: "migrateLegacyProjects"
      tests:
        - path: "test/web-channel.test.mjs"
          name: "session-native workflow Sessions share definitions, start idempotently, inspect facts, message, archive, and delete"
        - path: "test/legacy-project-migration.test.mjs"
          name: "valid upgrade preserves canonical Sessions/history, migrates same-definition Workflows and catalog, archives source, and reopens"
        - path: "test/workflow-session-kind.test.mjs"
          name: "workflow session kind metadata accepts only the stable V2 enum"
      public: ["/api/chat/sessions*", "Pibo Session ID"]
      failures:
        - "Workflow linkage cannot replace or change canonical Session identity, hierarchy, history, or runtime binding."
      confidence: "high"
    - id: "WEB-TOPOLOGY-LIFECYCLE-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "updateRoom"
        - path: "src/apps/chat/data/session-query-service.ts"
          symbol: "deleteSessions"
        - path: "src/apps/chat/session-metadata.ts"
          symbol: "withChatWebArchived"
      tests:
        - path: "test/chat-web-app-sessions.test.mjs"
          name: "Chat Web mutates and routes historical account sessions by resource existence"
        - path: "test/web-channel.test.mjs"
          name: "chat web app archives and permanently deletes custom agents with their sessions"
        - path: "test/legacy-project-migration.test.mjs"
          name: "malformed, missing-reference, and conflicting target sources fail visibly and remain recoverable"
      public: ["/api/chat/rooms*", "/api/chat/sessions*"]
      failures:
        - "Missing or conflicting resources fail explicitly; browser selection state grants no authority."
      confidence: "high"
    - id: "WEB-TOPOLOGY-TREES-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "listRoomTree"
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "listRoomSubtree"
        - path: "src/apps/chat-ui/src/session-node.tsx"
          symbol: "SessionNode"
      tests:
        - path: "test/chat-web-app-sessions.test.mjs"
          name: "Chat Web persists pinning and manual room order without update-based movement"
        - path: "test/chat-web-app-sessions.test.mjs"
          name: "Chat Web persists pinning and manual session order without activity-based movement"
        - path: "test/workflow-session-kind.test.mjs"
          name: "normal sidebar session nodes expose workflow session kind for real Pibo Sessions only"
      public: ["Room and Session sidebar", "SessionNode"]
      failures:
        - "Malformed tree data fails closed and cannot corrupt current Session selection."
      confidence: "high"
---

# Scope

This specification owns Rooms, Room workspaces, normal Pibo Sessions, their Chat Web trees, and conversion of recoverable legacy container links. [SPC-ORCH-006](/specs/orchestration/workflow-catalog-and-session-execution.md) owns Workflow definitions and execution facts. SPC-DATA-002 owns physical Session persistence.

A Room groups Sessions and may define a default workspace. A Pibo Session remains the addressable conversation and execution identity. Workflow linkage adds metadata and a Workflow view to that same Session; it does not create another Session class or container.

# Current behavior

- The authenticated App Context exposes one Room and Session topology. Login identity does not create a tenant partition.
- Session creation resolves an explicit workspace or the selected Room's workspace through the normal Session path.
- Session IDs, hierarchy, history, runtime bindings, profile, model, title, status, archive state, and timestamps remain Session-owned.
- Room and Session trees expose deterministic hierarchy, selection, status, unread, pinned, archived, and Workflow-kind projections.
- Rename, archive, delete, read-state, message, trace, preview, and runtime actions operate on normal Room or Session resources.
- Upgrade migration converts recoverable legacy links into Rooms, normal Sessions, and Workflow-owned links without changing canonical Session IDs, history, hierarchy, or runtime bindings.

# Requirements and invariants

## Requirement: WEB-TOPOLOGY-CONTAINERS-001: Rooms own grouping and workspace defaults

Rooms MUST be the only Chat Web grouping container. A Room MAY define a workspace used as the default for new Sessions, and Room hierarchy MUST reject cycles. Fresh storage MUST NOT create or open retired container storage.

## Requirement: WEB-TOPOLOGY-SESSIONS-002: All conversations remain normal Pibo Sessions

Normal and Workflow-backed conversations MUST use stable Pibo Session IDs and the standard Session routing, history, hierarchy, runtime-binding, workspace, and lifecycle contracts.

Workflow linkage MUST NOT own Room membership, title, profile, archive state, Session hierarchy, or conversation history.

## Requirement: WEB-TOPOLOGY-LIFECYCLE-003: Lifecycle mutations target Rooms and Sessions

Room and Session create, rename, archive, delete, read-state, and ordering mutations MUST target existing App Context resources and return explicit conflict or not-found failures. Client caches and current-selection pointers are non-authoritative projections.

## Requirement: WEB-TOPOLOGY-TREES-004: Room and Session trees are deterministic

Room and Session trees MUST preserve stable hierarchy, ordering, selected state, archived state, status, unread state, and Workflow-kind metadata. Malformed payloads MUST fail before rendering or be omitted without changing the selected Session.

Workflow-backed Sessions MUST be identified textually, not by color alone.

# Migration, failure, and security behavior

Migration validates source JSON, canonical Session references, hierarchy, and target conflicts before mutation. It preserves recoverable source data on failure. Successful migration records matching receipts in both target stores, uses `synchronous=FULL` for both WAL commits, and archives the source only after both commits return. A partial commit replays either lost target from the retained source. Catalog-only upgrades migrate without retired container storage. Restart completes an interrupted base, WAL, or SHM sidecar rename without reopening migrated facts.

Browser state, caches, projections, overlays, and iframe presence do not grant authorization.

# Known limits

Headed Room workspace editing and inheritance and relevant desktop/mobile views passed. Screen-reader, zoom, desktop PWA, and separately provisioned migration-upgrade browser acceptance remain unperformed.

# Verification and traceability

Source and named tests are bound to integrated commit `14cbaf0fd04cfa321674b570baeb40e543d957cb`. The clean full build, all typechecks, and complete isolated root suite passed. The suite reported 2,744 tests: 2,739 passed, 0 failed, and 5 skipped; exit 0. Headed Room workspace editing and inheritance, desktop/mobile views, and a real normal Session `pwd` through `openai-codex` succeeded. This document does not claim manual editor QA, gateway deployment, or Pibo2 validation.

# Related concepts

- [Workflow catalog and Session execution](/specs/orchestration/workflow-catalog-and-session-execution.md)
- [Product store, history, payloads, and read models](/specs/data/product-store-history-and-read-models.md)
- [Sessions and runtime bindings](/specs/data/sessions-and-runtime-bindings.md)
- [Chat Web app shell](/specs/web/app-shell-bootstrap-navigation-and-pwa.md)
