---
type: "Specification"
title: "Chat Web Rooms and Session Trees"
description: "Defines the implemented Chat Web Room, workspace, normal Session, and Session-tree contract."
tags: ["web", "chat-web", "rooms", "sessions", "workspaces"]
status: "draft"
authority: "normative"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-05T07:15:00Z"
sources:
  - resource: "scope:remove-projects integration source pending final commit reconciliation"
    title: "Rooms and normal Pibo Sessions implementation"
implementation:
  state: "integration-reconciliation-required"
  baseline_commit: "9932bbd8a85fa68617216346f10b3836bb706fe3"
  source_evidence: "Room and Session sources inspected; migration and final integrated source remain pending"
  test_execution: "unperformed"
  browser_execution: "unperformed"
traceability:
  commit: "9932bbd8a85fa68617216346f10b3836bb706fe3"
  requirements:
    - id: "WEB-TOPOLOGY-CONTAINERS-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "ChatRoomService"
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "ensureDefaultRoom"
      source_inspected: true
      follow_up: "Rebind this specification to the integrated code commit and add exact migration and focused-test evidence."
      public: ["/api/chat/rooms*", "PiboRoom"]
      failures:
        - "Missing Rooms and cyclic Room hierarchy changes fail without creating another container namespace."
      confidence: "medium"
    - id: "WEB-TOPOLOGY-SESSIONS-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/session-query-service.ts"
          symbol: "ChatSessionQueryService"
        - path: "src/apps/chat/session-metadata.ts"
          symbol: "chatRoomIdFromMetadata"
      source_inspected: true
      follow_up: "Add the final workflow-link and migrated-Session source and test locators at the integrated commit."
      public: ["/api/chat/sessions*", "Pibo Session ID"]
      failures:
        - "A workflow link cannot replace or change canonical Pibo Session identity, hierarchy, history, or runtime binding."
      confidence: "medium"
    - id: "WEB-TOPOLOGY-LIFECYCLE-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "updateRoom"
        - path: "src/apps/chat/data/session-query-service.ts"
          symbol: "deleteSessions"
        - path: "src/apps/chat/session-metadata.ts"
          symbol: "withChatWebArchived"
      source_inspected: true
      follow_up: "Bind final rename, archive, delete, read-state, and migration tests after integration."
      public: ["/api/chat/rooms*", "/api/chat/sessions*"]
      failures:
        - "Missing or conflicting resources return explicit failures; browser selection state grants no authority."
      confidence: "medium"
    - id: "WEB-TOPOLOGY-TREES-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "listRoomTree"
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "listRoomSubtree"
        - path: "src/apps/chat-ui/src/session-node.tsx"
          symbol: "SessionNode"
      source_inspected: true
      follow_up: "Reconcile final sidebar symbols and add deterministic ordering, malformed-payload, accessibility, and headful evidence."
      public: ["Room and Session sidebar", "SessionNode"]
      failures:
        - "Malformed tree data fails closed and cannot corrupt current Session selection."
      confidence: "medium"
---

# Scope

This specification owns Rooms, Room workspaces, normal Pibo Sessions, and their Chat Web tree and lifecycle behavior. Workflow definitions and execution facts belong to [SPC-ORCH-006](/specs/orchestration/workflow-catalog-and-session-execution.md). Physical Session persistence belongs to SPC-DATA-002.

A Room groups Sessions and may define a default workspace. A Pibo Session remains the addressable conversation and execution identity. Workflow linkage adds metadata and a Workflow view to that same Session; it does not create another Session class or container.

# Current behavior

- The authenticated App Context exposes one Room and Session topology. Login identity does not create a tenant partition.
- Room metadata can define a workspace. Session creation resolves an explicit workspace or the selected Room's workspace through the normal Session path.
- Session IDs, hierarchy, history, runtime bindings, profile, model, title, status, archive state, and timestamps remain Session-owned.
- Room and Session trees expose deterministic hierarchy, selection, status, unread, pinned, archived, and workflow-kind projections.
- Rename, archive, delete, read-state, message, trace, preview, and runtime actions operate on normal Room or Session resources.
- An upgrade converts recoverable legacy container links into Rooms, normal Sessions, and Workflow-owned links while preserving canonical Session IDs and recoverable source data. Normal operation does not depend on legacy container storage.

# Requirements and invariants

## Requirement: WEB-TOPOLOGY-CONTAINERS-001: Rooms own grouping and workspace defaults

Rooms MUST be the only Chat Web grouping container. A Room MAY define a workspace used as the default for new Sessions, and Room hierarchy MUST reject cycles.

No route, bootstrap field, browser area, or storage service may require a second workspace container.

## Requirement: WEB-TOPOLOGY-SESSIONS-002: All conversations remain normal Pibo Sessions

Normal and workflow-backed conversations MUST use stable Pibo Session IDs and the standard Session routing, history, hierarchy, runtime-binding, workspace, and lifecycle contracts.

Workflow linkage MUST contain only workflow identity, version, run, state, configuration, snapshot, and action projections. It MUST NOT own Room membership, title, profile, archive state, Session hierarchy, or conversation history.

## Requirement: WEB-TOPOLOGY-LIFECYCLE-003: Lifecycle mutations target Rooms and Sessions

Room and Session create, rename, archive, delete, read-state, and ordering mutations MUST target existing App Context resources and return explicit conflict or not-found failures.

Deleting a Room or Session MUST follow canonical Session cleanup rules. Client caches and current-selection pointers are projections and MUST NOT authorize a mutation or preserve a deleted resource.

## Requirement: WEB-TOPOLOGY-TREES-004: Room and Session trees are deterministic

Room and Session trees MUST preserve stable hierarchy, ordering, selected state, archived state, status, unread state, and workflow-kind metadata. Malformed payloads MUST fail before rendering or be omitted without changing the selected Session.

Workflow-backed Sessions MUST be identified textually, not by color alone. Keyboard, responsive, zoom, and screen-reader behavior still requires headful acceptance evidence.

# Interfaces and ownership

Public surfaces include `/api/chat/rooms*`, `/api/chat/sessions*`, the Room and Session sidebar, and `SessionNode`.

Rooms own grouping and optional workspace defaults. Pibo Sessions own conversation and runtime facts. Workflow stores own Workflow definitions, snapshots, Runs, waits, actions, attempts, transfers, and diagnostics. Cross-links use stable IDs without duplicating ownership.

# Failure, compatibility, and security behavior

- Missing Rooms, Sessions, or parents fail by stable identity.
- Workspace and hierarchy conflicts fail without partial topology changes.
- Legacy conversion must fail visibly on malformed, missing, or conflicting canonical facts and retain recoverable source data.
- Browser state, caches, projections, overlays, and iframe presence do not grant authorization.

# Known limits

- Final migration source paths, focused test names, and the integrated traceability commit require reconciliation.
- No focused tests, upgrade fixture, browser validation, provider validation, typecheck, or build ran in this docs workstream.

# Verification and traceability

The traceability commit is the pre-integration base. It proves that the listed Room and Session source files existed; it does not prove the staged removal or migration. The final integrator must update `traceability.commit`, bind the migration and final UI/API symbols, add exact tests, and then change lifecycle status only after the integrated checks pass.

# Related concepts

- [Workflow catalog and Session execution](/specs/orchestration/workflow-catalog-and-session-execution.md)
- [Product store, history, payloads, and read models](/specs/data/product-store-history-and-read-models.md)
- [Sessions and runtime bindings](/specs/data/sessions-and-runtime-bindings.md)
- [Chat Web app shell](/specs/web/app-shell-bootstrap-navigation-and-pwa.md)
