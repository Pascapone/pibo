# Coverage Analysis: Source Compatibility Seams 2026-05-11

**Status:** Draft
**Created:** 2026-05-11
**Controller / Source:** Scheduled Pibo Source Specs Coverage; current workspace code
**Related docs:** `GLOSSARY.md`, `AGENTS.md`, [Source Specs Gap Analysis 2026-05-11](./source-specs-gap-analysis-2026-05-11.md), [Residual Source Islands 2026-05-11](./residual-source-islands-2026-05-11.md)

## Why

The current source tree is now broadly covered by behavior specs. The remaining unspecific source paths are mostly compatibility seams: type-only modules, re-export facades, and thin plugin wrappers that preserve import paths while delegating real behavior to already specified capabilities.

Creating standalone capability specs for these files would duplicate the owning specs. This coverage analysis records how future source-spec runs should treat these seams and when a seam should graduate into a behavior spec.

## Goal

Future scheduled coverage runs SHALL treat source compatibility seams as managed by their downstream behavior specs unless the seam exposes independent observable behavior, validation, persistence, security, or operator output.

## Scope

### In Scope

- Current type-only and re-export source files under `src/apps/chat/`, `src/auth/`, `src/cron/`, `src/pi-packages/`, `src/plugins/`, `src/signals/`, `src/tools/runtime/`, and `src/user-skills/`.
- Current MCP CLI output/version helpers.
- Current Chat Web compact terminal component seams.
- Existing specs under `docs/specs/`.

### Out of Scope

- Source-code or test changes.
- Docker worker usage.
- Legacy documents as source of truth.
- Creating duplicate capability specs for already covered behavior.

## Findings

### Finding: Chat Web compatibility exports are managed by Chat Web data specs

`src/apps/chat/event-log.ts`, `src/apps/chat/read-model.ts`, `src/apps/chat/rooms.ts`, `src/apps/chat/types/event-store.ts`, and `src/apps/chat/types/read-model.ts` preserve named import surfaces for Chat Web event, read-model, and room types. They do not add runtime behavior beyond the data services and room/event APIs.

#### Owning specs

- `docs/specs/capabilities/chat-web-rooms-and-event-streams.md`
- `docs/specs/capabilities/chat-web-bootstrap-and-navigation-api.md`
- `docs/specs/capabilities/pibo-data-store-and-ingestion.md`
- `docs/specs/capabilities/local-store-stewardship-and-canonical-data-boundaries.md`

#### Future acceptance

- If these modules remain type-only or re-export-only, update owning specs when behavior changes rather than creating a separate seam spec.
- If a compatibility module starts validating, migrating, filtering, or serializing data at runtime, add a requirement to the owning Chat Web/data spec with a direct scenario.
- Do not make the facade file path itself the durable behavior; the contract is the API and data shape consumed by Chat Web.

### Finding: Plugin wrapper seams are managed by registry and capability specs

`src/plugins/chat-web.ts` and `src/cron/plugin.ts` register a web app or channel through `definePiboPlugin`. Their observable behavior is the registered capability, not the wrapper file.

#### Owning specs

- `docs/specs/capabilities/plugin-registry-and-capability-catalog.md`
- `docs/specs/capabilities/chat-web-rooms-and-event-streams.md`
- `docs/specs/capabilities/scheduled-pibo-jobs.md`

#### Future acceptance

- Wrapper ids and names should stay discoverable through the plugin registry contract.
- Channel or web-app behavior changes belong in the Chat Web or scheduled-job specs.
- A new plugin-wrapper spec is justified only if wrapper registration gains independent policy, ordering, auth, or failure behavior.

### Finding: Product type modules are schema boundaries, not standalone capabilities

`src/auth/types.ts`, `src/pi-packages/types.ts`, `src/user-skills/types.ts`, and `src/signals/events.ts` define shared product data contracts. Their testable behavior appears in auth services, Pi Package storage/runtime selection, user-skill management, and signal aggregation.

#### Owning specs

- `docs/specs/capabilities/web-auth-and-same-origin-host.md`
- `docs/specs/capabilities/pi-packages.md`
- `docs/specs/capabilities/user-skills.md`
- `docs/specs/capabilities/pibo-session-signals.md`

#### Future acceptance

- Type changes that alter persisted fields, public API payloads, or runtime context must update the owning behavior spec.
- Pure compile-time type aliases need no separate spec.
- Error/status helpers in auth types remain covered by web auth unless new auth services expose different status semantics.

### Finding: Runtime and MCP helper seams are already covered by operator-facing specs

