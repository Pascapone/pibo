# Coverage Analysis: API Surface Coverage 2026-05-11

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code  
**Related docs:** `GLOSSARY.md`, [Chat Web Bootstrap and Navigation API](../capabilities/chat-web-bootstrap-and-navigation-api.md), [Chat Web Rooms and Event Streams](../capabilities/chat-web-rooms-and-event-streams.md), [Context Files](../capabilities/context-files.md), [Simple Agent HTTP API](../capabilities/simple-agent-http-api.md), [Web Auth and Same-Origin Host](../capabilities/web-auth-and-same-origin-host.md)

## Why

Pibo exposes most product behavior through local same-origin HTTP APIs. The current `docs/specs/` tree contains many capability specs, so adding another broad API spec would likely duplicate existing contracts. This analysis checks the implemented API surface against the existing specs and identifies only narrow seams that future scheduled runs should strengthen.

## Goal

Confirm that the current source-backed HTTP API surface is mapped to durable specs, and name the remaining weak API seams without creating duplicate capability specs.

## Scope

### In Scope

- Chat Web API routes under `/api/chat/*` implemented by `src/apps/chat/web-app.ts`.
- Context Files API routes under `/api/context-files/*` implemented by `src/plugins/context-files.ts`.
- Simple Agent API health and send-message behavior implemented by `src/api/simple-agent-api.ts`.
- Same-origin web host routing behavior implemented by `src/web/http.ts` and web app registration.
- Existing specs under `docs/specs/` as the coverage target.

### Out of Scope

- Rewriting source code or changing route behavior.
- Treating legacy docs as authority over current code.
- Endpoint-by-endpoint OpenAPI generation.
- UI layout details except where an API contract exists only for a Chat Web area.

## Current Coverage Matrix

| Implemented API surface | Primary source | Existing spec owner | Coverage decision |
|---|---|---|---|
| Chat bootstrap, navigation, session pages, selected session reads | `src/apps/chat/web-app.ts`, `src/apps/chat/data/*query-service.ts` | `chat-web-bootstrap-and-navigation-api.md` | Covered |
| Rooms, room membership checks, read marks, SSE event replay | `src/apps/chat/web-app.ts`, `src/apps/chat/data/room-service.ts`, `src/apps/chat/data/read-state-service.ts`, `src/apps/chat/data/timeline-query-service.ts` | `chat-web-rooms-and-event-streams.md` | Covered |
| Trace summary, trace pages, raw-event and sequence diagnostics | `src/apps/chat/web-app.ts`, `src/apps/chat/trace.ts`, `src/shared/trace-engine.ts` | `chat-web-trace-and-terminal-view.md`, `chat-web-trace-render-diagnostics.md` | Covered |
| Message send and gateway action POSTs | `src/apps/chat/web-app.ts`, `src/core/session-router.ts`, `src/gateway/request.ts` | `pibo-event-contract.md`, `core-gateway-actions-and-session-controls.md` | Covered |
| File download API and `/download` slash command | `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/App.tsx` | `chat-web-file-download.md`, `chat-web-slash-command-surface.md` | Covered |
| Cron and Ralph management APIs | `src/apps/chat/cron-api.ts`, `src/apps/chat/ralph-api.ts` | `scheduled-pibo-jobs.md`, `continuous-ralph-jobs.md` | Covered |
| Projects and Project Sessions APIs | `src/apps/chat/web-app.ts`, `src/apps/chat/data/project-service.ts` | `chat-web-projects-area.md` | Covered |
| Agent catalog and custom-agent CRUD APIs | `src/apps/chat/web-app.ts`, `src/apps/chat/agent-store.ts`, `src/apps/chat/agent-profiles.ts` | `custom-agents.md`, `plugin-registry-and-capability-catalog.md` | Covered |
| Model defaults, provider settings, user settings | `src/apps/chat/web-app.ts`, `src/apps/chat/model-catalog.ts`, `src/auth/login-actions.ts`, `src/core/user-settings.ts` | `model-provider-auth-and-session-selection.md`, `chat-web-settings-area.md` | Covered |
| Pi packages, user skills, MCP server context endpoints | `src/apps/chat/web-app.ts`, `src/pi-packages/*`, `src/user-skills/*`, `src/mcp/*` | `pi-packages.md`, `user-skills.md`, `mcp-server-integration.md`, `chat-web-context-area.md` | Covered |
| Base prompt and compaction prompt endpoints | `src/apps/chat/web-app.ts`, `src/core/base-prompt.ts`, `src/core/compaction-prompt.ts` | `runtime-prompt-and-compaction.md`, `chat-web-context-area.md` | Covered |
| Signals event stream and signal tree APIs | `src/apps/chat/web-app.ts`, `src/signals/*` | `pibo-session-signals.md` | Covered |
| Context Files standalone API and SSE | `src/plugins/context-files.ts`, `src/plugins/context-files-store.ts` | `context-files.md`, `product-event-bus.md` | Covered |
| Simple Agent HTTP API | `src/api/simple-agent-api.ts` | `simple-agent-http-api.md` | Covered |
| Static app, asset, auth, health, and gateway-status routing | `src/web/http.ts`, `src/plugins/web.ts`, `src/apps/chat/web-app.ts`, `src/plugins/context-files.ts` | `web-auth-and-same-origin-host.md`, `chat-web-static-shell-and-pwa-assets.md` | Covered |

