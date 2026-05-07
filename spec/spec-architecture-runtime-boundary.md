---
title: Pibo Runtime Boundary Specification
version: 1.0
date_created: 2026-04-28
last_updated: 2026-05-01
owner: Pibo maintainers
tags: [architecture, runtime, plugins, profiles, channels, subagents, runs]
---

# Introduction

This specification describes the current Pibo runtime boundary as implemented in the TypeScript source code. The code is the source of truth. This document exists so agents can reason about the system without re-deriving the same boundaries from implementation files.

## 1. Purpose & Scope

This specification covers:

- Runtime ownership between Pibo and Pi Coding Agent.
- Profile, plugin, tool, skill, context file, subagent, channel, auth service, and web app registration.
- Session routing and Pibo Session behavior.
- Subagent and yielded-run behavior.

This specification does not define future marketplace behavior, remote deployment policy, or UI design beyond the current runtime contracts.

## 2. Definitions

- **Pibo**: The TypeScript wrapper that owns product boundaries around Pi Coding Agent.
- **Pi Coding Agent**: The embedded agent engine that owns model turns, tools, streaming, sessions, compaction, and Pi session files.
- **Profile**: A named initial session context containing selected tools, subagents, skills, explicit context files, automatic context-file loading mode, builtin tool mode, and tool packages.
- **Plugin**: A static internal registration unit that contributes capabilities to `PiboPluginRegistry`.
- **Channel**: A transport adapter that converts external input to `PiboInputEvent` values and consumes `PiboOutputEvent` values.
- **Pibo Session ID**: Stable product route identity used by Pibo channels, tools, APIs, UI, and event correlation.
- **Pi Session ID**: Technical Pi session identity used for Pi persistence and provider cache affinity.
- **Pibo Session**: Product session record containing route identity, Pi session identity, channel, kind, profile, owner scope, hierarchy, derivation metadata, workspace, title, and plugin metadata.
- **Yielded run**: A background execution wrapper for a yieldable tool that can be tracked, waited on, read, cancelled, or acknowledged.
- **Subagent**: A profile-scoped generated tool that routes a message into another Pibo session using a target profile.
- **Subagent session link**: A router output event that connects a parent generated subagent tool call to the child Pibo Session.
- **Product event**: A non-chat product lifecycle event emitted by a plugin for UI synchronization, such as managed context-file changes.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: Pibo MUST remain a thin harness around Pi Coding Agent. Pi Coding Agent remains responsible for model turns, streaming, tools, sessions, and compaction.
- **REQ-002**: Pibo MUST own product boundaries: profiles, plugins, channels, auth, policy, routing, Pibo Sessions, and transport adapters.
- **REQ-003**: Plugins MUST be static internal registrations through `PiboPluginRegistry`.
- **REQ-004**: `PiboPluginRegistry` MUST reject duplicate plugin ids, tools, subagents, skills, context files, profiles, gateway actions, channels, web app names, profile aliases, and gateway slash commands.
- **REQ-005**: A profile MUST be built through registered resources. Unknown profile resources MUST throw errors during profile creation.
- **REQ-006**: Runtime creation MUST load enabled skills and enabled explicit context files relative to the runtime cwd unless their paths are absolute.
- **REQ-006A**: Runtime creation MUST load automatic local context files by default and MUST suppress automatic local context files when profile `autoContextFiles` is `false`. Explicit profile context files MUST still be eligible for loading when automatic context files are disabled.
- **REQ-006B**: The plugin layer MUST support upserting and removing context-file catalog entries after startup so product-managed context files can appear alongside plugin-shipped files.
- **REQ-007**: Runtime creation MUST include enabled custom tool definitions, generated subagent tools, and generated run-control tools when a run controller is available and at least one tool is yieldable.
- **REQ-008**: Builtin Pi tools MUST be disabled only when the profile `builtinTools` mode is `"disabled"`.
- **REQ-009**: A `PiboSessionRouter` MUST create routed sessions lazily by `piboSessionId`.
- **REQ-010**: Concurrent creation for the same `piboSessionId` MUST share one pending session creation promise.
- **REQ-011**: The router MUST resolve a Pibo Session before creating a routed runtime.
- **REQ-012**: A Pibo Session MUST preserve `id`, `piSessionId`, channel, kind, profile, optional owner scope, optional parent identity, optional origin identity, workspace, title, metadata, and timestamps.
- **REQ-013**: When a persistent session store exists, the router MUST use it for Pibo Session resolution.
- **REQ-014**: Without a persistent store, the router MUST use in-memory Pibo Sessions for the process lifetime.
- **REQ-015**: A message input event MUST be queued per routed session and processed sequentially.
- **REQ-016**: Execution actions MUST be dispatched through registered gateway actions.
- **REQ-017**: Unknown execution actions MUST fail with an explicit error.
- **REQ-018**: Disposing a session MUST remove it from the router and cancel runs owned by that session.
- **REQ-019**: Router output events MUST be delivered to plugin listeners and router subscribers.
- **REQ-020**: Plugin listener failures MUST be collected as registry event errors and MUST NOT prevent other listeners from receiving events.
- **REQ-020A**: The plugin layer MUST provide a separate product-event surface for non-router product lifecycle changes and MUST allow plugins to emit and subscribe to those events without routing them as `PiboOutputEvent` values.
- **REQ-021**: A subagent definition MUST point to a registered target profile.
- **REQ-022**: A subagent call MUST create or reuse a routed child Pibo Session with `channel: "pibo.subagents"`, `kind: "subagent"`, `parentId`, target profile, and subagent metadata.
- **REQ-023**: Omitted subagent `threadKey` values MUST create a new child session using a generated UUID.
- **REQ-024**: Reused subagent sessions MUST remain bound to the same parent, target profile, subagent name/tool name, and thread key.
- **REQ-025**: Subagent calls MUST enforce the configured `maxDepth` or default depth `3`.
- **REQ-026**: Generated subagent tool names MUST have prefix `pibo_subagent_`.
- **REQ-026A**: Generated subagent tools MUST use Pi tool execution mode `"parallel"` and Pibo MUST NOT expose a per-subagent sequential execution mode in `SubagentProfile`, plugin capability catalog entries, or Chat Web custom-agent subagent configuration.
- **REQ-027**: Profiles with yieldable tools MUST expose generated run-control tools with prefix `pibo_run_`.
- **REQ-028**: Tracked yielded runs MUST create compact service notifications until terminal results are consumed or acknowledged.
- **REQ-029**: Detached yielded runs MUST remain inspectable when requested but MUST NOT create automatic reminders.
- **REQ-030**: Running yielded runs MUST be cancelled when the owning session or router is disposed.
- **REQ-031**: A generated subagent tool MUST pass its `toolCallId` into the subagent runner.
- **REQ-032**: The subagent runner MUST emit a parent `subagent_session` link event before waiting for the child reply.
- **REQ-033**: Subagent calls MUST use the configured `timeoutMs` when present and otherwise use a bounded default timeout.
- **REQ-034**: Yielded-run wrapping MUST preserve the wrapped yieldable tool identity and arguments in run results or run snapshots.
- **REQ-035**: If `pibo_run_start` starts a generated `pibo_subagent_*` tool, the runtime MUST retain enough metadata for Chat Web trace reconstruction to show both the yielded run context and the underlying subagent delegation.
- **CON-001**: External MCP servers, Python runtimes, and third-party CLI tools are optional integrations and MUST NOT be bundled into normal Pibo profiles by default.
- **CON-002**: Web app routes MUST start with `/`, MUST NOT end with `/` except root, and MUST NOT overlap existing web app mount paths or API prefixes.
- **PAT-001**: Prefer explicit registration and typed boundaries over hidden coupling.

