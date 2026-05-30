# Spec: Pibo Session Routing

**Status:** Draft  
**Created:** 2026-05-10  
**Owner / Source:** Current Pibo codebase  
**Related docs:** `GLOSSARY.md`, `docs/specs/README.md`

## Why

Pibo needs a stable product-level session identity that survives runtime recreation, Chat Web navigation, subagent delegation, forks, clones, model changes, and gateway restarts. Pi Coding Agent sessions are technical transcript/runtime records; they are not enough to express product channel, room association, profile selection, hierarchy, or derivation history.

Pibo Session Routing keeps that boundary explicit. Channels and web APIs work with Pibo Session IDs, while the router opens or reopens the linked Pi session only when runtime work is needed.

## Goal

Pibo MUST treat `PiboSession` records as the product source of truth for routed runtime identity, and MUST use those records to create runtimes, route input, represent hierarchy, preserve derivations, and expose session metadata to Chat Web and gateway clients.

## Background / Current State

The current implementation defines the session model and in-memory store in `src/sessions/store.ts`, SQLite-backed stores in `src/sessions/sqlite-store.ts` and `src/sessions/pibo-data-store.ts`, routing in `src/core/session-router.ts`, active-model resolution in `src/core/session-model.ts`, gateway channel context in `src/gateway/server.ts`, and Chat Web projections in `src/apps/chat/trace.ts` and `src/apps/chat/web-app.ts`.

A `PiboSession` stores product identity and metadata: `id`, `piSessionId`, `channel`, `kind`, `profile`, legacy-compatible `ownerScope` when old stores need it, `parentId`, `originId`, `workspace`, `title`, `metadata`, `activeModel`, and timestamps. Runtime creation uses the stored profile, workspace, Pi session id, parent Pi session id, selected context, and active model. Auth account identity must not select the workspace or product visibility.

## Scope

### In Scope

- `PiboSession` identity, persistence, lookup, listing, update, deletion, and filtering.
- Lazy creation of fallback runtime sessions when a requested Pibo Session does not exist.
- Runtime creation from stored Pibo Session profile, workspace, active model, and Pi session id.
- Parent-child hierarchy for subagents and recursive session interruption.
- Origin derivation for fork and clone branch sessions.
- Active model freezing on session creation or first runtime open.
- Gateway channel context operations for creating, updating, finding, listing, and deleting sessions.
- Chat Web session tree and trace projection from Pibo Sessions plus Pi transcript and event-log data.

### Out of Scope

- The Pi transcript JSONL format — it remains owned by Pi Coding Agent.
- Chat room membership, room events, and SSE frame durability — those are Chat Web concerns.
- Yielded-run lifecycle — covered by `docs/specs/capabilities/yielded-run-control.md`.
- Scheduled-job creation and run reservation — covered by `docs/specs/capabilities/scheduled-pibo-jobs.md`.
- Project-specific session workflow behavior — covered by the Projects area spec.

## Requirements

### Requirement: Pibo Session IDs are product routing identifiers

The system MUST route all channel input by `PiboSession.id`, not by raw Pi session id.

#### Current

`PiboSessionRouter.emit()` accepts `PiboInputEvent` values with `piboSessionId`. The router resolves or creates a `PiboSession`, then creates or reuses a cached `RoutedSession` for that Pibo Session.

#### Target

All product channels, Chat Web APIs, cron runs, and subagent calls use Pibo Session IDs as the stable address for a conversation.

#### Acceptance

- A message event with a known `piboSessionId` is delivered to that session's routed runtime.
- An execution event with a known `piboSessionId` executes against that session's routed runtime.
- A missing `piboSessionId` is lazily created as a fallback Pibo Session with channel `pibo.runtime`, kind `runtime`, and the router base profile.
- Runtime-visible session context includes the Pibo Session ID.

#### Scenario: Route message to persisted session

- GIVEN the session store contains `ps_123` linked to a Pi session id
- WHEN a channel emits a message event for `ps_123`
- THEN the router opens the runtime for `ps_123` and appends the message to the linked Pi session.

### Requirement: Session stores preserve unique Pibo-to-Pi bindings

The session store MUST maintain one unique Pibo Session record per Pibo Session ID and one unique Pibo Session attachment per Pi session id.

#### Current

`InMemoryPiboSessionStore` indexes by Pibo Session ID and Pi session id. `SqlitePiboSessionStore` stores `pi_session_id` with a database uniqueness constraint.

