# Spec: Chat Web Bootstrap and Navigation API

**Status:** Draft
**Created:** 2026-05-10
**Updated:** 2026-05-17
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code
**Related docs:** [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Chat Web Cache and Live State](./chat-web-cache-and-live-state.md), [Custom Agents and Agent Designer](./custom-agents.md), [Pibo Session Signals](./pibo-session-signals.md)

## Why

Chat Web needs a fast first payload that can open the app, choose the correct room and Pibo Session, populate navigation, and provide catalog data for agents, tools, models, cron jobs, and settings. It also needs a lighter refresh path for navigation changes that does not reload expensive catalogs or Pi transcript metadata.

Without a clear bootstrap and navigation API contract, the browser can mix owner-scoped data, select a session from the wrong room, reintroduce stale unread counts, or refetch catalogs on every live event.

## Goal

Define the authenticated server behavior for Chat Web bootstrap and navigation payloads, including session selection, room scoping, catalog inclusion, unread handling, signal overlays, and cache boundaries.

## Background / Current State

`GET /api/chat/bootstrap` and `GET /api/chat/navigation` are implemented in `src/apps/chat/web-app.ts`. Both endpoints require a web session, resolve an owner-scoped selected Pibo Session, ensure room placement, build room and session trees, overlay runtime/signal state, and return selected room/session identifiers.

Bootstrap additionally loads catalog data through `loadBootstrapCatalog()`, including registered profiles, custom agents, model defaults, model catalog, agent catalog, and gateway action metadata. The same catalog payload is also available from `GET /api/chat/catalog`; `GET /api/chat/agent-catalog` remains a narrower Agent Designer catalog endpoint. Navigation intentionally omits catalog data, returns `defaultRoomId`, and uses a lighter session-node build path. The React client treats bootstrap as the full app state and navigation as a cheap authoritative refresh.

## Scope

### In Scope

- `GET /api/chat/bootstrap` response behavior.
- `GET /api/chat/navigation` response behavior.
- `GET /api/chat/catalog` response behavior for bootstrap catalog refreshes.
- Owner-scoped session and room selection from `piboSessionId` and `roomId` query parameters.
- Default room and default session creation when no session is requested.
- Room-scoped visible session tree construction, archived filtering, unread counts, and signal status overlays.
- Bootstrap catalog loading, caching, invalidation boundaries, owner-scope caveats, and response shape.
- Navigation endpoint omission of catalog data and heavy Pi metadata fallback.

### Out of Scope

- Room CRUD, message ingestion, SSE replay, and read-state storage internals — covered by Chat Web Rooms and Event Streams.
- Browser React Query cache mechanics — covered by Chat Web Cache and Live State.
- Detailed custom-agent editing behavior — covered by Custom Agents and Agent Designer.
- Project-specific bootstrap — covered by the Chat Web Projects Area spec.

## Requirements

### Requirement: Bootstrap and navigation require authenticated owner context

The system MUST require an authenticated web session before returning bootstrap or navigation data, and all returned sessions, rooms, agents, and mutable catalog rows MUST be scoped to that session's owner or to registered read-only product capabilities.

#### Current

Both endpoint handlers call `requireSession()`. Session lookup uses `findSessions({ ownerScope })` and selected-session validation checks `selected.ownerScope === webSession.ownerScope`.

#### Target

A browser cannot use another user's room id or Pibo Session id to discover state through bootstrap or navigation.

#### Acceptance

- Requests without a valid web session fail before state is loaded.
- A requested `piboSessionId` owned by another owner returns a not-available error.
- Room trees contain only rooms for the authenticated owner scope.
- Custom agents are serialized from the authenticated owner scope, while plugin profiles and product capabilities remain read-only catalog entries.

#### Scenario: Cross-owner session is requested

- GIVEN user A owns session `ps_a`
- AND user B is authenticated
- WHEN user B requests `/api/chat/bootstrap?piboSessionId=ps_a`
- THEN the request fails with a not-available response
- AND no session tree for user A is returned.

### Requirement: Selection resolves to a valid room-scoped Pibo Session

The API MUST resolve each bootstrap or navigation request to one selected room id and one selected Pibo Session id, creating a default chat session only when no session is requested.

#### Current

