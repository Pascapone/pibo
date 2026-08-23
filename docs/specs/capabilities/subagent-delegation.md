# Spec: Agent Delegation and Management

**Status:** Proposed
**Created:** 2026-05-10
**Revised:** 2026-08-23
**Related docs:** [Pibo Session Routing](./pibo-session-routing.md), [Custom Agents and Agent Designer](./custom-agents.md), [Yielded Run Control](./yielded-run-control.md), [Agent Management Tool Design](../../plans/agent-management-tool-design.md)

## Why

Pibo profiles can expose other profiles as delegated agents. The previous contract generated one tool per configured subagent (`pibo_subagent_<name>`). That scales the model tool surface with the number of profiles, mixes agent identity into tool identity, and provides no shared list, observation, or targeted termination interface.

Pibo needs one stable management surface that keeps delegated work visible as child Pibo Sessions and remains compatible with yielded-run control.

## Goal

Replace generated per-subagent tools with four stable Pibo-managed tools:

- `pibo_agents_send_message`
- `pibo_agents_list_agents`
- `pibo_agents_observe`
- `pibo_agents_kill`

The model context must identify every currently available delegated agent by configured `name` and profile description. A foreground send waits for that child reply. Any management tool can still be invoked through `pibo_run_start`; the normal asynchronous delegation path is a yielded `pibo_agents_send_message` followed by `pibo_run_wait` or `pibo_run_read`.

## Scope

### In Scope

- Shared agent-management tool definitions and schemas.
- Dynamic model-visible available-agent catalog.
- Child-session creation, thread reuse, status listing, event observation, and targeted termination.
- Exact ownership checks between the calling parent session and managed child sessions.
- Existing depth, timeout, model, thinking, workspace, room, routing, trace, and run-control behavior.
- Operator debug CLI discovery for listing and observing delegated child sessions.
- Removal of generated `pibo_subagent_*` runtime tools.

### Out of Scope

- Harness-native subagents owned by an external runtime.
- A second background-job or wait lifecycle competing with `pibo_run_*`.
- Broad investment in the legacy `codex-compat` profile beyond replacing invalid tool references.
- Changing the child runtime transcript format.

## Requirements

### Requirement: One stable shared tool surface

When a session has at least one enabled delegated-agent profile below its depth limit, Pibo MUST expose exactly the four `pibo_agents_*` tools and MUST NOT expose any generated `pibo_subagent_*` tool.

#### Acceptance

- Tool count does not grow with the number of configured agents.
- Every shared tool remains eligible for `pibo_run_start` when run control is enabled.
- A session with no available delegated agents exposes none of the four tools.
- Generated-tool detection and context inspection classify `pibo_agents_*` as Pibo-generated tools.

### Requirement: Available agents are explicit in model context

The shared send tool MUST contribute a model-visible catalog containing each enabled, depth-eligible agent's exact `name` and description. If no description exists, the catalog MUST identify the target profile without inventing capabilities.

#### Acceptance

- Each configured name appears once.
- Descriptions remain associated with their names.
- The catalog is present in tool-definition inspection and normal runtime tool declarations.
- Other management tools do not repeat the full catalog unnecessarily.

### Requirement: Send selects by name and returns stable identity

`pibo_agents_send_message` MUST accept `name`, `message`, and optional `threadKey`. It MUST resolve `name` only against the current profile's enabled, depth-eligible agents, route the message with source `actor`, wait for the bounded child reply, and return an `agentId` equal to the child Pibo Session ID.

#### Acceptance

- Unknown names fail schema validation or execution without creating a child.
- The first explicit thread creates a child; the same parent, name, target profile, and thread reuses it.
- Omitting or blanking `threadKey` creates a new generated thread.
- The result identifies `agentId`, name, profile, resolved thread key, input event ID, and reply.
- `pibo_run_start` can execute the same send asynchronously and `pibo_run_read` returns its final reply.

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

- `agentIds`
- agent `names`
- `threadKeys`
- exact `eventTypes`
- normalized `kinds`: `message`, `thinking`, `tool`, `error`, `lifecycle`, `event`
- `since` and `until` ISO timestamps
- case-insensitive `textContains`
- `afterSequence`
- `order`: `asc` or `desc`
- bounded `limit`
- optional full `details`