## Findings and Future Work

### Finding: Debug-only Chat Web endpoints are intentionally covered as diagnostics, not user API contracts

`/api/chat/debug/persistence` and `/api/chat/debug/trace-at-sequence` are implemented beside normal Chat Web APIs. Existing specs treat trace diagnostics as support behavior rather than core chat API behavior.

#### Acceptance for future strengthening

- Debug endpoints remain read-only or explicitly diagnostic.
- Debug endpoints require the same authenticated Chat Web session boundary as nearby trace APIs.
- A future diagnostic spec update names their request and response shape if agents begin relying on them.

### Finding: API surfaces are covered by capability specs rather than one monolithic API spec

The source tree groups routes by product capability, and the existing specs follow that boundary. A single `/api/chat/*` spec would duplicate more precise capability specs and would age poorly as new areas are added.

#### Acceptance for future scheduled runs

- New API routes should be added to the owning capability spec before creating a generic API spec.
- If a route crosses multiple capabilities, the spec should name the source-of-truth owner and link related specs.
- Coverage analyses should be used only when the API surface is already mapped and no new behavior contract is needed.

### Finding: Cross-cutting same-origin JSON mutation rules are scattered but sufficiently specified

Chat Web and Context Files mutations both enforce authenticated sessions and same-origin or JSON request checks through local helper code. The same-origin host and capability specs name this behavior, but no single table lists every mutating route.

#### Acceptance for future strengthening

- Security-sensitive specs should include at least one same-origin mutation rejection scenario.
- A future validation script could enumerate mutating routes and verify that each route passes through a shared JSON/origin guard or documents why it does not.
- Route inventory should be generated from source if it becomes a release artifact, not maintained manually in prose.

## Coverage Decision

No new capability spec is warranted from this run. The implemented API surface is already covered by focused capability specs. Future work should tighten verification rows in the owning specs rather than create a duplicate all-APIs contract.

## Success Criteria

- [x] SC-001: Existing specs were inspected before creating this coverage artifact.
- [x] SC-002: Current API routes were grouped by source-backed capability owner.
- [x] SC-003: No duplicate broad API capability spec was created.
- [x] SC-004: Remaining weak seams are stated as future acceptance checks.

## Verification Basis

- `GLOSSARY.md`
- `AGENTS.md`
- `docs/specs/README.md`
- `docs/specs/capabilities/chat-web-bootstrap-and-navigation-api.md`
- `docs/specs/capabilities/chat-web-rooms-and-event-streams.md`
- `docs/specs/capabilities/chat-web-trace-and-terminal-view.md`
- `docs/specs/capabilities/context-files.md`
- `docs/specs/capabilities/simple-agent-http-api.md`
- `docs/specs/capabilities/web-auth-and-same-origin-host.md`
- `src/apps/chat/web-app.ts`
- `src/apps/chat/cron-api.ts`
- `src/apps/chat/ralph-api.ts`
- `src/apps/chat/data/project-service.ts`
- `src/plugins/context-files.ts`
- `src/api/simple-agent-api.ts`
- `src/web/http.ts`