#### Target

No two Pibo Sessions point at the same Pi session unless a future explicit migration changes this invariant.

#### Acceptance

- Creating a session without ids generates `ps_` Pibo Session IDs and UUID Pi session ids.
- Creating a duplicate Pibo Session ID fails.
- Creating or updating a duplicate Pi session attachment fails.
- SQLite stores persist sessions across reopen and preserve metadata, active model, hierarchy, origin, and timestamps.

#### Scenario: Duplicate Pi session is rejected

- GIVEN a store already has a Pibo Session linked to Pi session `pi_A`
- WHEN code creates or updates another Pibo Session with `pi_A`
- THEN the store rejects the operation instead of aliasing both product sessions to one Pi transcript.

### Requirement: Runtime creation uses the stored session profile and workspace

The router MUST create each runtime from the profile and workspace recorded on the `PiboSession`.

#### Current

`PiboSessionRouter.createRoutedSession()` calls `pluginRegistry.createProfile(piboSession.profile)`, passes `piboSession.workspace` as `cwd` when present, and sets the profile session id to `piboSession.piSessionId`.

#### Target

Changing the router default profile or process working directory does not silently change existing sessions.

#### Acceptance

- A stored session with a profile name receives tools, skills, context files, subagents, and packages from that profile.
- A stored session with a workspace opens the runtime in that workspace.
- A stored session without a workspace falls back to the router or default Pibo workspace.
- Runtime session reopen uses the stored Pi session id and does not create a new transcript for the same Pibo Session.

#### Scenario: Existing session uses its own profile

- GIVEN the router default profile is different from a stored session's profile
- WHEN the stored session is opened
- THEN the runtime uses the stored session profile, not the router default.

### Requirement: Active model is frozen per Pibo Session

The system MUST preserve the selected active model on a Pibo Session so later default-model changes do not alter existing conversations.

#### Current

Gateway session creation resolves an active model from the requested profile and product model defaults. Router runtime creation calls `resolvePiboSessionActiveModel()` and backfills `activeModel` when missing.

#### Target

New sessions capture the current model selection. Existing sessions keep their stored model until explicitly changed.

#### Acceptance

- A session with `activeModel` always uses that model for runtime creation.
- A session without `activeModel` resolves the model from profile and product defaults, then stores it.
- Main and subagent sessions can resolve different model defaults when first frozen.
- Updating a session with `activeModel: null` clears the frozen model.

#### Scenario: Defaults change after session creation

- GIVEN session `ps_old` stores active model `gpt-5`
- AND product defaults later change to `kimi-k2`
- WHEN `ps_old` is reopened
- THEN the runtime still uses `gpt-5`.

### Requirement: Parent-child hierarchy represents subagent sessions

The system MUST use `parentId` for true session hierarchy created by subagent delegation.

#### Current

`PiboSessionRouter.resolveSubagentSession()` creates or reuses a child session with channel `pibo.subagents`, kind `subagent`, `parentId` pointing to the parent Pibo Session, inherited workspace, target profile, thread-key metadata, and optional chat room metadata. Legacy owner compatibility is pinned to the shared app value.

#### Target

Subagent sessions are visible as children of their parent and can be recursively interrupted with the parent.

#### Acceptance

- A subagent call emits a `subagent_session` output event with parent and child Pibo Session IDs.
- Reusing the same subagent name, target profile, parent, and thread key returns the existing child session.
- Child sessions inherit the parent workspace and shared app compatibility context.
- Child sessions inherit parent Chat Web room metadata when present.
- Subagent depth is bounded by the subagent profile `maxDepth`.
- Killing a parent session recursively kills child sessions.

#### Scenario: Threaded subagent reuse

- GIVEN a parent session calls the same subagent twice with the same thread key
- WHEN the second call starts
- THEN Pibo reuses the existing child Pibo Session instead of creating a duplicate child.

### Requirement: Origin derivation represents fork and clone branches

The system MUST use `originId` for derivation relationships created by fork or clone operations, without making derived sessions children unless the source was itself a subagent branch.

#### Current

When a runtime operation returns `session.fork` or `session.clone`, the router creates a new `kind: "branch"` Pibo Session with `originId` set to the source session, the new Pi session id, source profile/title/active model, and origin metadata.

#### Target

Forks and clones are visible as derived sessions of their source, but they do not imply parent-child nesting in the subagent tree.

#### Acceptance

