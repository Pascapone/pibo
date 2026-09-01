---
type: Specification
title: Workflow Catalog, Publishing, and Project Execution
description: Defines the implemented workflow catalog, publishing, and project execution contract and its current ownership,
  security, compatibility, and verification boundaries.
tags:
- orchestration
- workflows
status: stable
authority: normative
generated:
  by: openai/codex
  at: '2026-08-30T09:44:54Z'
sources:
- resource: scope:Current implementation and tests at traceability.commit
  title: upstream/dev refresh source and test evidence for SPC-ORCH-006
implementation:
  state: current
  baseline_commit: 39090b8850758293e69380a52bb7498d7c955bc2
  package: WP-04-ORCHESTRATION
  source_evidence: performed
  focused_test_execution: performed in Docker after authoring; see implementation report
  build_and_typecheck_execution: performed in Docker after authoring; see implementation report
traceability:
  commit: 39090b8850758293e69380a52bb7498d7c955bc2
  requirements:
  - id: ORCH-WFP-001
    status: implemented
    sources:
    - path: src/apps/chat/workflow-persistence.ts
      symbol: ChatWorkflowDraftStore
    - path: src/apps/chat/workflow-persistence.ts
      symbol: ChatWorkflowPublishedVersionStore
    - path: src/apps/chat/workflow-persistence.ts
      symbol: ChatWorkflowPromptAssetStore
    - path: src/apps/chat/workflow-persistence.ts
      symbol: ChatWorkflowArchiveStore
    - path: src/apps/chat/workflow-persistence.ts
      symbol: ChatWorkflowTombstoneStore
    - path: src/apps/chat/workflow-persistence.ts
      symbol: ChatWorkflowLifecycleEventStore
    - path: src/apps/chat/workflow-catalog.ts
      symbol: buildWorkflowCatalogList
    - path: src/apps/chat/workflow-catalog.ts
      symbol: workflowCatalogActionsFor
    tests:
    - path: test/workflow-v2-lifecycle-checklist.test.mjs
      name: Workflow V2 lifecycle tests cover immutable publish records and registry visibility
    - path: test/workflow-v2-lifecycle-checklist.test.mjs
      name: Workflow V2 lifecycle tests cover archive filters, delete tombstones, and historical snapshots
    failures:
    - The named checklist tests inspect expected source/test coverage rather than exercising all stores; same-origin/auth
      enforcement lives in Web request handling.
    confidence: medium
  - id: ORCH-WFP-002
    status: implemented
    sources:
    - path: src/apps/chat/chat-api-routes.ts
      symbol: workflowDraftActionResource
    - path: src/apps/chat/chat-api-routes.ts
      symbol: workflowDraftManualTriggerRunResource
    - path: src/apps/chat/workflow-manual-trigger-runtime.ts
      symbol: runWorkflowManualTextTrigger
    - path: src/apps/chat/workflow-manual-trigger-runtime.ts
      symbol: validateWorkflowManualTextTrigger
    - path: src/apps/chat/web-app.ts
      symbol: createChatWebApp
    - path: src/apps/chat/web-app.ts
      symbol: requireSameOriginJsonRequest
    tests:
    - path: test/workflow-v2-security-boundary.test.mjs
      name: Workflow V2 security boundary is covered by backend auth, validation, redaction, and visibility gates
    - path: test/workflow-v2-lifecycle-checklist.test.mjs
      name: Workflow V2 catalog and lifecycle checklist tests cover US-022 storage and API gates
    failures:
    - Checklist tests are static coverage checks. Real manual traversal behavior is covered under SPC-ORCH-005; no inline
      code may bypass registered refs.
    confidence: medium
  - id: ORCH-WFP-003
    status: implemented
    sources:
    - path: src/apps/chat/project-workflow-sessions.ts
      symbol: normalizeProjectWorkflowSessionConfiguration
    - path: src/apps/chat/project-workflow-sessions.ts
      symbol: createProjectWorkflowSessionSnapshot
    - path: src/apps/chat/project-workflow-sessions.ts
      symbol: createProjectWorkflowRunCurrent
    - path: src/apps/chat/data/project-service.ts
      symbol: ChatProjectService.addProjectSession
      owner: ChatProjectService
      member: addProjectSession
    - path: src/apps/chat/data/project-service.ts
      symbol: ChatProjectService.saveWorkflowSessionSnapshot
      owner: ChatProjectService
      member: saveWorkflowSessionSnapshot
    - path: src/apps/chat/data/project-service.ts
      symbol: ChatProjectService.startWorkflowSessionRun
      owner: ChatProjectService
      member: startWorkflowSessionRun
    - path: src/apps/chat/chat-api-routes.ts
      symbol: projectWorkflowSessionStartResource
    tests:
    - path: test/project-service-workflow-link.test.mjs
      name: project workflow session selection and configuration stay immutable after creation
    - path: test/project-service-workflow-link.test.mjs
      name: project workflow session snapshots persist configuration and effective definitions
    - path: test/project-service-workflow-link.test.mjs
      name: project workflow start creates one run per configured session
    - path: test/project-service-workflow-link.test.mjs
      name: project sessions can link back to workflow run ids
    failures:
    - Mismatched project/session/workflow identity is rejected; current start persists initial running/current state but does
      not execute nodes.
    confidence: high
  - id: ORCH-WFP-004
    status: implemented
    sources:
    - path: src/apps/chat/data/project-service.ts
      symbol: ChatProjectService.saveProjectWorkflowWaitToken
      owner: ChatProjectService
      member: saveProjectWorkflowWaitToken
    - path: src/apps/chat/data/project-service.ts
      symbol: ChatProjectService.resolveProjectWorkflowHumanAction
      owner: ChatProjectService
      member: resolveProjectWorkflowHumanAction
    - path: src/apps/chat/chat-api-routes.ts
      symbol: projectWorkflowHumanActionsResource
    - path: src/apps/chat/web-app.ts
      symbol: createChatWebApp
    - path: src/apps/chat/web-app.ts
      symbol: requireSameOriginJsonRequest
    tests:
    - path: test/web-channel.test.mjs
      name: chat web app resolves Project workflow human wait tokens through preserved workflow APIs
    - path: test/workflow-v2-security-boundary.test.mjs
      name: Workflow V2 security boundary surfaces auth, capability, compute, and data-sensitivity copy
    failures:
    - Unknown, cross-session, expired, replayed, or unoffered actions fail. The project-store resolver does not enforce token.schema
      payload validation; do not claim that guarantee without tracing a higher-layer validator.
    confidence: medium
