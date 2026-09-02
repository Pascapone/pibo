---
type: "Specification"
title: "Chat Web Rooms, Projects, and Session Trees"
description: "Defines the implemented Chat Web Rooms, Projects, and Session Trees contract, including its ownership, source/test/public/failure/accessibility/compatibility boundaries, and explicit evidence limits."
tags:
- web
- chat-web
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-01T20:42:35Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:upstream/dev refresh 39090b8850758293e69380a52bb7498d7c955bc2"
    title: "upstream/dev refresh source and named-test evidence"
implementation:
  state: "current"
  baseline_commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  package: "WP-06+07-WEB"
  package_parent: "ba3c2d6611ce8d234f887135af605837333bf751"
  source_evidence: "performed"
  focused_test_execution: "performed in owned Docker after authoring; see implementation report"
  build_typecheck_package_execution: "performed in owned Docker after authoring; see implementation report"
  visual_provider_gateway_pibo2_execution: "unperformed"
traceability:
  commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  requirements:
    - id: "WEB-TOPOLOGY-CONTAINERS-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "ChatRoomService"
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "PiboRoomHierarchyCycleError"
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "ensureDefaultRoom"
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "listRoomTree"
        - path: "src/apps/chat/data/project-service.ts"
          symbol: "ChatProjectService"
        - path: "src/apps/chat/data/project-service.ts"
          symbol: "ensureSharedDefaultProject"
        - path: "src/apps/chat/data/project-service.ts"
          symbol: "listProjects"
      tests:
        - path: "test/chat-web-app-sessions.test.mjs"
          name: "Chat Web treats rooms, sidebar navigation, and mutations as app-global resources"
        - path: "test/chat-web-app-sessions.test.mjs"
          name: "Chat Web read state is shared across authenticated accounts"
        - path: "test/project-service-workflow-link.test.mjs"
          name: "project service uses app-global storage and lists projects"
        - path: "test/project-service-workflow-link.test.mjs"
          name: "shared default project adopts a legacy personal project using the default folder"
        - path: "test/chat-v2-native-services.test.mjs"
          name: "V2-native chat services cover rooms, sessions, timeline, commands, and read state"
      public:
        - "/api/chat/rooms*"
        - "/api/chat/sessions*"
        - "/api/chat/projects*"
        - "ProjectsArea"
        - "ProjectsSidebar"
        - "SessionNode"
      failures:
        - "Ambiguous or missing resources fail by identity; login account is not a topology namespace."
        - "Accessibility/responsive boundary: App-global labels and current state must remain distinguishable in sidebar controls."
        - "Compatibility boundary: Legacy default adoption is a compatibility path; storage implementation remains SPC-DATA-001."
      confidence: "high"
    - id: "WEB-TOPOLOGY-SESSIONS-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/project-service.ts"
          symbol: "addProjectSession"
        - path: "src/apps/chat/data/project-service.ts"
          symbol: "linkWorkflowRunSession"
        - path: "src/apps/chat/data/project-service.ts"
          symbol: "saveWorkflowSessionSnapshot"
        - path: "src/apps/chat/data/project-service.ts"
          symbol: "startWorkflowSessionRun"
        - path: "src/apps/chat/project-workflow-sessions.ts"
          symbol: "normalizeProjectWorkflowSessionConfiguration"
        - path: "src/apps/chat/project-workflow-sessions.ts"
          symbol: "createProjectWorkflowSessionSnapshot"
        - path: "src/apps/chat/project-workflow-sessions.ts"
          symbol: "createProjectWorkflowRunCurrent"
        - path: "src/apps/chat-ui/src/session-trace-layout.tsx"
          symbol: "shouldRenderSessionComposer"
      tests:
        - path: "test/project-service-workflow-link.test.mjs"
          name: "project workflow session records persist selection metadata before runs start"
        - path: "test/project-service-workflow-link.test.mjs"
          name: "project workflow session selection and configuration stay immutable after creation"
        - path: "test/project-service-workflow-link.test.mjs"
          name: "project workflow session snapshots persist configuration and effective definitions"
        - path: "test/project-service-workflow-link.test.mjs"
          name: "project sessions can link back to workflow run ids"
        - path: "test/chat-ui-project-module-composer.test.mjs"
          name: "Project module views hide the session composer without changing Terminal behavior"
      public:
        - "/api/chat/rooms*"
        - "/api/chat/sessions*"
        - "/api/chat/projects*"
        - "ProjectsArea"
        - "ProjectsSidebar"
        - "SessionNode"
      failures:
        - "Invalid or changed workflow selection must fail rather than mutate an existing Session contract."
        - "Accessibility/responsive boundary: Session kind and workflow linkage must be conveyed textually, not only by color."
        - "Compatibility boundary: Workflow execution and catalog truth remain SPC-ORCH-005/SPC-ORCH-006."
      confidence: "high"
    - id: "WEB-TOPOLOGY-LIFECYCLE-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "updateRoom"
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "deleteRooms"
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "updateReadCursor"
        - path: "src/apps/chat/data/project-service.ts"
          symbol: "updateProject"
        - path: "src/apps/chat/data/project-service.ts"
          symbol: "deleteProject"
        - path: "src/apps/chat/data/project-service.ts"
          symbol: "setProjectSessionArchived"
      tests:
        - path: "test/chat-web-app-sessions.test.mjs"
          name: "Chat Web mutates and routes historical account sessions by resource existence"
        - path: "test/chat-web-app-sessions.test.mjs"
          name: "Chat Web read state is shared across authenticated accounts"
        - path: "test/project-service-store.test.mjs"
          name: "project session deletion repairs current sessions across projects and is idempotent"
        - path: "test/project-service-store.test.mjs"
          name: "deleting Project files rejects a nested surviving Project without changing files or rows"
        - path: "test/project-service-store.test.mjs"
          name: "Project file deletion detects directory-symlink aliases in both containment directions"
        - path: "test/chat-ui-delete-confirmation-modal-accessibility.test.mjs"
          name: "session and room delete confirmations use the shared labelled modal contract"
        - path: "test/chat-ui-inline-rename-accessibility.test.mjs"
          name: "sidebar inline rename inputs have stable contextual accessible names"
      public:
        - "/api/chat/rooms*"
        - "/api/chat/sessions*"
        - "/api/chat/projects*"
        - "ProjectsArea"
        - "ProjectsSidebar"
        - "SessionNode"
      failures:
        - "Mutation requests must not infer authority from browser state; missing/conflicting resources produce explicit errors."
        - "Accessibility/responsive boundary: Archived and unread state need programmatic labels and headful verification."
        - "Compatibility boundary: Historical account-tagged records remain addressable by current resource existence rules."
      confidence: "high"
    - id: "WEB-TOPOLOGY-TREES-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "listRoomTree"
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "listRoomSubtree"
        - path: "src/apps/chat-ui/src/projects/ProjectsArea.tsx"
          symbol: "ProjectsArea"
        - path: "src/apps/chat-ui/src/session-node.tsx"
          symbol: "SessionNode"
      tests:
        - path: "test/chat-ui-projects-bootstrap.test.mjs"
          name: "Projects bootstrap rejects null or malformed data before sidebar rendering"
        - path: "test/workflow-session-kind.test.mjs"
          name: "project sidebar session nodes expose workflow session kind for real Pibo Sessions only"
      public:
        - "/api/chat/rooms*"
        - "/api/chat/sessions*"
        - "/api/chat/projects*"
        - "ProjectsArea"
        - "ProjectsSidebar"
        - "SessionNode"
      failures:
        - "Malformed nodes must fail closed or be omitted without corrupting current selection."
        - "Accessibility/responsive boundary: Tree rows expose data/ARIA state in source; keyboard traversal and clipping need headful evidence."
        - "Compatibility boundary: Ordering and node schema changes require backward-compatible bootstrap handling."
      confidence: "medium"