`resolveRequestedSession()` returns `ensureDefaultChatSession()` when no `piboSessionId` is supplied. Requested sessions are canonicalized to their profile name, assigned to a default room if missing room metadata, and rejected when the supplied `roomId` does not match the session's resolved room.

#### Target

The browser receives canonical selected identifiers and never has to infer whether a selection was missing, migrated, or invalid.

#### Acceptance

- Missing `piboSessionId` creates or reuses a top-level chat session in the requested room, or the Personal Chat room when no room is requested.
- Requested sessions are accepted only when owned by the current owner.
- Sessions without room metadata are attached to the owner's default room.
- A requested `roomId` that does not contain the requested session returns a not-available error.
- The response includes `selectedRoomId`, `selectedPiboSessionId`, `room`, and `session` matching the resolved selection.

#### Scenario: Session-room mismatch

- GIVEN a user owns session `ps_1` in room `room_a`
- WHEN the user requests `/api/chat/navigation?roomId=room_b&piboSessionId=ps_1`
- THEN the API rejects the request
- AND does not return `ps_1` under `room_b`.

### Requirement: Visible session trees are room-filtered and archive-aware

The API MUST return session trees for the selected room, include the selected session even when needed for continuity, and hide archived session paths unless explicitly requested.

#### Current

`visibleSessionsInRoom()` filters owned sessions by selected room, maps legacy roomless sessions into the default room, adds the selected session if absent, and calls `visibleOwnedSessions()` with `includeArchived`.

#### Target

Navigation reflects the selected room without losing the current selection or showing archived branches by default.

#### Acceptance

- Sessions from other rooms are absent from the response tree.
- Legacy roomless sessions appear in the default room view.
- The selected session is present in the returned tree even if it was not part of the initial room filter.
- When `includeArchived` is not `true`, a session is hidden if it or any ancestor is archived, except for the selected session.
- When `includeArchived=true`, archived sessions are included and marked with archive state.

#### Scenario: Archived child is hidden by default

- GIVEN a selected room contains an active parent session and an archived child session
- WHEN bootstrap runs without `includeArchived=true`
- THEN the child is not returned in the session tree
- WHEN bootstrap runs with `includeArchived=true`
- THEN the child is returned with archived state.

### Requirement: Read markers and unread counts are computed for visible owner state

The API MUST compute unread counts from owner-visible, non-archived sessions and MUST support explicit selected-subtree read marking during bootstrap.

#### Current

Bootstrap parses `markRead=true` and calls `markSessionsRead()` for the selected session subtree. Both endpoints call `buildSessionUnreadCounts()` and aggregate room unread counts before serializing session and room trees.

#### Target

Opening a selected session can clear its unread state, and the returned room/session counts match the same owner-scoped state used by Chat Web navigation.

#### Acceptance

- `markRead=true` on bootstrap marks the selected Pibo Session subtree read up to each session's latest stream id.
- Navigation does not mark sessions read by itself.
- Unread session counts are requested only for visible, non-archived session ids.
- Room unread counts aggregate visible session unread counts into the room tree.
- Archived session branches do not contribute unread counts in the normal view.

#### Scenario: Bootstrap marks selected subtree read

- GIVEN a parent session has an unread child event
- WHEN the browser requests `/api/chat/bootstrap?markRead=true&piboSessionId=<parent>`
- THEN the returned parent and child session nodes have no unread count
- AND the containing room count is reduced by the cleared unread amount.

### Requirement: Runtime and signal state overlays do not replace durable session identity

The API MUST overlay current runtime and signal status onto session navigation rows while preserving Pibo Session store identity, profile, model, hierarchy, and metadata as the durable source.

#### Current

Responses include `runtimeStatus` from `channelContext.getSessionRuntimeStatus()`. Session index items are combined with `snapshotSignalSession()` through `sessionIndexItemsWithSignalState()` before `buildSessionNodes()` returns browser nodes.

#### Target

Navigation can show running or error state for live work without mutating canonical Pibo Session records or confusing Pi transcript identity with product session identity.

#### Acceptance

- The selected response includes `runtimeStatus` when the channel context can provide it.
- Signal snapshots can mark visible session nodes as `running`, `error`, or `idle`.
- Signal status changes do not change `piboSessionId`, `piSessionId`, `profile`, `parentId`, `originId`, or `activeModel` values.
- If signal services are unavailable, the API still returns a session tree from stored/indexed state.

