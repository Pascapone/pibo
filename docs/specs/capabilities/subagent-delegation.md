# Spec: Subagent Delegation

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** [Pibo Session Routing](./pibo-session-routing.md), [Custom Agents and Agent Designer](./custom-agents.md), [Yielded Run Control](./yielded-run-control.md)

## Why

Pibo profiles can expose other profiles as callable subagents. This lets a runtime delegate bounded work while Pibo keeps product-level stewardship, session hierarchy, room placement, and trace visibility.

Delegation is a product-boundary behavior, not only a tool implementation detail. Operators and UIs must be able to see which parent session delegated to which child session, and agents must be able to reuse a child conversation by `threadKey` without losing routing isolation.

## Goal

Define the observable contract for registering subagents, exposing them as tools, routing delegated messages into child Pibo Sessions, and reporting the delegation back to traces and live streams.

## Background / Current State

Subagents are registered as `SubagentProfile` records with a `name`, `targetProfile`, optional `description`, optional timeout, and optional max depth. Profiles select subagents through `InitialSessionContextBuilder.addSubagent` or `addSubagents`. Runtime creation converts enabled selected subagents into generated tools named `pibo_subagent_<normalized-name>`.

When such a tool runs, the session router resolves or creates a child Pibo Session with channel `pibo.subagents`, kind `subagent`, the parent's workspace and app context compatibility context, and a parent-child relationship through `parentId`. The router emits a `subagent_session` output event on the parent before waiting for the child assistant reply.

## Scope

### In Scope

- Plugin-registered and custom-agent-selected subagent definitions.
- Generated subagent tool names, descriptions, parameters, and return shape.
- Parent-to-child routed session creation and reuse.
- Depth, timeout, workspace, model, app context compatibility, and room inheritance behavior.
- Delegation events used by Chat Web traces, streams, ingestion, and signals.

### Out of Scope

- Designing new subagent UI flows — existing Agent Designer fields are the current source behavior.
- Scheduling background subagents — use yielded-run control for asynchronous tool wrapping.
- Changing the Pi Coding Agent transcript format — Pibo only specifies product-level session and event behavior.

## Requirements

### Requirement: Subagents are cataloged and profile-selected

The system MUST make registered subagents discoverable in the capability catalog and MUST expose a subagent to a runtime only when the selected profile includes it and it is not disabled.

#### Current

The plugin registry stores subagents by unique name, exposes them through the capability catalog, and profile inspection reports selected enabled subagents.

#### Target

Subagent availability remains deterministic: registering a subagent does not activate it for every profile, and disabled selected subagents do not become runtime tools.

#### Acceptance

- A profile that does not select a registered subagent has no generated tool for that subagent.
- A profile that selects an enabled subagent exposes exactly one generated subagent tool.
- The capability catalog includes the subagent name, description, target profile, timeout, and max depth when present.

#### Scenario: Profile selects a registered helper

- GIVEN a plugin registers subagent `helper` targeting profile `helper-profile`
- AND a parent profile selects that subagent
- WHEN the parent profile is inspected or started
- THEN `helper` appears as an active subagent
- AND `pibo_subagent_helper` appears in active tools.

### Requirement: Generated tool names are stable and collision-safe

The system MUST generate subagent tool names by normalizing the subagent name to a stable `pibo_subagent_...` identifier and MUST reject collisions within one runtime tool set.

#### Current

Names are lowercased, non-alphanumeric runs become underscores, leading and trailing underscores are trimmed, and an empty normalized name falls back to a short hash. Duplicate generated names throw an error.

#### Target

Agents can rely on stable tool names across runtime starts, while ambiguous subagent names fail early instead of shadowing each other.

#### Acceptance

- `research-helper` and `Research Helper` normalize to the same generated name.
- Two selected subagents that normalize to the same generated name fail runtime tool definition creation.
- Disabled subagents do not participate in collision checks.

#### Scenario: Collision is rejected

- GIVEN one profile selects subagents named `same-name` and `same_name`
- WHEN runtime tool definitions are created
- THEN creation fails with a duplicate subagent tool name error.

### Requirement: Subagent tools expose a minimal delegation interface

The generated subagent tool MUST accept a required `message` and an optional `threadKey`, MUST execute in parallel mode, and MUST return the child assistant reply text with details that identify the child Pibo Session and input event.

#### Current

Generated tools use the subagent description as the model-visible description when available. The tool result contains text content from the child reply and details including `piboSessionId`, `eventId`, and the reply event.

#### Target

The tool interface stays compact for agents while preserving enough structured data for debugging and trace correlation.

#### Acceptance

- Calling a subagent tool without `message` is invalid by schema.
- Supplying `threadKey` passes it to the subagent runner unchanged after tool validation.
- The result content contains the final child assistant text.
- The result details identify the child Pibo Session and the routed input event id.

#### Scenario: Agent continues a child thread