---
# Chat Web Rooms, Projects, and Session Trees

## Why

App-global Room/Project topology, normal and workflow Session links, mutations/read state, and deterministic sidebar trees.

## Scope

This specification describes implemented behavior at upstream/dev refresh traceability commit `39090b8850758293e69380a52bb7498d7c955bc2`. Its package parent is accepted base `ba3c2d6611ce8d234f887135af605837333bf751`; the stale brief baseline is not authority.

### In scope

- Owns Web-visible Room/Project topology, product mutation semantics, Session linking metadata, and deterministic tree projection.

### Out of scope

- SPC-DATA-001 owns physical schemas, storage durability, migrations, and transaction guarantees.
- SPC-SEC-001 owns request authorization; login identity does not partition product topology.
- SPC-ORCH-006 owns workflow catalog/Project persistence semantics and run creation.
- SPC-RUN-007 owns native Session history semantics.

## Current behavior

### Routes and state

Room, Session, Project, Project-Session, archive, rename, delete, read-cursor, and workflow-link operations are method-specific Chat API resources. Room hierarchy changes reject cycles. UI state selects app-global resources by stable IDs.

### Cache, stream, files, and media

Tree pages and bootstrap/navigation caches are projections; attached file/media behavior belongs to SPC-WEB-003.

### Lifecycle and failure

