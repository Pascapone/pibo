# Spec: Agent Delegation and Management

**Status:** Done
**Created:** 2026-05-10
**Revised:** 2026-08-25
**Related docs:** [Pibo Session Routing](./pibo-session-routing.md), [Custom Agents and Agent Designer](./custom-agents.md), [Yielded Run Control](./yielded-run-control.md), [Agent Management Tool Design](../../plans/agent-management-tool-design.md)

## Why

Pibo profiles can expose other profiles as delegated agents. The previous contract generated one tool per configured subagent (`pibo_subagent_<name>`). That scales the model tool surface with the number of profiles, mixes agent identity into tool identity, and provides no shared list, observation, or targeted termination interface.

Pibo needs one stable management surface that keeps delegated work visible as child Pibo Sessions and remains compatible with yielded-run control.

## Goal

Replace generated per-subagent tools with four stable Pibo-managed capabilities:

- yielded target `pibo_agents_send_message`
- direct management tool `pibo_agents_list_agents`
- direct management tool `pibo_agents_observe`
- direct management tool `pibo_agents_kill`

The model context must identify every currently available delegated agent by configured `name` and profile description. Sends are started only through `pibo_run_start`; the returned run ID is also the request ID used for observation, reading, and explicit cancellation.

## Lifetime Contract

Delegated-agent lifetime is independent from foreground waiting and diagnostic freshness:

- Delegated sends have no implicit wall-clock deadline and may run for hours.
- Legacy `SubagentProfile.timeoutMs` values are compatibility data only; they do not become request or yielded-run execution deadlines.
- `pibo_run_wait` defaults to 30 seconds and is capped at 300 seconds per call. An expired wait reports that the run is still active; it does not cancel the run or child request.
- A stale telemetry or signal threshold is diagnostic only. It does not create a timeout, cancellation, retry, or recovery action.
- Normal completion or failure settles the request. Explicit run cancellation, agent kill, parent abort, or session/router disposal may stop active delegated work. Normal completion of the parent model turn does not.

## Scope

### In Scope

- Shared agent-management tool definitions and schemas.
- Dynamic model-visible available-agent catalog.
- Child-session creation, thread reuse, status listing, event observation, and targeted termination.
- Exact ownership checks between the calling parent session and managed child sessions.
- Existing depth, model, thinking, workspace, room, routing, trace, and run-control behavior.
- Removal of implicit and profile-driven delegated-request lifetime timeouts.
- Operator debug CLI discovery for listing and observing delegated child sessions.
- Removal of generated `pibo_subagent_*` runtime tools.

### Out of Scope

- Harness-native subagents owned by an external runtime.
- A second background-job or wait lifecycle competing with `pibo_run_*`.
- Broad investment in the legacy `codex-compat` profile beyond replacing invalid tool references.
- Changing the child runtime transcript format.

## Requirements

### Requirement: One stable shared management surface

When a session has at least one enabled delegated-agent profile below its depth limit, Pibo MUST expose list, observe, and kill directly, expose send only as a `pibo_run_start` target, and MUST NOT expose any generated `pibo_subagent_*` tool.

#### Acceptance

- Direct model tools omit `pibo_agents_send_message`.
- `pibo_run_start` accepts `pibo_agents_send_message` even when the profile did not otherwise enable run control.
- Tool count does not grow with the number of configured agents.
- A session with no available delegated agents exposes none of the four agent capabilities or their generated management context.
- Generated-tool detection and context inspection classify `pibo_agents_*` as Pibo-generated tools.

### Requirement: Available agents are explicit in model context

A generated delegated-agent management context MUST contain each enabled, depth-eligible agent's exact `name` and description, the yielded send signature, and the direct list, observe, kill, run wait, run status, run read, and run cancel lifecycle. If no description exists, the catalog MUST identify the target profile without inventing capabilities.

#### Acceptance

- Each configured name appears once.
- Descriptions remain associated with their names.
- The catalog is present in normal runtime context for Pi and external adapters.
- The generated context is absent when no delegated agent is available.
- Other management tools do not repeat the full catalog unnecessarily.

### Requirement: Yielded send selects by name and returns stable identity

`pibo_agents_send_message` MUST accept `name`, `message`, and optional `threadKey` only as a `pibo_run_start` target. It MUST resolve `name` only against the current profile's enabled, depth-eligible agents, route the message with source `actor`, wait without an implicit lifetime deadline, and return an `agentId` equal to the child Pibo Session ID.