- Fork and clone operations create a new Pibo Session rather than overwriting the source Pibo Session's Pi session id.
- The new branch stores `originId` equal to the source Pibo Session id.
- The new branch stores `metadata.originAction` and `metadata.originPiSessionId`.
- The source Pibo Session keeps its original Pi session id.
- Chat Web projections can list derived sessions under the origin session.

#### Scenario: Clone creates visible branch

- GIVEN source session `ps_source` is cloned
- WHEN the runtime reports a new Pi session id
- THEN Pibo creates a branch Pibo Session with `originId: ps_source` and the new Pi session id.

### Requirement: Session switch updates the current Pibo Session before results are emitted

The system MUST update a Pibo Session's technical Pi session binding before observers receive a successful switch result.

#### Current

For non-fork and non-clone session operations, `handleSessionOperation()` updates the current Pibo Session with the returned `current.piSessionId` and workspace before the routed execution result is emitted to listeners.

#### Target

Consumers that react to the result can immediately read the updated product session record.

#### Acceptance

- A successful `session.switch` updates `piSessionId` and workspace on the same Pibo Session.
- Router listeners observing the execution result can read the updated session record.
- Cancelled operations do not mutate the Pibo Session.

#### Scenario: Switch result is consistent

- GIVEN a listener reads session `ps_A` when it receives a `session.switch` result
- WHEN the switch succeeds
- THEN the listener sees the new Pi session id in the session store.

### Requirement: Gateway channels access sessions through channel context

The gateway MUST expose session store operations to plugins and channels through `PiboChannelContext`, with profile resolution and active-model initialization on create.

#### Current

`PiboGatewayServer.createChannelContext()` exposes `getSession`, `createSession`, `updateSession`, `deleteSession`, `findSessions`, and `listSessions`. `createSession` resolves profile aliases and resolves active model when the caller does not supply one.

#### Target

Channels do not bypass the Pibo Session Store when creating or mutating routed sessions.

#### Acceptance

- Channel-created sessions are stored before runtime input is emitted.
- Profile names are resolved through the plugin registry during creation.
- Created sessions receive active-model selection unless explicitly supplied.
- Channel updates can mutate title, metadata, profile, workspace, legacy compatibility owner value, origin, parent, Pi session id, and active model through store update semantics.

#### Scenario: Chat Web creates a room session

- GIVEN an authenticated Chat Web request creates a session for a room
- WHEN the web channel calls `createSession`
- THEN the session is persisted with room metadata, profile, active model, a shared app compatibility context when needed by legacy storage, and a Pibo Session ID that the composer can send to.

### Requirement: Chat Web projections keep product session identity separate from traces

Chat Web MUST build session lists and trace views from Pibo Sessions while using Pi transcripts and raw Pibo events only as supporting data.

#### Current

`buildSessionNodes()` builds tree nodes from `PiboSession` records and read-model index rows. `buildTraceView()` combines the selected Pibo Session, related sessions, Pi transcript entries, and stored output events into a trace view and version hash.

#### Target

The Pibo Session Store remains the source of truth for product session metadata even when Pi transcript metadata or Chat Web read-model rows are missing.

#### Acceptance

- Session tree nodes use `PiboSession.id`, `piSessionId`, `parentId`, `originId`, profile, active model, title, archived metadata, and child relationships.
- Missing Pi transcript metadata does not remove the Pibo Session from the session tree.
- Trace view versions change when relevant session metadata, trace events, status, or transcript metadata changes.
- Origin sessions can show derived branch summaries without making branches children.

#### Scenario: Transcript file missing

- GIVEN a Pibo Session exists but the linked Pi transcript file is unavailable
- WHEN Chat Web builds the session list
- THEN the session still appears using its stored title or Pibo Session ID.

## Edge Cases

- A stored `parentId` or `originId` may reference a missing session; projections MUST not crash and SHOULD treat the session as a root or omit the derived link.
- A runtime may be requested for a missing Pibo Session ID; the router creates a fallback runtime session for compatibility.
- A subagent child may be found with older metadata that lacks `chatRoomId`; the router updates it when the parent now has room metadata.
- SQLite metadata and active-model JSON may be malformed; store readers SHOULD fail clearly rather than returning corrupted model metadata.
- Recursive kill follows `parentId`; it MUST NOT kill origin-derived branches unless they are also descendants through `parentId`.

## Constraints