Default Room/Project adoption, archive visibility, immutable workflow Session selection/configuration, and delete/rename failures are explicit. Project Session deletion repairs current-Session pointers and coordinates canonical deletion with rollback. File deletion rejects overlapping surviving Project roots, including symlink aliases; keep-files remains explicit. Tree ordering and child linkage must be deterministic.

### Security

Resource existence and App Context authorization gate access; historical account ownership is not a current partition key.

### Accessibility and responsive behavior

Session/Room buttons expose current state, status, archived/unread metadata, contextual inline-rename labels, shared labelled delete confirmation, and mobile sidebar behavior from source. Headful tree navigation is unperformed.

### Compatibility and integration

Legacy personal default Projects can be adopted into shared app-global topology; normal and workflow Sessions retain stable Pibo Session identity.

## Requirements and invariants

### Requirement: WEB-TOPOLOGY-CONTAINERS-001

Rooms and Projects MUST be app-global resources, and default-container adoption MUST preserve existing usable topology without introducing identity-based partitions.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat/data/room-service.ts` — `ChatRoomService`; `src/apps/chat/data/room-service.ts` — `ensureDefaultRoom`; `src/apps/chat/data/room-service.ts` — `listRoomTree`; `src/apps/chat/data/project-service.ts` — `ChatProjectService`; `src/apps/chat/data/project-service.ts` — `ensureSharedDefaultProject`; `src/apps/chat/data/project-service.ts` — `listProjects`
- Tests: `test/chat-web-app-sessions.test.mjs` — “Chat Web treats rooms, sidebar navigation, and mutations as app-global resources”; `test/chat-web-app-sessions.test.mjs` — “Chat Web read state is shared across authenticated accounts”; `test/project-service-workflow-link.test.mjs` — “project service uses app-global storage and lists projects”; `test/project-service-workflow-link.test.mjs` — “shared default project adopts a legacy personal project using the default folder”
- Public surfaces: `/api/chat/rooms*`; `/api/chat/sessions*`; `/api/chat/projects*`; `ProjectsArea`; `ProjectsSidebar`; `SessionNode`
- Failure/security boundary: Ambiguous or missing resources fail by identity; login account is not a topology namespace.
- Accessibility/responsive boundary: App-global labels and current state must remain distinguishable in sidebar controls.
- Compatibility boundary: Legacy default adoption is a compatibility path; storage implementation remains SPC-DATA-001.
- Confidence: **high**
- Verification follow-up: Execute both service suites against isolated stores and add migration coverage for multiple legacy defaults.

### Requirement: WEB-TOPOLOGY-SESSIONS-002

Normal and workflow Project Session records MUST preserve stable Pibo Session identity, selection metadata, configuration, effective-definition snapshots, and later workflow run linkage without changing their Session kind.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat/data/project-service.ts` — `addProjectSession`; `src/apps/chat/data/project-service.ts` — `linkWorkflowRunSession`; `src/apps/chat/data/project-service.ts` — `saveWorkflowSessionSnapshot`; `src/apps/chat/data/project-service.ts` — `startWorkflowSessionRun`; `src/apps/chat/project-workflow-sessions.ts` — `normalizeProjectWorkflowSessionConfiguration`; `src/apps/chat/project-workflow-sessions.ts` — `createProjectWorkflowSessionSnapshot`; `src/apps/chat/project-workflow-sessions.ts` — `createProjectWorkflowRunCurrent`
- Tests: `test/project-service-workflow-link.test.mjs` — “project workflow session records persist selection metadata before runs start”; `test/project-service-workflow-link.test.mjs` — “project workflow session selection and configuration stay immutable after creation”; `test/project-service-workflow-link.test.mjs` — “project workflow session snapshots persist configuration and effective definitions”; `test/project-service-workflow-link.test.mjs` — “project sessions can link back to workflow run ids”
- Public surfaces: `/api/chat/rooms*`; `/api/chat/sessions*`; `/api/chat/projects*`; `ProjectsArea`; `ProjectsSidebar`; `SessionNode`
- Failure/security boundary: Invalid or changed workflow selection must fail rather than mutate an existing Session contract.
- Accessibility/responsive boundary: Session kind and workflow linkage must be conveyed textually, not only by color.
- Compatibility boundary: Workflow execution and catalog truth remain SPC-ORCH-005/SPC-ORCH-006.
- Confidence: **high**
- Verification follow-up: Run Project/workflow link tests and add API-level normal-versus-workflow Session round trips.