- GIVEN a parent runtime has `pibo_subagent_explorer`
- WHEN the agent calls it with `message: "Inspect auth files"` and `threadKey: "auth"`
- THEN Pibo routes the message to the explorer child session for thread `auth`
- AND the tool result returns the child assistant reply.

### Requirement: Delegation creates or reuses child Pibo Sessions

The session router MUST resolve each subagent call to a child Pibo Session keyed by parent session, target profile, subagent identity, and resolved thread key.

#### Current

A missing or blank `threadKey` is replaced with a new UUID. A nonblank `threadKey` is trimmed. Existing matching child sessions are reused. New child sessions use channel `pibo.subagents`, kind `subagent`, the resolved target profile, the parent's app context compatibility context, parent id, workspace, and subagent metadata.

#### Target

Repeated calls with the same parent, subagent, target profile, and thread key continue the same delegated conversation. Calls without an explicit thread key start separate delegated conversations.

#### Acceptance

- A first call with a new `threadKey` creates a child Pibo Session.
- A later call with the same parent, subagent, target profile, and `threadKey` reuses that child session.
- A call with no `threadKey` creates a new child session with a generated thread key.
- The child session has the same workspace as the parent and uses app context compatibility metadata when old stores require it.

#### Scenario: Thread key reuse

- GIVEN parent session `ps_parent` calls subagent `explorer` with `threadKey: "inspect"`
- WHEN the parent calls `explorer` again with `threadKey: "inspect"`
- THEN both calls route to the same child Pibo Session.

### Requirement: Child sessions inherit room placement when available

When the parent session metadata contains `chatRoomId`, the system MUST copy it into new or reused child subagent session metadata so Chat Web can render delegated work in the same room context.

#### Current

New child session metadata includes `chatRoomId` when the parent has it. Reused legacy child sessions that match without `chatRoomId` are updated to include the parent's room id.

#### Target

Subagent sessions remain visible in the parent room after migrations and do not become orphaned in Chat Web projections.

#### Acceptance

- A new child session created from a room-backed parent contains the same `chatRoomId` metadata.
- A reused legacy child session missing `chatRoomId` is updated on reuse.
- A parent without room metadata does not invent a room id for the child.

#### Scenario: Delegation inside a room

- GIVEN parent session `ps_parent` has metadata `chatRoomId: "room_parent"`
- WHEN it delegates to subagent `explorer`
- THEN the child subagent session metadata includes `chatRoomId: "room_parent"`.

### Requirement: Subagent depth is bounded

The router MUST reject subagent delegation when the current parent depth is greater than or equal to the subagent max depth.

#### Current

The max depth defaults to `3`. Custom agent API input accepts positive numeric `maxDepth` values and rounds them before storage.

#### Target

Recursive delegation fails before creating or reusing more child sessions once the configured depth limit is reached.

#### Acceptance

- A subagent with no `maxDepth` uses depth limit `3`.
- A subagent with `maxDepth: 1` cannot be called from a session that already has one parent link.
- Depth checks walk `parentId` links and stop on cycles rather than looping forever.

#### Scenario: Recursive delegation reaches limit

- GIVEN a subagent is configured with `maxDepth: 2`
- AND the current parent session is already at depth 2
- WHEN the runtime calls that subagent
- THEN the call fails with a max-depth error
- AND no new child session is created for that call.

### Requirement: Child runtime selection respects subagent defaults

The system MUST resolve the child session's active model, thinking level, and fast mode using child-session semantics before the delegated runtime starts.

#### Current

Child session active model selection treats the child as a parented profile. Subagent-specific profile settings take precedence over global subagent defaults, which take precedence over shared defaults.

#### Target

Main-agent defaults do not accidentally override subagent-specific defaults for delegated child sessions.

#### Acceptance

- A profile hard-pinned to a model still uses that model for child sessions.
- A parented child profile with no hard pin uses profile subagent model settings or configured subagent defaults.
- Chat Web displays subagent model, thinking, and fast defaults using the same parent-session rule.

#### Scenario: Subagent model default applies

- GIVEN model defaults include a subagent model
- AND a delegated child profile has no hard-pinned model
- WHEN the child Pibo Session is created
- THEN the child active model is the configured subagent model.

### Requirement: Delegation is emitted before waiting for the reply

The router MUST emit a `subagent_session` output event on the parent session before it waits for the child assistant reply.

#### Current

The event includes the parent Pibo Session ID, optional tool call id, generated tool name, subagent name, child Pibo Session ID, and resolved thread key.

#### Target

Live UIs and traces can show delegation as soon as the child session is known, even if the child reply is slow or later fails.

#### Acceptance

- The parent emits one `subagent_session` event per subagent tool call.
- The event references the child Pibo Session ID that receives the delegated message.
- Chat stream adaptation maps the event to an `AGENT_DELEGATION` frame.
- Chat ingestion classifies the event as agent/tool activity with child-session attributes.

#### Scenario: Delegation appears before child completion