`src/tools/runtime/index.ts` re-exports the persistent runtime tool modules. `src/mcp/output.ts` formats MCP list/info/schema/call output, and `src/mcp/version.ts` exposes the MCP CLI version constant.

#### Owning specs

- `docs/specs/capabilities/persistent-code-runtime-tool.md`
- `docs/specs/capabilities/mcp-server-integration.md`
- `docs/specs/capabilities/package-build-and-distribution.md`

#### Future acceptance

- Runtime tool public exports should be treated as part of the persistent runtime tool contract.
- MCP output formatting is a CLI behavior only when it changes visible command output, JSON/text mode, color handling, or error handling.
- MCP version behavior should remain in package/release coverage unless users can query it through a documented command with a pass/fail contract.

### Finding: Compact terminal subcomponents are covered by terminal behavior

Component seams such as `TerminalLine.tsx`, `TerminalLoginCard.tsx`, `TerminalModelCard.tsx`, `TerminalStatusCard.tsx`, `loginMenu.ts`, and `terminalRows.ts` implement pieces of the compact terminal surface. The user-visible contract is row projection, action-card rendering, safe value rendering, and stable streaming interaction.

#### Owning specs

- `docs/specs/capabilities/chat-web-trace-and-terminal-view.md`
- `docs/specs/capabilities/chat-web-safe-content-rendering.md`
- `docs/specs/capabilities/model-provider-auth-and-session-selection.md`
- `docs/specs/capabilities/runtime-thinking-and-fast-mode-controls.md`

#### Future acceptance

- Add focused requirements to the terminal or provider specs if action cards gain new user actions or payload contracts.
- Keep styling-only component changes out of capability specs unless they affect accessibility, safety, or observable state.
- Tests should assert rendered terminal behavior and card actions, not internal component boundaries.

## Coverage Decision

No new capability spec was created in this run. The inspected files are compatibility or helper seams whose observable behavior is already managed by existing specs. This coverage artifact is the single new spec-tree document for this run and prevents future duplicate specs for facade modules.

## Success Criteria

- [x] SC-001: Existing `docs/specs/` were inspected before choosing this artifact.
- [x] SC-002: The artifact lives under `docs/specs/coverage/` because a new capability spec would duplicate existing behavior contracts.
- [x] SC-003: Each inspected seam names the owning existing spec or specs.
- [x] SC-004: Each finding defines when future behavior should update an owning spec or become a new spec.
- [x] SC-005: No source code, tests, gateway state, or Docker workers were changed.

## Traceability

| Seam | Source basis | Owning spec | Status |
|---|---|---|---|
| Chat Web event/read-model/room facades | `src/apps/chat/event-log.ts`, `src/apps/chat/read-model.ts`, `src/apps/chat/rooms.ts`, `src/apps/chat/types/*` | Chat Web rooms/bootstrap/data-store specs | Covered by controller specs |
| Plugin registration wrappers | `src/plugins/chat-web.ts`, `src/cron/plugin.ts` | Plugin registry, Chat Web, scheduled jobs specs | Covered by controller specs |
| Product type modules | `src/auth/types.ts`, `src/pi-packages/types.ts`, `src/user-skills/types.ts`, `src/signals/events.ts` | Auth, Pi Packages, User Skills, Session Signals specs | Covered by controller specs |
| Runtime and MCP helpers | `src/tools/runtime/index.ts`, `src/mcp/output.ts`, `src/mcp/version.ts` | Runtime tool, MCP integration, package/build specs | Covered by controller specs |
| Compact terminal subcomponents | `src/apps/chat-ui/src/session-views/compact-terminal/*` | Trace/terminal, safe rendering, provider settings specs | Covered by controller specs |

## Verification Basis

This analysis is based on the current workspace files:

- `GLOSSARY.md`
- `AGENTS.md`
- full `docs/specs/` inventory
- `src/apps/chat/event-log.ts`
- `src/apps/chat/read-model.ts`
- `src/apps/chat/rooms.ts`
- `src/apps/chat/types/event-store.ts`
- `src/apps/chat/types/read-model.ts`
- `src/plugins/chat-web.ts`
- `src/cron/plugin.ts`
- `src/auth/types.ts`
- `src/pi-packages/types.ts`
- `src/user-skills/types.ts`
- `src/signals/events.ts`
- `src/tools/runtime/index.ts`
- `src/mcp/output.ts`
- `src/mcp/version.ts`
- `src/apps/chat-ui/src/session-views/compact-terminal/`