### Requirement: WEB-TOPOLOGY-LIFECYCLE-003

Room, Project, and Session rename, archive, delete, and read-state mutations MUST target existing app-global resources and return explicit conflict/not-found failures without account-partition assumptions.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat/data/room-service.ts` — `updateRoom`; `src/apps/chat/data/room-service.ts` — `deleteRooms`; `src/apps/chat/data/room-service.ts` — `updateReadCursor`; `src/apps/chat/data/project-service.ts` — `updateProject`; `src/apps/chat/data/project-service.ts` — `deleteProject`; `src/apps/chat/data/project-service.ts` — `setProjectSessionArchived`
- Tests: `test/chat-web-app-sessions.test.mjs` — “Chat Web mutates and routes historical account sessions by resource existence”; `test/chat-web-app-sessions.test.mjs` — “Chat Web read state is shared across authenticated accounts”
- Public surfaces: `/api/chat/rooms*`; `/api/chat/sessions*`; `/api/chat/projects*`; `ProjectsArea`; `ProjectsSidebar`; `SessionNode`
- Failure/security boundary: Mutation requests must not infer authority from browser state; missing/conflicting resources produce explicit errors.
- Accessibility/responsive boundary: Archived and unread state need programmatic labels and headful verification.
- Compatibility boundary: Historical account-tagged records remain addressable by current resource existence rules.
- Confidence: **high**
- Verification follow-up: Execute mutation tests and add concurrent archive/delete/read-cursor conflict coverage at API boundaries.

### Requirement: WEB-TOPOLOGY-TREES-004

Room and Project trees MUST be deterministic, reject malformed bootstrap payloads before rendering, and preserve selected, archived, status, unread, and workflow-kind metadata in their nodes.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat/data/room-service.ts` — `listRoomTree`; `src/apps/chat/data/room-service.ts` — `listRoomSubtree`; `src/apps/chat-ui/src/projects/ProjectsArea.tsx` — `ProjectsArea`; `src/apps/chat-ui/src/session-node.tsx` — `SessionNode`
- Tests: `test/chat-ui-projects-bootstrap.test.mjs` — “Projects bootstrap rejects null or malformed data before sidebar rendering”; `test/workflow-session-kind.test.mjs` — “project sidebar session nodes expose workflow session kind for real Pibo Sessions only”
- Public surfaces: `/api/chat/rooms*`; `/api/chat/sessions*`; `/api/chat/projects*`; `ProjectsArea`; `ProjectsSidebar`; `SessionNode`
- Failure/security boundary: Malformed nodes must fail closed or be omitted without corrupting current selection.
- Accessibility/responsive boundary: Tree rows expose data/ARIA state in source; keyboard traversal and clipping need headful evidence.
- Compatibility boundary: Ordering and node schema changes require backward-compatible bootstrap handling.
- Confidence: **medium**
- Verification follow-up: Run bootstrap/session-kind tests, add stable-order fixtures, and headfully exercise large trees and archived views.