#### Scenario: Running signal overlays selected session

- GIVEN a selected session has active signal state
- WHEN bootstrap returns session nodes
- THEN the selected node status is `running`
- AND the selected session id and Pi session id remain the stored values.

### Requirement: Bootstrap returns full catalog state and navigation omits it

`/api/chat/bootstrap` MUST include catalog data needed to initialize full Chat Web, while `/api/chat/navigation` MUST omit that catalog data and return only navigation state.

#### Current

Bootstrap spreads `loadBootstrapCatalog()` into the response. Navigation returns identity, selection, room tree, session tree, runtime status, and latest room stream id, with a `server-timing` value indicating no catalog and no JSONL fallback.

#### Target

The browser can use bootstrap for initial load and settings/agent surfaces, then use navigation for cheap selection and live-event refreshes.

#### Acceptance

- Bootstrap includes `agents`, `customAgents`, `modelDefaults`, `modelCatalog`, `agentCatalog`, and `capabilities.actions`.
- `GET /api/chat/catalog` returns the same catalog shape without navigation state.
- Navigation omits `agents`, `customAgents`, `modelDefaults`, `modelCatalog`, `agentCatalog`, and `capabilities`.
- Both bootstrap and navigation responses include `identity`, `session`, `room`, `selectedRoomId`, `selectedPiboSessionId`, `latestRoomStreamId`, `rooms`, and `sessions`; navigation also includes `defaultRoomId`.
- Navigation can be used to refresh unread counts and session tree state without reloading agent catalogs.

#### Scenario: Cheap navigation refresh

- GIVEN the browser already has bootstrap catalog data
- WHEN a live event requests `/api/chat/navigation` for the selected room
- THEN the response updates rooms and sessions
- AND does not include catalog fields.

### Requirement: Bootstrap catalog cache is short-lived and invalidated by catalog mutations

The server MAY cache bootstrap catalog construction briefly, but MUST clear that cache after mutations that change catalog-visible data.

#### Current

`loadBootstrapCatalog()` caches a promise for 30 seconds. Current source caches the full catalog promise, including owner-scoped `customAgents` serialized for the web session that populated the cache. `invalidateBootstrapCatalogCache()` clears it after relevant mutations such as model defaults, custom-agent changes, MCP descriptions, Pi packages, user skills, base prompt updates, and compaction prompt updates.

#### Target

Repeated bootstrap calls avoid unnecessary catalog work, while settings and Agent Designer mutations become visible without waiting for the time-to-live. Custom agents MUST remain owner-scoped: the bootstrap catalog cache MUST either key owner-scoped fragments by owner scope or cache only shared static catalog data and build `customAgents` per authenticated request.

#### Acceptance

- Repeated bootstrap calls within the cache window may reuse shared static catalog data.
- If the cached promise rejects, the cache entry is cleared.
- Mutations that change model defaults, custom agents, MCP server descriptions, Pi packages, user skills, base prompts, or compaction prompts clear the cache before the next bootstrap response.
- The cache must not authorize cross-owner private data; current source inspection found that owner-scoped custom agents are part of the cached promise, so the current implementation needs a code follow-up to split static catalog data from per-request `customAgents` or apply equivalent owner-keying.

#### Scenario: User skill catalog changes

- GIVEN a user creates a new user skill through Chat Web
- WHEN the next bootstrap response is generated
- THEN the `agentCatalog.userSkills` list includes the new skill
- AND the response does not rely on a stale cached catalog.

## Edge Cases

- Boolean query parameters are true only when the value is exactly `true`; other values are false.
- A missing explicit room id falls back to the Personal Chat room.
- A requested archived room can be read, but cannot create a new default session when no session exists.
- Profile aliases in old session records are canonicalized to registered profile names when possible.
- Catalog loading can fail independently of navigation; navigation remains available because it does not load catalogs.
- `/api/chat/catalog` is authenticated and returns catalog state without changing selected room or session navigation.
- Session node construction may skip Pi metadata fallback on navigation for performance, so durable Pibo Session fields and indexed state must be sufficient for navigation rows.

## Constraints