---
# Spec: Workflow Catalog, Publishing, and Project Execution


## Why

Workflow product state needs immutable publication and Project-linked snapshots without overstating the current execution path as a general durable graph runner.

## Goal

The Chat workflow catalog and Project services define lifecycle, manual draft execution, immutable snapshots, initial runs, waits, actions, and app-global visibility.

## Authority and ownership

- **Stable concept:** `SPC-ORCH-006`
- **Target path:** `docs/specs/orchestration/workflow-catalog-and-project-execution.md`
- **Authority:** upstream/dev refresh source and test evidence at `39090b8850758293e69380a52bb7498d7c955bc2`.
- **Normative owner:** This document owns the public surfaces and behavior listed below. Generic reliability schemas, product/session topology, gateway authorization, runtime adapters, resource policy, and Web rendering remain owned by their linked specifications.
- **Evidence rule:** Source and named-test locators are exact references to regular Git blobs at the upstream/dev refresh commit. They identify evidence; they do not imply that real CLI, process, provider, browser, Windows, host-pressure, restart, or Pibo2 paths were executed.

## Public surfaces

- `/api/chat/workflows*`
- `/api/chat/projects/:projectId/workflow-sessions`
- `/api/chat/projects/:projectId/workflow-sessions/:piboSessionId/start`
- `/api/chat/projects/:projectId/workflow-sessions/:piboSessionId/human-actions`
- `workflow_ui_drafts`
- `workflow_published_versions`
- `workflow_prompt_assets`
- `workflow_prompt_asset_revisions`
- `workflow_archive_states`
- `workflow_delete_tombstones`
- `workflow_lifecycle_events`
- `project_workflow_session_snapshots`
- `project_workflow_runs`
- `project_workflow_wait_tokens`
- `project_workflow_human_actions`

## Current implemented contract

### Catalog Api

Authenticated Chat API supports workflow list/create/inspect/delete, versions, duplicate/next draft/archive, draft get/patch/validate/publish/manual-trigger, prompt assets, lifecycle events, and profile/handler/guard/adapter/human-action/prompt-asset/workflow-version/version-history pickers. Mutations require same-origin JSON.

### Publishing

One active draft per workflow; publish is validation-gated and idempotent for the same draft; published id+version records are immutable and content-hashed; version bumps are patch/minor/major. Archive hides by default. Code workflows are read-only. Delete requires exact workflowId confirmation and preserves historical snapshots/links.

### Manual Execution

Draft manual trigger uses the Chat-owned trigger-to-agent traversal, defaults to a 120 s message wait, creates normal agent Pibo Sessions, and rejects joins/unsupported graph shapes. It is distinct from a durable catalog run executor.