## Interfaces and ownership

**Capability IDs:** None; this concept projects capabilities owned by linked services.

**Public surfaces:**

- /api/chat/rooms*
- /api/chat/sessions*
- /api/chat/projects*
- ProjectsArea
- ProjectsSidebar
- SessionNode

**Non-owned links:**

- SPC-DATA-001 owns physical schemas, storage durability, migrations, and transaction guarantees.
- SPC-SEC-001 owns request authorization; login identity does not partition product topology.
- SPC-ORCH-006 owns workflow catalog/Project persistence semantics and run creation.
- SPC-RUN-007 owns native Session history semantics.

## Failure and security behavior

- Default Room/Project adoption, archive visibility, immutable workflow Session selection/configuration, and delete/rename failures are explicit. Tree ordering and child linkage must be deterministic.
- Resource existence and App Context authorization gate access; historical account ownership is not a current partition key.

Web browser state, caches, projections, overlays, annotations, and iframe presence do not grant authorization or become durable product authority.

## Accessibility and responsive behavior

Session/Room buttons expose current state, status, archived/unread metadata, and mobile sidebar behavior from source. Headful tree navigation is unperformed.

Source-defined DOM, CSS, and ARIA are implementation evidence only. They do not constitute headful focus, keyboard, pointer, zoom, responsive, screen-reader, PWA, iframe, annotation, or settings acceptance.

## Compatibility and integration behavior

Legacy personal default Projects can be adopted into shared app-global topology; normal and workflow Sessions retain stable Pibo Session identity.

## Known limits

- Evidence gap: No headful tree keyboard/zoom/responsive validation.
- Evidence gap: No focused mutation race or migration suite was executed.

## Reconciled stale claims

- Reject: Rooms, Projects, or read state are partitioned by authenticated account.
- Reject: Projects are disconnected from Workflows.
- Reject: Workflow Session selection/configuration can be silently rewritten after creation.
- Reject: Physical persistence details are owned by this Web spec.

## Verification and traceability

- Source and named-test locators resolve to regular files at upstream/dev refresh commit `39090b8850758293e69380a52bb7498d7c955bc2`.
- Imported or re-exported symbols use their canonical upstream/dev refresh definition files in traceability.
- Source inspection was performed for every requirement; five package requirements remain source-only exactly where no named test exists.
- Focused tests, the OKF validator suite, typecheck, build, package, diff, link/navigation, and archive-byte checks were run only after authoring and are reported outside this committed package.
- Headful visual/focus/keyboard/pointer/responsive/PWA/iframe/annotation/settings/VS Code acceptance was not performed.
- External provider, gateway restart/deployment, Pibo2, and real same-origin code-server acceptance was not performed.
- Confidence measures trace quality, not execution of an unclaimed evidence class.

Package verification commands:

- `cd /root/code/pibo-okf-docs && node --test test/chat-web-app-sessions.test.mjs test/project-service-workflow-link.test.mjs test/chat-ui-projects-bootstrap.test.mjs`

## Related concepts

- SPC-DATA-001
- SPC-SEC-001
- SPC-ORCH-006
- SPC-WEB-001