- **Security / Privacy:** Bootstrap and navigation are authenticated same-origin APIs and MUST NOT expose sessions or mutable custom resources from another owner scope.
- **Compatibility:** Response field names used by `BootstrapData` and `NavigationData` remain stable for the current Chat Web client.
- **Performance:** Navigation should avoid catalog loading and heavy Pi transcript fallback. Bootstrap catalog caching is bounded by a short TTL and explicit invalidation.
- **Source of Truth:** Pibo Session Store and Chat Web data services remain authoritative for session identity, room placement, event positions, and unread state.
- **Catalog cache:** Owner-scoped catalog fragments, especially custom agents, MUST NOT be cached in a cross-owner value unless the cache is keyed by owner scope. The preferred design is to cache shared static catalog data separately and build `customAgents` per authenticated request.

## Success Criteria

- [ ] SC-001: Bootstrap and navigation reject cross-owner requested sessions and room mismatches.
- [ ] SC-002: Missing selection creates or reuses a default session in the requested or default room.
- [ ] SC-003: Bootstrap includes catalog fields; navigation omits them.
- [ ] SC-004: `markRead=true` on bootstrap clears unread counts for the selected session subtree.
- [ ] SC-005: Signal and runtime overlays update node status without changing durable session identity.
- [ ] SC-006: Catalog mutations invalidate the short-lived bootstrap catalog cache.
- [ ] SC-007: Bootstrap catalog caching is owner-keyed or split so owner-scoped `customAgents` cannot be reused across owners.

## Assumptions and Open Questions

### Assumptions

- The Chat Web browser uses bootstrap for full app initialization and navigation for cheaper refreshes.
- Registered plugin capabilities are read-only product catalog entries and can be shared across owners.
- Custom agents remain owner-scoped even when included in a cached bootstrap catalog path.

### Decisions

- Custom agents are owner-scoped. Bootstrap catalog caching must not reuse `customAgents` across owner scopes. Prefer caching shared static catalog data separately and building `customAgents` per authenticated request.

### Open Questions

- Should `includeArchived` use stricter boolean validation instead of treating any non-`true` value as false?
- Should navigation expose a compact catalog version so the browser knows when to reload full bootstrap after catalog mutations?

## Traceability

| Requirement | Scenario / Story | Source Basis | Status |
|---|---|---|---|
| Bootstrap and navigation require authenticated owner context | Cross-owner session is requested | `src/apps/chat/web-app.ts`; positive-path auth in `test/web-channel.test.mjs` | Partial; cross-owner bootstrap/navigation rejection is source-inspected but lacks a targeted test |
| Selection resolves to a valid room-scoped Pibo Session | Session-room mismatch | `src/apps/chat/web-app.ts`; room-scoped positive paths in `test/web-channel.test.mjs` | Partial; mismatch rejection is source-inspected but lacks a targeted test |
| Visible session trees are room-filtered and archive-aware | Archived child is hidden by default | `src/apps/chat/web-app.ts`, `test/web-channel.test.mjs` | Implemented |
| Read markers and unread counts are computed for visible owner state | Bootstrap marks selected subtree read | `src/apps/chat/web-app.ts`, `src/apps/chat/data/read-state-service.ts`, `test/web-channel.test.mjs` | Implemented |
| Runtime and signal state overlays do not replace durable session identity | Running signal overlays selected session | `src/apps/chat/web-app.ts`, `test/chat-signals-api.test.mjs` | Implemented |
| Bootstrap returns full catalog state and navigation omits it | Cheap navigation refresh | `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/types.ts`, `test/web-channel.test.mjs` | Implemented; `/api/chat/catalog` source-inspected |
| Bootstrap catalog cache is short-lived, invalidated by catalog mutations, and safe for owner-scoped custom agents | User skill catalog changes; owner-scoped custom agents are not reused across owners | `src/apps/chat/web-app.ts` | Partial; invalidation is source-inspected, the owner-scoped custom-agent requirement is decided, and code follow-up is needed for the current cache path |

## Verification Basis

This spec is based on the current workspace code in `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/api.ts`, `src/apps/chat-ui/src/types.ts`, `src/apps/chat-ui/src/App.tsx`, `src/apps/chat/data/read-state-service.ts`, `src/apps/chat/data/session-query-service.ts`, `src/apps/chat/data/timeline-query-service.ts`, `src/core/session-router.ts`, and tests including `test/web-channel.test.mjs` and `test/chat-signals-api.test.mjs`.