### Project

Project workflow session creation persists immutable selection/configuration and a pinned snapshot of published/effective definitions, prompt asset revisions, runtime choices, inputs, and validation. Start is idempotent and creates one running run with initial current state; no source evidence shows it advancing the graph.

### Human Actions

Project wait/action records are transactionally owner/session/run scoped; pending token saves move run/session to waiting; resolution checks existence, ownership, pending state, expiry, and offered action, then resumes or cancels. This project method does not validate payload against token.schema.

### Visibility

Workflow product data is app-global after authentication, not tenant-partitioned by account.

## Scope

### In scope

- /api/chat/workflows*
- /api/chat/projects/:projectId/workflow-sessions
- /api/chat/projects/:projectId/workflow-sessions/:piboSessionId/start
- /api/chat/projects/:projectId/workflow-sessions/:piboSessionId/human-actions
- workflow_ui_drafts
- workflow_published_versions
- workflow_prompt_assets
- workflow_prompt_asset_revisions
- workflow_archive_states
- workflow_delete_tombstones
- workflow_lifecycle_events
- project_workflow_session_snapshots
- project_workflow_runs
- project_workflow_wait_tokens
- project_workflow_human_actions
- The current source-grounded behavior and its explicit limits.
- Cross-owner links needed to use the contract safely.

### Out of scope

- Unimplemented future workflow webhook or Cron triggers.
- A claim that manual traversal and separate dispatch primitives form a universal integrated, restart-resuming graph executor.
- Provider, browser, host, Windows, Pibo2, or real process-path guarantees not established by executed validation.

## Requirements

### Requirement: ORCH-WFP-001

The product layer MUST persist one active workflow draft, revisioned prompt assets, immutable content-hashed published versions, archive/tombstone state, and lifecycle events; code workflows MUST remain read-only and deletion MUST preserve historical references.

**Confidence:** `medium`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

The named checklist tests inspect expected source/test coverage rather than exercising all stores; same-origin/auth enforcement lives in Web request handling.

#### Acceptance evidence

- Exact source evidence:
  - `src/apps/chat/workflow-persistence.ts:145` — `ChatWorkflowDraftStore` (exported_symbol)
  - `src/apps/chat/workflow-persistence.ts:286` — `ChatWorkflowPublishedVersionStore` (exported_symbol)
  - `src/apps/chat/workflow-persistence.ts:413` — `ChatWorkflowPromptAssetStore` (exported_symbol)
  - `src/apps/chat/workflow-persistence.ts:567` — `ChatWorkflowArchiveStore` (exported_symbol)
  - `src/apps/chat/workflow-persistence.ts:649` — `ChatWorkflowTombstoneStore` (exported_symbol)
  - `src/apps/chat/workflow-persistence.ts:748` — `ChatWorkflowLifecycleEventStore` (exported_symbol)
  - `src/apps/chat/workflow-catalog.ts:381` — `buildWorkflowCatalogList` (exported_symbol)
  - `src/apps/chat/workflow-catalog.ts:542` — `workflowCatalogActionsFor` (exported_symbol)
- Exact named tests:
  - `test/workflow-v2-lifecycle-checklist.test.mjs:61` — “Workflow V2 lifecycle tests cover immutable publish records and registry visibility”
  - `test/workflow-v2-lifecycle-checklist.test.mjs:172` — “Workflow V2 lifecycle tests cover archive filters, delete tombstones, and historical snapshots”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-WFP-002

Publish and manual draft execution MUST pass current definition, schema, registry-ref, and no-inline-code validation; manual execution MUST use the implemented trigger-to-agent subset and fail unsupported joins/shapes explicitly.

**Confidence:** `medium`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

Checklist tests are static coverage checks. Real manual traversal behavior is covered under SPC-ORCH-005; no inline code may bypass registered refs.

#### Acceptance evidence

- Exact source evidence:
  - `src/apps/chat/chat-api-routes.ts:92` — `workflowDraftActionResource` (exported_symbol)
  - `src/apps/chat/chat-api-routes.ts:106` — `workflowDraftManualTriggerRunResource` (exported_symbol)
  - `src/apps/chat/workflow-manual-trigger-runtime.ts:72` — `runWorkflowManualTextTrigger` (exported_symbol)
  - `src/apps/chat/workflow-manual-trigger-runtime.ts:156` — `validateWorkflowManualTextTrigger` (exported_symbol)
  - `src/apps/chat/web-app.ts:4457` — `createChatWebApp` (exported_symbol)
  - `src/apps/chat/web-app.ts:712` — `requireSameOriginJsonRequest` (exported_symbol)