## 4. Interfaces & Data Contracts

### Profile Contracts

```ts
type ToolProfile = {
  name: string;
  description?: string;
  enabled?: boolean;
  yieldable?: boolean;
  definition?: ToolDefinition;
};

type SubagentProfile = {
  name: string;
  description?: string;
  targetProfile: string;
  enabled?: boolean;
  timeoutMs?: number;
  maxDepth?: number;
};

type InitialSessionContextOptions = {
  profileName: string;
  sessionId?: string;
  parentSessionId?: string;
  skills?: readonly SkillProfile[];
  tools?: readonly ToolProfile[];
  subagents?: readonly SubagentProfile[];
  contextFiles?: readonly ContextFileProfile[];
  builtinTools?: "default" | "disabled";
  autoContextFiles?: boolean;
  toolPackages?: { runControl?: boolean };
};
```

### Plugin Contract

```ts
type PiboPlugin = {
  id: string;
  name?: string;
  register(api: PiboPluginApi): void;
};
```

The plugin API supports registration of tools, subagents, skills, context files, profiles, gateway actions, channels, auth services, web apps, output event listeners, product event listeners, and dynamic context-file catalog updates.

### Channel Contract

```ts
type PiboChannel = {
  name: string;
  kind?: "local" | "web" | "messaging" | "custom";
  description?: string;
  auth: { mode: "trusted-local" | "required" | "none" };
  start(context: PiboChannelContext): Promise<void> | void;
  stop?(): Promise<void> | void;
};
```

