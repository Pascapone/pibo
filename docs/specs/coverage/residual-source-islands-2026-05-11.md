# Coverage Analysis: Residual Source Islands 2026-05-11

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code  
**Related docs:** `GLOSSARY.md`, `AGENTS.md`, [Source Specs Gap Analysis 2026-05-11](./source-specs-gap-analysis-2026-05-11.md), [Chat Web Rooms and Event Streams](../capabilities/chat-web-rooms-and-event-streams.md), [Chat Web Output Compaction and Stream Projection](../capabilities/chat-web-output-compaction-and-stream-projection.md), [Web Auth and Same-Origin Host](../capabilities/web-auth-and-same-origin-host.md), [MCP Server Integration](../capabilities/mcp-server-integration.md), [Pibo Workflow Framework Package](../capabilities/pibo-workflow-framework-package.md)

## Why

The current `docs/specs/` tree now covers the major product, runtime, gateway, web, data, MCP, workflow, tool, cron, Ralph, auth, and deployment capabilities. A new broad capability spec in this run would duplicate existing contracts.

This artifact records the remaining small source islands inspected in this run. Each island is real implementation behavior, but each is better owned by an existing capability spec unless it grows into a separate public contract.

## Goal

Future scheduled source-spec runs SHALL use this analysis to update the owning existing spec or add focused tests, rather than creating duplicate specs for helper modules already covered by broader behavior contracts.

## Scope

### In Scope

- Current helper and seam files inspected from `src/apps/chat/`, `src/web/`, `src/mcp/`, `src/gateway/`, and `packages/workflows/`.
- Existing specs under `docs/specs/`.
- Direct tests that demonstrate whether a seam is already behavior-tested.

### Out of Scope

- Source-code changes.
- Docker worker setup.
- Legacy documents as truth over current code.
- Rewriting existing capability specs only to change style.

## Findings

### Finding: Chat Web archive metadata is a helper seam, not a standalone capability

`src/apps/chat/session-metadata.ts` stores Chat Web session archive state under `metadata.chatWebArchivedAt`. This behavior is visible through Chat Web bootstrap, room/session mutation, pagination, and deletion flows.

The owning specs are `chat-web-rooms-and-event-streams.md`, `chat-web-bootstrap-and-navigation-api.md`, and `chat-web-cache-and-live-state.md`. A standalone archive-metadata spec would duplicate those contracts unless archive metadata becomes a reusable cross-channel product API.

#### Future acceptance

- The owning Chat Web specs should keep archive behavior expressed as user-visible session visibility, mutation, and deletion requirements.
- If tests are added, they should assert that `PATCH /api/chat/sessions/:id` toggles visibility through the public API rather than only asserting the helper key name.
- The metadata key may be mentioned as source basis, but the durable behavior is archive visibility and delete preconditions.

### Finding: Output event policy helpers are covered by compaction and trace specs

`src/apps/chat/output-event-policy.ts` defines live-only output events and stable aggregation keys for assistant, thinking, and tool output. `src/apps/chat/output-compactor.ts` uses those helpers to produce live events, persisted events, and snapshots.

The owning spec is `chat-web-output-compaction-and-stream-projection.md`. The helper functions should remain implementation details unless another product surface starts consuming the key format directly.

#### Future acceptance

- The compaction spec should remain behavior-first: live deltas are snapshot-only, final messages persist, and boundaries flush incomplete buffers.
- Tests should prefer compactor input/output scenarios over direct key-string assertions unless cross-module compatibility depends on the exact key format.
- Any future change to include a new live-only event type must update the compaction spec and trace projection tests together.

### Finding: Web HTTP compression and body limits are already part of the same-origin host contract

`src/web/http.ts` implements request body limits, JSON/HTML response helpers, Fetch-to-Node response sending, `Set-Cookie` preservation, and gzip compression for large JSON responses. `test/web-http.test.mjs` directly verifies gzip behavior, q=0 handling, Brotli non-support, and the small-response threshold.

The owning spec is `web-auth-and-same-origin-host.md`, specifically its HTTP request/response requirement and verification coverage. A separate HTTP helper spec would split behavior that is only externally meaningful through the web host.

#### Future acceptance

- Keep HTTP helper behavior in the web host spec unless response compression becomes configurable or exposed as an operator-tuned capability.
- Add focused tests only for externally visible gaps, such as `Set-Cookie` preservation or non-compressible `204`/`304` responses.
- Do not duplicate compression rules in Chat Web app specs.

### Finding: MCP agent context injection is sufficiently covered by MCP integration

`src/mcp/agent-context.ts` reads local MCP config metadata, enforces short non-empty Pibo descriptions, hides raw config fields from Chat Web metadata, and generates `.pibo/context/enabled-mcp-servers.md` only for selected described servers. `test/mcp-agent-context.test.mjs` directly verifies catalog metadata and runtime inspection injection.

The owning spec is `mcp-server-integration.md`. The current traceability already maps Chat Web metadata, custom-agent selection, and runtime context injection to direct tests.

#### Future acceptance

- If selected-but-undescribed MCP servers should warn during profile inspection, update `mcp-server-integration.md` rather than creating a separate context-injection spec.
- Keep raw MCP config fields out of Chat Web catalog responses.
- Keep runtime context compact and generated from metadata only; it must not connect to MCP servers.

### Finding: Workflow package seams are better handled inside the package capability spec

`packages/workflows/src/index.ts` exposes the package root, and package-level tests cover authoring, registry, validation, runtime, store, inspection, XState, and fixtures. `pibo-workflow-framework-package.md` now has a direct verification matrix across those tests.

A new workflow spec should be created only for a new product capability, such as a Chat Web workflow authoring UI or a workflow execution service outside the package boundary.

#### Future acceptance

- Package API changes update `pibo-workflow-framework-package.md` and package tests.
- Product-level workflow surfaces use separate specs only when behavior crosses into Chat Web, Projects, gateway actions, or session routing.
- The Workflow System V1 change specs remain planning/design references, not source-of-truth claims against unimplemented behavior.

## Coverage Decision

No new capability spec was created in this run because the inspected seams are already owned by existing behavior specs. The most useful action was to add this residual coverage note so future runs can avoid duplicating helper-level specs and instead tighten the owning capability specs or tests.

## Success Criteria

- [x] SC-001: Existing `docs/specs/` were inspected before choosing this artifact.
- [x] SC-002: The artifact lives under `docs/specs/coverage/` because a duplicate capability spec would be lower value.
- [x] SC-003: Each inspected source island names the owning existing spec.
- [x] SC-004: Each finding gives a concrete acceptance rule for future source-spec or test work.
- [x] SC-005: No source code, gateway, host, or Docker changes were made.

## Verification Basis

This analysis is based on the current workspace files:

- `GLOSSARY.md`
- `AGENTS.md`
- full `docs/specs/` inventory
- `src/apps/chat/session-metadata.ts`
- `src/apps/chat/output-event-policy.ts`
- `src/apps/chat/output-compactor.ts`
- `src/apps/chat/trace.ts`
- `src/web/http.ts`
- `src/mcp/agent-context.ts`
- `src/gateway/server.ts`
- `packages/workflows/src/index.ts`
- `packages/workflows/package.json`
- `test/web-http.test.mjs`
- `test/mcp-agent-context.test.mjs`
- `test/gateway-backpressure-subscriptions.test.mjs`
- workflow package tests referenced by `docs/specs/capabilities/pibo-workflow-framework-package.md`