- Exact named tests:
  - `test/workflow-v2-security-boundary.test.mjs:33` — “Workflow V2 security boundary is covered by backend auth, validation, redaction, and visibility gates”
  - `test/workflow-v2-lifecycle-checklist.test.mjs:28` — “Workflow V2 catalog and lifecycle checklist tests cover US-022 storage and API gates”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-WFP-003

Project workflow session creation MUST persist immutable configuration and pinned effective-definition/prompt-asset snapshots linked to a normal Pibo Session; start MUST be idempotent and create at most one persisted run for that configured session.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

Mismatched project/session/workflow identity is rejected; current start persists initial running/current state but does not execute nodes.

#### Acceptance evidence

- Exact source evidence:
  - `src/apps/chat/project-workflow-sessions.ts:64` — `normalizeProjectWorkflowSessionConfiguration` (exported_symbol)
  - `src/apps/chat/project-workflow-sessions.ts:88` — `createProjectWorkflowSessionSnapshot` (exported_symbol)
  - `src/apps/chat/project-workflow-sessions.ts:156` — `createProjectWorkflowRunCurrent` (exported_symbol)
  - `src/apps/chat/data/project-service.ts:348` — `ChatProjectService.addProjectSession` (method)
  - `src/apps/chat/data/project-service.ts:393` — `ChatProjectService.saveWorkflowSessionSnapshot` (method)
  - `src/apps/chat/data/project-service.ts:659` — `ChatProjectService.startWorkflowSessionRun` (method)
  - `src/apps/chat/chat-api-routes.ts:232` — `projectWorkflowSessionStartResource` (exported_symbol)
- Exact named tests:
  - `test/project-service-workflow-link.test.mjs:159` — “project workflow session selection and configuration stay immutable after creation”
  - `test/project-service-workflow-link.test.mjs:283` — “project workflow session snapshots persist configuration and effective definitions”
  - `test/project-service-workflow-link.test.mjs:355` — “project workflow start creates one run per configured session”
  - `test/project-service-workflow-link.test.mjs:450` — “project sessions can link back to workflow run ids”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-WFP-004

Project wait tokens and human actions MUST persist transactionally and be scoped to exact project/session/run ownership; only a pending, unexpired token offering the requested action may resolve, after which run/session state MUST resume or cancel atomically.

**Confidence:** `medium`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

Unknown, cross-session, expired, replayed, or unoffered actions fail. The project-store resolver does not enforce token.schema payload validation; do not claim that guarantee without tracing a higher-layer validator.

#### Acceptance evidence

- Exact source evidence:
  - `src/apps/chat/data/project-service.ts:456` — `ChatProjectService.saveProjectWorkflowWaitToken` (method)
  - `src/apps/chat/data/project-service.ts:567` — `ChatProjectService.resolveProjectWorkflowHumanAction` (method)
  - `src/apps/chat/chat-api-routes.ts:244` — `projectWorkflowHumanActionsResource` (exported_symbol)
  - `src/apps/chat/web-app.ts:4457` — `createChatWebApp` (exported_symbol)
  - `src/apps/chat/web-app.ts:712` — `requireSameOriginJsonRequest` (exported_symbol)
- Exact named tests:
  - `test/web-channel.test.mjs:6670` — “chat web app resolves Project workflow human wait tokens through preserved workflow APIs”
  - `test/workflow-v2-security-boundary.test.mjs:15` — “Workflow V2 security boundary surfaces auth, capability, compute, and data-sensitivity copy”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

## Ownership links

- [`reliability.md`](/specs/data/reliability.md)
- [`sessions-and-runtime-bindings.md`](/specs/data/sessions-and-runtime-bindings.md)
- [`routing-events-and-actions.md`](/specs/gateway/routing-events-and-actions.md)
- [`web-host-and-channel.md`](/specs/gateway/web-host-and-channel.md)
- [`agents-and-profiles.md`](/specs/resources/agents-and-profiles.md)
- Web workflow rendering is a projection and interaction surface; it does not replace this package's durable facts.

## Verification boundary

- Source/test baseline: `39090b8850758293e69380a52bb7498d7c955bc2`.
- Focused inventory: 24 files / 245 top-level declarations; `test/web-channel.test.mjs` is separate cross-boundary evidence with 113 declarations.
- Requirement traceability: 25 unique requirements across six targets, 15 high confidence and 10 medium confidence, 138 source references, 75 named-test references / 74 unique names.
- This document is stable normative documentation of current behavior, not acceptance of future implementation work.