#### Acceptance

- Unknown names fail schema validation or execution without creating a child.
- The first explicit thread creates a child; the same parent, name, target profile, and thread reuses it.
- Omitting or blanking `threadKey` creates a new generated thread.
- The yielded run ID is the request ID.
- Expiring a bounded `pibo_run_wait`, completing the parent model turn, or crossing a stale threshold leaves the request and child running.
- Natural completion or failure settles the request; explicit run cancellation, agent kill, parent abort, or session/router disposal may stop active delegated work.
- Run cancellation targets the exact queued or active child message event; cancelling one request cannot abort another request sharing the child thread.
- Successful cancellation waits for request settlement; rejected abort and bounded-settlement failure remain explicit errors.
- Legacy `SubagentProfile.timeoutMs` does not impose request lifetime.
- The terminal result identifies request ID, agent ID, name, profile, resolved thread key, input event ID, complete final message, and reply event.
- Multi-part provider text is assembled in order without a new size cap, and `pibo_run_read` returns that complete final assistant message.

### Requirement: List distinguishes availability from instances

`pibo_agents_list_agents` MUST return both the static available-agent catalog and child agent instances owned by the calling parent.

Each instance MUST expose:

- `agentId`
- `name`
- `profile`
- `threadKey`
- `status`: `running`, `idle`, or `killed`
- timestamps and active model when available

#### Acceptance

- A configured agent with no child still appears under `availableAgents`.
- Existing direct child sessions appear under `agents` even when their runtime is idle-evicted.
- Sessions belonging to another parent never appear.
- Killed sessions remain inspectable and are not silently reused.

### Requirement: Observe is exact, bounded, and cursor-based

`pibo_agents_observe` MUST read normalized child-session output observations owned by the caller. It MUST support intersecting filters for:

- yielded `requestIds`
- `agentIds`
- agent `names`
- `threadKeys`
- exact `eventTypes`
- normalized `kinds`: `message`, `thinking`, `tool`, `error`, `lifecycle`, `event`
- normalized exact `roles`, including `assistant`, `tool`, and `system`
- `since` and `until` ISO timestamps
- case-insensitive `textContains`
- `afterSequence`
- `order`: `asc` or `desc`
- bounded `limit`
- optional full `details`

The result MUST report the applied filters, observations, `nextAfterSequence`, and whether the requested result was truncated by the page limit or live-journal retention.

#### Acceptance

- Filters combine with AND semantics between fields and OR semantics within each array field.
- Unknown or foreign `agentIds` fail instead of being ignored.
- Invalid timestamp ranges fail.
- Default output omits large raw details while retaining useful text, tool, and error summaries.
- Observations have a router-global monotonic sequence so callers can poll with `afterSequence` without duplicates.
- Cursor pages consume the oldest unseen matching observations before applying presentation order; `order: desc` cannot advance the cursor past unseen records.
- If the caller's cursor predates retained live history, `truncated` is true and `nextAfterSequence` advances through the known eviction boundary even when no retained observation matches.
- Normalized text is bounded to 4 KiB and optional details to 32 KiB per observation.
- Memory retained for live observations is bounded.

### Requirement: Kill is targeted and ownership-safe

`pibo_agents_kill` MUST accept one `agentId`, verify that it is a direct child agent of the calling parent, terminate its active session subtree and runs, mark the child instance killed, and return the affected IDs.

#### Acceptance

- A foreign, root, or unknown session ID fails without mutation.
- Killing an active send interrupts its waiting caller.
- A killed child remains listed with status `killed`.
- A later send using the same thread creates a new child rather than reviving the killed session.
- Repeating kill after a partial cleanup failure retries subtree disposal even though the child is already marked killed.
- Corrupt parent-link cycles do not cause recursive traversal or duplicate affected IDs.

### Requirement: Existing delegation guarantees remain intact

Shared tools MUST retain existing behavior for depth limits, workspace and room inheritance, app-context compatibility, per-agent model/thinking settings, persistent thread reuse, and `subagent_session` trace linkage. Delegated requests MUST have no implicit wall-clock deadline and MUST remain active until natural settlement, explicit cancellation, or owning-session/router disposal.

The link event MUST use `toolName: "pibo_agents_send_message"` and continue to identify `subagentName`, child Pibo Session ID, resolved thread key, and optional tool call ID. Turn-scoped child outputs MUST retain the active message provenance so recursively delegated usage remains attributable to its originating Loop run.