The result MUST report the applied filters, observations, `nextAfterSequence`, and whether earlier matching results were truncated.

#### Acceptance

- Filters combine with AND semantics between fields and OR semantics within each array field.
- Unknown or foreign `agentIds` fail instead of being ignored.
- Invalid timestamp ranges fail.
- Default output omits large raw details while retaining useful text, tool, and error summaries.
- Observations have a router-global monotonic sequence so callers can poll with `afterSequence` without duplicates.
- Memory retained for live observations is bounded.

### Requirement: Kill is targeted and ownership-safe

`pibo_agents_kill` MUST accept one `agentId`, verify that it is a direct child agent of the calling parent, terminate its active session subtree and runs, mark the child instance killed, and return the affected IDs.

#### Acceptance

- A foreign, root, or unknown session ID fails without mutation.
- Killing an active send interrupts its waiting caller.
- A killed child remains listed with status `killed`.
- A later send using the same thread creates a new child rather than reviving the killed session.

### Requirement: Existing delegation guarantees remain intact

Shared tools MUST retain existing behavior for depth limits, timeout, workspace and room inheritance, app-context compatibility, per-agent model/thinking settings, and `subagent_session` trace linkage.

The link event MUST use `toolName: "pibo_agents_send_message"` and continue to identify `subagentName`, child Pibo Session ID, resolved thread key, and optional tool call ID.

### Requirement: Operator CLI mirrors observation filters

The debug CLI MUST provide progressively discoverable delegated-agent commands:

```text
pibo debug agents --help
pibo debug agents <parent-session-id> list
pibo debug agents <parent-session-id> observe [filters]
```

The observe command MUST use the same ownership and filter vocabulary where persisted data permits it, and JSON output MUST be stable for automation.

## Edge Cases

- Two configured agent names may target the same profile and remain separate identities.
- Existing legacy child sessions with `subagentToolName: pibo_subagent_*` remain discoverable by metadata but all new link events use the shared send tool name.
- A killed legacy child is excluded from thread reuse.
- Parent-link cycles do not cause unbounded depth or ownership traversal.
- Observation details may contain tool payloads; normal output remains bounded and payload persistence/redaction rules continue to apply.
- Router restarts preserve child-session records and persisted debug history; the live tool cursor is scoped to the current authoritative router lifetime.

## Constraints

- **Simplicity:** No additional scheduler or agent-state database is introduced.
- **Compatibility:** Pibo Run remains the sole asynchronous execution and wait lifecycle.
- **Security:** Management operations are scoped to direct children of the calling Pibo Session.
- **Performance:** Listing uses indexed session-store queries; observation retention and result limits are bounded.
- **Legacy:** `codex-compat` receives only necessary reference corrections.

## Success Criteria

- [ ] SC-001: Two configured agents produce four shared tools and zero `pibo_subagent_*` tools.
- [ ] SC-002: Prompt inspection shows each available name and description.
- [ ] SC-003: Foreground send returns a child reply and reusable `agentId`; yielded send completes through `pibo_run_*`.
- [ ] SC-004: List reports available definitions and running/idle/killed instances accurately.
- [ ] SC-005: Observe combines all documented filters and cursor pagination without cross-parent leakage.
- [ ] SC-006: Kill interrupts active work, marks the instance killed, and prevents thread reuse.
- [ ] SC-007: Existing trace/UI delegation cards still link to child sessions under the shared send tool.
- [ ] SC-008: Pibo2 real-provider validation with `gpt-5.6-luna` at `low` demonstrates foreground, yielded, observe, list, and kill behavior in the headful Chat Web UI.

## Traceability

| Requirement | Primary implementation | Verification |
|---|---|---|
| Shared tool surface | `src/subagents/tool.ts`, `src/tools/session-tool-set.ts` | `test/subagents.test.mjs`, context inspection tests |
| Catalog in context | send tool model-visible description | tool/context tests |
| Send and identity | session router agent controller | router/tool tests, Pibo2 real run |
| List and kill | session router ownership/status methods | router/tool tests |
| Observe filters | normalized observation journal and debug query | filter unit tests, debug CLI tests |
| Existing delegation | router/session metadata and trace projections | trace/UI tests |
| Run compatibility | yielded tool assembly | run-control integration test, Pibo2 real run |