- GIVEN a parent calls `pibo_subagent_explorer`
- WHEN the child session is resolved
- THEN the parent stream receives a delegation event
- AND only after that does the router wait for the child assistant reply.

### Requirement: Delegated messages use actor source and bounded waiting

The router MUST send delegated subagent input as a message event to the child session with source `actor` and MUST wait only up to the subagent timeout or the default timeout.

#### Current

Delegated input is a `message` event with a generated event id and source `actor`. The wait timeout uses the subagent `timeoutMs` or `DEFAULT_SUBAGENT_REPLY_TIMEOUT_MS`.

#### Target

Subagent work is distinguishable from direct user input and cannot block the parent tool call indefinitely.

#### Acceptance

- The child input event has type `message`, target child Pibo Session ID, the tool-provided text, source `actor`, and a generated id.
- A configured timeout is used when present.
- The default timeout is used when the subagent has no timeout.
- Timeout failure is reported as a tool call failure to the parent runtime.

#### Scenario: Child reply timeout

- GIVEN a subagent has `timeoutMs: 1000`
- WHEN the child does not produce an assistant reply within that time
- THEN the parent subagent tool call fails instead of waiting indefinitely.

## Edge Cases

- Blank `threadKey` values are treated as missing and replaced with a generated key.
- Existing child sessions created before room metadata migration may be reused and updated.
- Target profile aliases resolve before child session matching and creation.
- Duplicate registered subagent names fail at plugin registration time.
- Duplicate generated tool names can still occur across different registered names and must fail during tool definition creation.
- A parent-session cycle in stored metadata must not cause infinite depth traversal.

## Constraints

- **Compatibility:** Generated tool names and `subagent_session` event fields are public contracts for traces and Chat Web stream adaptation.
- **Security / Privacy:** Child sessions inherit app context compatibility metadata from the parent and are visible through the app context session tree.
- **Performance:** Delegation event emission and child-session lookup must stay bounded by indexed session-store queries and parent-depth traversal.
- **Dependencies:** Subagent execution depends on the session router, plugin registry profile resolution, runtime tool creation, and Chat Web projections.

## Success Criteria

- [ ] SC-001: Profile inspection for the default Codex-compatible profile lists `default`, `explorer`, and `worker` subagents and exposes their generated tools.
- [ ] SC-002: Calling a generated subagent tool with a `threadKey` routes to a child Pibo Session and returns the child reply.
- [ ] SC-003: A second call with the same parent, subagent, target profile, and `threadKey` reuses the existing child session.
- [ ] SC-004: A subagent call at or beyond configured max depth fails before creating new child work.
- [ ] SC-005: Chat Web can render a delegation event from `subagent_session` without waiting for the child reply.

## Assumptions and Open Questions

### Assumptions

- `threadKey` is scoped only within the tuple of parent session, target profile, subagent identity, and metadata used for session lookup.
- Child subagent sessions are regular routed Pibo Sessions after creation and can participate in traces, signals, and disposal.
- The current max-depth behavior counts parent links from the calling parent, not from the would-be child.

### Open Questions

- Should subagent registration validate `targetProfile` eagerly, or is current profile-build/runtime resolution sufficient?
- Should custom agent editing prevent generated tool-name collisions before runtime creation?
- Should timeout failures emit a dedicated product event separate from the parent tool error?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001: Subagents are cataloged and profile-selected | Profile selects a registered helper | Source-backed spec only | Draft |
| REQ-002: Generated tool names are stable and collision-safe | Collision is rejected | Source-backed spec only | Draft |
| REQ-003: Subagent tools expose a minimal delegation interface | Agent continues a child thread | Source-backed spec only | Draft |
| REQ-004: Delegation creates or reuses child Pibo Sessions | Thread key reuse | Source-backed spec only | Draft |
| REQ-005: Child sessions inherit room placement when available | Delegation inside a room | Source-backed spec only | Draft |
| REQ-006: Subagent depth is bounded | Recursive delegation reaches limit | Source-backed spec only | Draft |
| REQ-007: Child runtime selection respects subagent defaults | Subagent model default applies | Source-backed spec only | Draft |
| REQ-008: Delegation is emitted before waiting for the reply | Delegation appears before child completion | Source-backed spec only | Draft |
| REQ-009: Delegated messages use actor source and bounded waiting | Child reply timeout | Source-backed spec only | Draft |

## Verification Basis

This spec is based on current code in:

- `src/subagents/tool.ts`
- `src/core/profiles.ts`
- `src/core/runtime.ts`
- `src/core/session-router.ts`
- `src/core/model-defaults.ts`
- `src/plugins/registry.ts`
- `src/plugins/codex-compat.ts`
- `src/apps/chat/agent-store.ts`
- `src/apps/chat/web-app.ts`
- `src/apps/chat/stream.ts`
- `src/data/ingest-service.ts`
- `test/subagents.test.mjs`