### Requirement: Legacy library callers have an explicit migration path

The public legacy naming and tool-factory exports MUST remain available as deprecated compatibility APIs, while Pibo-owned runtime assembly MUST use only the four shared agent capabilities and MUST keep send yielded-only. Deprecated runtime and portable-session `subagentRunner` options MUST remain source-visible and fail with a direct instruction to provide `agentsController` rather than disappearing or being silently ignored.

#### Acceptance

- `createSubagentToolName`, `createSubagentToolDefinitions`, and their runner input/result types remain exported.
- Legacy generated-tool names remain recognizable for inspection and historical trace compatibility.
- No Pibo-owned runtime path assembles a generated `pibo_subagent_*` tool.
- A caller that passes only the deprecated runtime controller receives a deterministic migration error.

### Requirement: Operator CLI mirrors observation filters

The debug CLI MUST provide progressively discoverable delegated-agent commands:

```text
pibo debug agents --help
pibo debug agents <parent-session-id> list --help
pibo debug agents <parent-session-id> observe --help
```

The observe command MUST use the same ownership and filter vocabulary where persisted data permits it, and JSON output MUST be stable for automation.

## Edge Cases

- Two configured agent names may target the same profile and remain separate identities.
- Existing legacy child sessions with `subagentToolName: pibo_subagent_*` remain discoverable by metadata but all new link events use the shared send tool name.
- Deprecated public legacy factories remain callable for external migration code but are never selected by Pibo runtime assembly.
- A killed legacy child is excluded from thread reuse.
- Parent-link cycles do not cause unbounded depth or ownership traversal.
- Observation details may contain tool payloads; normal output remains bounded and payload persistence/redaction rules continue to apply.
- Router restarts preserve child-session records and persisted debug history; the live tool cursor is scoped to the current authoritative router lifetime.

## Constraints

- **Simplicity:** No additional scheduler or agent-state database is introduced.
- **Compatibility:** Pibo Run remains the sole asynchronous execution and wait lifecycle.
- **Security:** Management operations are scoped to direct children of the calling Pibo Session.
- **Performance:** Listing uses indexed session-store queries; observation retention and result limits are bounded.
- **Legacy:** `codex-compat` receives only necessary reference corrections; deprecated library exports remain available with explicit runtime migration errors.

## Success Criteria

- [x] SC-001: Two configured agents produce three direct management tools, one yielded-only send target, and zero `pibo_subagent_*` tools.
- [x] SC-002: Conditional runtime context shows each available name, description, and yielded management lifecycle.
- [x] SC-003: Yielded send returns a reusable child `agentId`; bounded waits are non-destructive and `pibo_run_read` returns the complete final message.
- [x] SC-004: List reports available definitions and running/idle/killed instances accurately.
- [x] SC-005: Observe combines all documented filters and cursor pagination without cross-parent leakage.
- [x] SC-006: Kill interrupts active work, marks the instance killed, and prevents thread reuse.
- [x] SC-007: Existing trace/UI delegation cards still link to child sessions under the shared send tool.
- [ ] SC-008: Pibo2 real-provider validation starts `pibo_agents_send_message` through `pibo_run_start`, uses bounded `pibo_run_wait` plus `pibo_run_read`, and demonstrates observe, list, request-specific cancel, and kill behavior in the headful Chat Web UI. Exact-SHA evidence is recorded externally in the PR or validation report so the accepted commit is not amended afterward.
- [x] SC-009: Descending cursor pagination, retention loss, cleanup retry, legacy exports, portable MCP, and shared-tool trace/UI behavior have focused regression coverage.

## Traceability

| Requirement | Primary implementation | Verification |
|---|---|---|
| Shared tool surface | `src/subagents/tool.ts`, `src/tools/session-tool-set.ts` | `test/subagents.test.mjs`, context inspection tests |
| Catalog in context | generated delegated-agent runtime context | tool/context and resource-delivery tests |
| Send and identity | session router agent controller and yielded run ID | router/tool tests, Pibo2 real run |
| List and kill | session router ownership/status methods | router/tool tests |
| Observe filters | normalized observation journal and debug query | filter unit tests, debug CLI tests |
| Existing delegation | router/session metadata and trace projections | trace/UI tests |
| Legacy migration | deprecated exports and controller-option guards | compatibility unit tests |
| Run compatibility | yielded tool assembly | run-control integration test, portable MCP test, Pibo2 real run |