`PiboChannelContext` exposes only router/event methods, Pibo Session store methods, gateway action discovery, optional auth, profile inventory, and web app access.

```ts
type PiboChannelContext = {
  emit(event: PiboInputEvent): Promise<PiboOutputEvent>;
  subscribe(listener: PiboEventListener): () => void;
  getSession(id: string): PiboSession | undefined;
  createSession(input: CreatePiboSessionInput): PiboSession;
  updateSession?(id: string, input: UpdatePiboSessionInput): PiboSession | undefined;
  findSessions(input: FindPiboSessionsInput): PiboSession[];
  listSessions?(): PiboSession[];
  getGatewayActions(): PiboGatewayActionInfo[];
  getProfiles?(): Array<{ name: string; description?: string; aliases: string[] }>;
  auth?: PiboAuthService;
  getWebApps(): PiboWebApp[];
};
```

### Built-In Profiles

| Profile | Aliases | Capabilities |
| --- | --- | --- |
| `codex-compat-openai-web` | `codex` | Codex-compatible tools, delegated subagents, and run-control tools |
| `pibo-gateway-producer` | `gateway-producer` | Parked opt-in profile with `pibo_gateway_send` |

## 5. Acceptance Criteria

- **AC-001**: Given two plugins with the same id, When registry creation runs, Then creation fails.
- **AC-002**: Given a profile alias, When `createProfile(alias)` is called, Then the aliased profile is created.
- **AC-003**: Given an unknown profile, When `createProfile(name)` is called, Then the error includes available profiles.
- **AC-004**: Given a new Pibo Session ID, When the router receives a message, Then a Pibo Session and routed runtime are created lazily.
- **AC-005**: Given multiple queued messages for one session, When processing starts, Then messages are prompted in queue order.
- **AC-006**: Given a disposed session, When new input targets it, Then the previous runtime is not reused.
- **AC-007**: Given a subagent with a stable thread key, When called twice from the same parent, Then the same child Pibo Session is used.
- **AC-008**: Given a tracked yielded run completes, When the parent turn finishes, Then the parent receives a compact service notification.
- **AC-009**: Given a detached yielded run completes, When notifications are scheduled, Then no automatic detached reminder is delivered.
- **AC-010**: Given a generated subagent tool call, When the child Pibo Session is resolved, Then subscribers receive a `subagent_session` output event containing the parent tool call id and child Pibo Session ID before the child reply is awaited.
- **AC-011**: Given `pibo_run_start` starts a generated subagent tool, When Chat Web reconstructs the trace, Then the result remains inspectable as a yielded run and as an async subagent/delegation node.
- **AC-012**: Given a profile disables `autoContextFiles`, When runtime creation loads resources, Then automatic local context files are omitted while explicit profile context files remain available.
- **AC-013**: Given a generated subagent tool is inspected, When tool definitions are created, Then its execution mode is `"parallel"` and no subagent profile field can override it.
- **AC-014**: Given a product-managed context file is created or removed after startup, When the capability catalog is queried, Then the context-file entry appears or disappears without restarting the process.
- **AC-015**: Given a plugin emits a product event for a managed context-file change, When subscribed UIs are connected, Then they can receive that event without it appearing as routed chat output.