- **Product Boundary:** Pibo owns Pibo Session records, routing identity, hierarchy, origin metadata, active model, and channel metadata. Legacy owner values are compatibility fields only. Pi Coding Agent owns transcript entries and low-level session files.
- **Security / Privacy:** Web access is authenticated by the channel/API layer. Product session visibility is shared app state and must not be partitioned by auth account.
- **Compatibility:** Existing fallback runtime behavior for unknown Pibo Session IDs remains available for direct/local integrations.
- **Reliability:** Store-backed gateways MUST persist Pibo Session state so routed sessions can reopen after process restart.
- **Context Economy:** Chat Web and traces SHOULD load only metadata needed for visible session trees and selected-session trace views.

## Success Criteria

- [ ] SC-001: A persisted Pibo Session can be reopened by Pibo Session ID and continues the linked Pi transcript.
- [ ] SC-002: Runtime creation uses the stored profile, workspace, Pi session id, and active model.
- [ ] SC-003: Subagent calls create or reuse child Pibo Sessions with `parentId`, inherited workspace, shared app context, and bounded depth.
- [ ] SC-004: Fork and clone operations create visible branch sessions with `originId` without mutating the source Pi session id.
- [ ] SC-005: Session switch updates the current Pibo Session before observers handle the execution result.
- [ ] SC-006: Chat Web session trees and trace views remain addressable by Pibo Session ID even when transcript metadata is incomplete.
- [ ] SC-007: SQLite and in-memory session stores both support creation, update, lookup, filtering, and uniqueness guarantees.

## Assumptions and Open Questions

### Assumptions

- `PiboSession.id` is the correct stable address for all product routing and UI links.
- `parentId` is reserved for true hierarchy; `originId` is reserved for derivation.
- Active model belongs on the Pibo Session because model defaults may change independently of existing conversations.

### Open Questions

- Should fallback creation for unknown Pibo Session IDs remain unrestricted, or should authenticated channels reject unknown ids by default?
- Should `PiboSession` records eventually include first-class room/project foreign keys instead of storing room/project ids in metadata?
- Should session stores validate JSON metadata and active model shape more strictly at the boundary?
- Should branch sessions have their own explicit lifecycle controls in Chat Web beyond derived-session links?

## Traceability

| Requirement | Scenario / Story | Code basis | Status |
|---|---|---|---|
| REQ-001 Pibo Session IDs are product routing identifiers | Route message to persisted session | `src/core/session-router.ts`, `src/core/events.ts` | Implemented |
| REQ-002 Session stores preserve unique Pibo-to-Pi bindings | Duplicate Pi session is rejected | `src/sessions/store.ts`, `src/sessions/sqlite-store.ts`, `src/sessions/pibo-data-store.ts` | Implemented |
| REQ-003 Runtime creation uses the stored session profile and workspace | Existing session uses its own profile | `src/core/session-router.ts`, `test/session-router-store.test.mjs` | Implemented |
| REQ-004 Active model is frozen per Pibo Session | Defaults change after session creation | `src/core/session-model.ts`, `test/session-model-source-of-truth.test.mjs` | Implemented |
| REQ-005 Parent-child hierarchy represents subagent sessions | Threaded subagent reuse | `src/core/session-router.ts`, `test/subagents.test.mjs` | Implemented |
| REQ-006 Origin derivation represents fork and clone branches | Clone creates visible branch | `src/core/session-router.ts`, `test/session-router-store.test.mjs`, `test/session-actions.test.mjs` | Implemented |
| REQ-007 Session switch updates the current Pibo Session before results are emitted | Switch result is consistent | `src/core/session-router.ts`, `test/session-router-store.test.mjs` | Implemented |
| REQ-008 Gateway channels access sessions through channel context | Chat Web creates a room session | `src/gateway/server.ts`, `src/apps/chat/web-app.ts` | Implemented |
| REQ-009 Chat Web projections keep product session identity separate from traces | Transcript file missing | `src/apps/chat/trace.ts`, `src/shared/trace-engine.ts` | Implemented |

## Verification Basis

Current behavior is covered or illustrated by `test/session-router-store.test.mjs`, `test/session-model-source-of-truth.test.mjs`, `test/session-store.test.mjs`, `test/pibo-data-session-store.test.mjs`, `test/session-actions.test.mjs`, `test/subagents.test.mjs`, `test/web-channel.test.mjs`, and `test/chat-trace-materialization.test.mjs`.