## 6. Test Automation Strategy

- **Test Levels**: Unit and integration tests.
- **Frameworks**: Node.js built-in test runner through `node --test`; TypeScript build through `tsc`.
- **Primary Command**: `npm test`.
- **Focused Commands**: `npm run typecheck`, `node --test test/plugin-registry.test.mjs`, `node --test test/session-router-store.test.mjs`, `node --test test/subagents.test.mjs`, `node --test test/runs.test.mjs`.
- **Coverage Focus**: Registry uniqueness, profile building, routed session behavior, subagent Pibo Session reuse and link events, yielded-run lifecycle, yielded-run wrapped tool identity, Pibo Session persistence.

## 7. Rationale & Context

The current code keeps Pi Coding Agent as the inner engine and gives Pibo a small, explicit product boundary. Static plugins avoid marketplace complexity while still allowing new capabilities. Pibo Sessions separate product routing, ownership, profile selection, hierarchy, and plugin metadata from technical Pi session identity.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Pi Coding Agent - Required inner agent runtime.
- **EXT-002**: Node.js runtime - Required JavaScript runtime.

### Technology Platform Dependencies

- **PLT-001**: Node.js `>=24` as declared by the package engine.
- **PLT-002**: TypeScript ESM modules.

### Data Dependencies

- **DAT-001**: Optional SQLite Pibo Session store at `.pibo/pibo-sessions.sqlite`.
- **DAT-002**: Optional Pi persisted sessions managed by Pi Coding Agent.

## 9. Examples & Edge Cases

### Subagent Pibo Session

```json
{
  "channel": "pibo.subagents",
  "kind": "subagent",
  "parentId": "ps_parent",
  "profile": "worker",
  "metadata": {
    "subagentName": "worker",
    "subagentToolName": "pibo_subagent_worker",
    "threadKey": "review-thread"
  }
}
```

If `threadKey` is omitted, the router generates a fresh UUID thread key. Reuse is based on structured session fields and metadata, not on parsing the Pibo Session ID.

### Subagent Session Link Event

```json
{
  "type": "subagent_session",
  "piboSessionId": "ps_parent",
  "toolCallId": "tool-call-1",
  "toolName": "pibo_subagent_worker",
  "subagentName": "worker",
  "childPiboSessionId": "ps_child",
  "threadKey": "review-thread"
}
```

The event links the parent tool call to the routed child Pibo Session before the parent waits for the child reply.

### Run Notification Payload

```xml
<pibo_run_notification>
{"completed":[{"runId":"run_...","kind":"tool","status":"completed","toolName":"bash","summary":"bash run completed."}],"failed":[],"cancelled":[],"running":[],"instruction":"Use pibo_run_read for completed or failed runs. Use pibo_run_wait, pibo_run_status, pibo_run_cancel, or pibo_run_ack for runs you still need to manage."}
</pibo_run_notification>
```

## 10. Validation Criteria

- `npm run typecheck` passes.
- `npm test` passes.
- No spec statement contradicts `src/core/*`, `src/plugins/*`, `src/channels/*`, `src/subagents/*`, `src/runs/*`, or `src/sessions/*`.

## 11. Related Specifications / Further Reading

- [docs/architecture.md](../docs/architecture.md)
- [docs/agent-run-yield-spec.md](../docs/agent-run-yield-spec.md)
- [RULES.md](../RULES.md)
