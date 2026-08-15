# Design: Multi-Agent Runtime Adapters

**Status:** Implementing
**Created:** 2026-08-14
**Related docs:** `proposal.md`, `spec.md`, `tasks.md`

## Context

Pibo's current product/runtime boundary is centered on `createPiboRuntime()` returning Pi's `AgentSessionRuntime`. `RoutedSession` combines reusable queue/correlation/lifecycle behavior with Pi event parsing, Pi model/settings access, Pi tools, Pi session trees, Pi compaction, fast mode, context guard, provider recovery, and transcript-integrity recovery. Session stores require a Pi session id, plugin tool definitions use Pi types, and trace code reads Pi JSONL directly.

The target must not make Pi, Codex, ACP, or any upstream protocol the core abstraction. It must be a Pibo-owned SPI that is rich enough for Pi parity and explicit enough to describe partial external adapters.

## Reference inspection

The design was checked on 2026-08-14 against:

- Pibo investigation: `docs/reports/multi-agent-runtime-adapter-architecture-investigation-2026-08-14.md`.
- T3 Code commit `e25021af767b10c560862fcec714cf67fb22cfae`:
  - `docs/internals/providers.md`
  - `apps/server/src/provider/ProviderDriver.ts`
  - `apps/server/src/provider/Services/ProviderAdapter.ts`
  - `apps/server/src/provider/Drivers/CodexDriver.ts`
  - `apps/server/src/provider/Layers/CodexAdapter.ts`
  - `apps/server/src/mcp/McpProviderSession.ts`
  - `apps/server/src/mcp/McpSessionRegistry.ts`
  - `apps/server/src/mcp/McpHttpServer.ts`
- OpenAI Codex commit `a186f5484dc8b89f103859a7c9bd632881fba54b`:
  - `codex-rs/app-server/README.md`
  - `codex-rs/app-server-protocol/src/protocol/common.rs`
  - generated v2 JSON schemas under `codex-rs/app-server-protocol/schema/json/v2/`.

Useful ideas retained from T3 Code:

- Driver configuration is decoded before instance creation.
- Configured instances are isolated closures/resources.
- Configured-instance registry and live session directory are separate.
- Provider-native events become canonical events before orchestration consumes them.
- Process/session scope owns cleanup.
- MCP credentials are issued per session and injected without exposing the product's normal web auth credential.

Ideas not copied:

- Effect services/layers are not introduced into Pibo.
- T3's provider/thread domain model is not used as Pibo's product model.
- T3's canonical event algebra is not copied wholesale.
- T3's 24-hour MCP liveness window is too broad for Pibo's selected-tool capability model; Pibo credentials use shorter leases and explicit renewal/revocation.

## Goals

- Keep product orchestration independent of any harness.
- Preserve Pi behavior and compatibility before adding Codex.
- Make every optional behavior capability-driven.
- Keep configured runtime instances separate from live session handles.
- Keep native prompts, tools, sessions, and transcripts adapter-owned.
- Provide real portable paths for Pibo tools, skills, context, MCP, and subagents.
- Make persistence, history, debug, and Agent Designer runtime-aware.

## Non-Goals

- A lowest-common-denominator interface that hides rich adapter features.
- A generic ACP core.
- Replacing Pibo Sessions with native thread ids.
- Copying user-global Codex or Pi homes for each turn.
- Starting native Codex before Pi parity evidence is clean.

## Architecture

```text
Channels / Chat Web / CLI / Cron / Loop / Workflow / Subagent
                              |
                              v
                       PiboSessionRouter
                              |
                    Generic RoutedSession
                 queue / correlation / lifecycle
                              |
                  configured runtime instance id
                              v
                AgentRuntimeAdapterRegistry
             descriptors + configured instances only
                              |
                              v
                   AgentRuntimeAdapter.openSession
                              |
                  adapter-owned AgentRuntimeSession
           +------------------+-------------------+
           |                                      |
           v                                      v
      Pi adapter                             Codex adapter
   embedded Pi SDK                    official app-server v2
           |                                      |
           +---------- semantic events -----------+
                              |
                              v
                   PiboOutputEvent projection
                              |
       signals / reliability / telemetry / trace / UI

Portable Pibo tools -> Pi direct compiler OR session-scoped MCP bridge
Skills/context      -> adapter materialization plan and fidelity report
External MCP        -> adapter-scoped config plus connection verification
Native history      -> adapter history provider for resume/import/debug
```

## Decision: Naming

Use `agentRuntime` and `runtimeAdapter` in code. The existing persistent Python/Node `runtime` tool keeps its current name. This avoids conflating the code-execution tool with the harness runtime.

## Decision: Descriptor, configured instance, and live session are separate types

### Descriptor

```ts
export type AgentRuntimeAdapterDescriptor = {
  id: string;
  displayName: string;
  transport: "embedded" | "stdio-rpc" | "socket-rpc" | "remote";
  configSchema: PiboJsonSchema;
  capabilities: AgentRuntimeCapabilities;
  protocol?: { name: string; supportedRange?: string };
};
```

The descriptor is static and stable. It does not contain mutable process state.

### Configured instance

```ts
export interface AgentRuntimeAdapter {
  readonly instanceId: string;
  readonly descriptor: AgentRuntimeAdapterDescriptor;
  readonly config: PiboJsonObject;

  diagnose(): Promise<AgentRuntimeDiagnostic[]>;
  validateProfile(input: ValidateAgentRuntimeProfileInput): AgentRuntimeDiagnostic[];
  openSession(input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession>;

  inspectProfile?(input: InspectAgentRuntimeProfileInput): Promise<AgentRuntimeAssemblyInspection>;
  listModels?(): Promise<AgentRuntimeModelCatalog>;
  getAuthStatus?(): Promise<AgentRuntimeAuthStatus[]>;
  readHistory?(input: ReadAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryPage>;
  resolveBinding?(input: ResolveAgentRuntimeBindingInput): Promise<RuntimeSessionBinding>;
}
```

A configured instance owns validated config such as binary path, isolated home root, environment allowlist, or remote endpoint. Multiple instances of one adapter are allowed unless the descriptor says otherwise.

### Live session

```ts
export interface AgentRuntimeSession {
  readonly adapterId: string;
  readonly runtimeInstanceId: string;
  readonly cwd: string;
  readonly capabilities: AgentRuntimeSessionCapabilities;

  getBinding(): RuntimeSessionBinding;
  subscribe(listener: (event: AgentRuntimeSemanticEvent) => void): () => void;
  prompt(input: AgentRuntimePromptInput): Promise<void>;
  steer?(input: AgentRuntimePromptInput): Promise<void>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
  getStatus(): AgentRuntimeStatus;
  getStatusSnapshot?(): Promise<AgentRuntimeStatus>;

  controls?: AgentRuntimeControls;
  compatibility?: unknown;
}
```

The router owns the map from Pibo Session id to generic `RoutedSession`. Each `RoutedSession` owns exactly one live `AgentRuntimeSession`. The adapter instance registry never stores live sessions.

## Decision: Registry ownership

`PiboPluginRegistry` receives `registerAgentRuntimeAdapter(adapter)` and stores configured adapter instances in an internal `AgentRuntimeAdapterRegistry`. It exposes:

- `getAgentRuntimeAdapter(instanceId)`
- `getAgentRuntimeAdapterDescriptors()`
- `getAgentRuntimeInstanceInfos()`
- runtime entries in `PiboCapabilityCatalog`.

The registry validates:

- adapter id format and uniqueness rules;
- configured instance id uniqueness;
- descriptor/config consistency;
- config JSON shape before registration;
- capability/method consistency where it can be checked statically.

The core plugin registers the default configured `pi` instance. Native Codex later registers `codex-native` as an instance backed by adapter id `codex`. The instance id and profile name may match for the default native profile but are separate concepts.

## Decision: Profile and session runtime selection

`InitialSessionContext` has additive runtime fields:

```ts
runtimeInstanceId: string;      // default "pi"
runtimeOptions: PiboJsonObject; // default {}
```

Configured instance id is the routing key. `PiboProfileInfo` and custom-agent rows expose the same selection and options. Custom-agent SQLite migration adds `runtime_instance_id` and `runtime_options_json` with Pi-compatible defaults, so existing agents remain Pi-backed without rewriting their identities.

At Pibo Session creation:

1. Resolve the requested profile.
2. Resolve explicit session runtime override if present, otherwise profile default.
3. Validate the configured instance and portable selections.
4. Persist an `unbound` runtime binding before runtime creation.
5. Freeze that instance for the session.

Existing sessions without a binding resolve to a backfilled/default Pi binding. Editing a profile never changes an existing binding.

## Implemented Designer and profile-inspection flow

The runtime-aware Designer path is additive:

1. `AgentRuntimeAdapterRegistry.inspectInstances()` combines descriptor data, enabled state, adapter diagnostics, runtime-scoped model catalogs, and auth status.
2. Chat bootstrap and `/api/chat/agent-catalog` expose every configured instance, including disabled or unavailable entries, with diagnostics and declared capability delivery modes.
3. Custom-agent create/update requests normalize the runtime id and JSON options, build a non-persisted candidate profile, and reject adapter or capability errors before writing the row.
4. Agent Designer renders a configured-instance selector, schema-generated primitive option controls, an advanced JSON editor, runtime diagnostics, effective capabilities, and disabled portable controls with explanations. Persisted unsupported selections remain removable.
5. Context Build reads the session's frozen binding. Pi sessions retain the detailed Pi startup-context inspector; non-Pi sessions use a runtime-neutral contribution snapshot and never render the Pi base prompt.
6. Session startup repeats capability and adapter validation, so non-Web profiles cannot bypass save-time checks.

The legacy top-level Pi model catalog remains for old clients during the compatibility window. Runtime entries now also carry their own model and auth catalogs, and Agent Designer prefers the selected runtime's catalog.

## Decision: Capability model

Capabilities are structured instead of a flat string list so Designer and generic dispatch can explain delivery and limitations.

```ts
type CapabilitySupport =
  | { support: "unsupported"; reason: string }
  | { support: "native" }
  | { support: "direct" }
  | { support: "mcp"; transports: ("streamable-http" | "stdio")[] }
  | { support: "materialized"; modes: string[] }
  | { support: "degraded"; reason: string; mode: string };

type AgentRuntimeCapabilities = {
  lifecycle: {
    persistent: boolean;
    lazyBinding: boolean;
    resume: boolean;
    attach: boolean;
    listNativeSessions: boolean;
    fork: boolean;
    clone: boolean;
    tree: boolean;
  };
  input: { text: boolean; images: boolean; audio: boolean; steering: boolean; structuredOutput: boolean };
  output: { assistantDeltas: boolean; reasoning: boolean; tools: boolean; usage: boolean; plans: boolean; diffs: boolean };
  tools: { piboManaged: CapabilitySupport; nativeToolYielding: CapabilitySupport };
  mcp: { externalServers: CapabilitySupport; statusInspection: boolean };
  skills: CapabilitySupport;
  context: CapabilitySupport;
  models: { catalog: boolean; switchInSession: boolean; optionsSchema?: PiboJsonSchema };
  reasoning: { supported: boolean; values?: string[] };
  approvals: { supported: boolean; structuredUserInput: boolean };
  maintenance: { compaction: boolean; contextUsage: boolean; history: boolean; health: boolean };
};
```

Session capabilities may narrow descriptor capabilities after launch/negotiation. Generic callers use the live capability snapshot and optional method presence. A mismatch is an adapter contract failure, not an excuse for silent fallback.

## Decision: Generic semantic event model

Adapters emit Pibo-owned events without Pibo Session routing fields:

```ts
type AgentRuntimeSemanticEvent =
  | { type: "assistant_delta"; text: string; contentIndex?: number }
  | { type: "assistant_message"; text: string; contentIndex?: number }
  | { type: "reasoning_started"; contentIndex?: number }
  | { type: "reasoning_delta"; text: string; contentIndex?: number }
  | { type: "reasoning_finished"; text?: string; contentIndex?: number }
  | { type: "tool_call"; callId: string; name: string; args: unknown; complete: boolean }
  | { type: "tool_started"; callId: string; name: string; args: unknown }
  | { type: "tool_updated"; callId: string; name: string; update: unknown }
  | { type: "tool_finished"; callId: string; name: string; result: unknown; isError: boolean }
  | { type: "usage"; usage: AgentRuntimeUsage }
  | { type: "compaction_started"; reason: string }
  | { type: "compaction_finished"; reason: string; result?: unknown; aborted: boolean; error?: string }
  | { type: "approval_requested"; request: AgentRuntimeApprovalRequest }
  | { type: "user_input_requested"; request: AgentRuntimeUserInputRequest }
  | { type: "warning"; message: string; details?: PiboJsonObject }
  | { type: "error"; message: string; details?: AgentRuntimeErrorDetails }
  | { type: "native_event"; event: unknown; redacted?: boolean };
```

`RoutedSession` owns Pibo Session id, input event id correlation, assistant/reasoning indices, queue lifecycle, and conversion to `PiboOutputEvent`. The adapter owns native event parsing, native retry/recovery, and native turn settlement.

A future output-contract phase adds `runtime_event` with adapter/instance metadata. `pi_event` remains a compatibility projection produced only for Pi when requested.

## Decision: Pi extraction shape

Source layout:

```text
src/agent-runtime/
  capabilities.ts
  errors.ts
  events.ts
  registry.ts
  types.ts
  history.ts
  testing/fake-adapter.ts
  testing/contract.ts

src/agent-runtimes/pi/
  adapter.ts
  session.ts
  runtime.ts
  event-normalizer.ts
  recovery.ts
  controls.ts
  history.ts
  inspection.ts
  compatibility.ts
```

Migration order:

1. Add contracts, registry, fake adapter, and descriptor catalog.
2. Wrap existing `createPiboRuntime()` in `PiAgentRuntimeAdapter`.
3. Move Pi event normalization and runtime session behavior into `PiAgentRuntimeSession`.
4. Make generic `RoutedSession` depend only on `AgentRuntimeSession`.
5. Move Pi controls and recovery into the Pi session implementation.
6. Keep `createPiboRuntime()` and direct TUI as Pi compatibility facades.
7. Add an import-boundary test forbidding Pi dependencies in `src/agent-runtime/`, generic router modules, and generic history modules.

Tests that intentionally inspect the underlying Pi runtime use a documented Pi compatibility handle, not generic router internals. The compatibility handle is not consumed by generic orchestration.

## Decision: Runtime binding data model

Add to `pibo.sqlite`:

```sql
CREATE TABLE session_runtime_bindings (
  pibo_session_id TEXT PRIMARY KEY,
  runtime_instance_id TEXT NOT NULL,
  runtime_adapter_id TEXT NOT NULL,
  native_session_id TEXT,
  binding_state TEXT NOT NULL,
  protocol TEXT,
  protocol_version TEXT,
  adapter_version TEXT,
  locator_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (pibo_session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX session_runtime_bindings_native_unique
ON session_runtime_bindings(runtime_adapter_id, native_session_id)
WHERE native_session_id IS NOT NULL;
```

A similar additive table is added to the legacy store if that store remains writable during the compatibility window.

Binding state transitions:

```text
(no row legacy) -> synthesized/backfilled pi bound
new session -> unbound (a Pi compatibility row may already reserve its native id)
unbound -> bound       native session created and CAS persisted
bound -> bound         resume/reopen; metadata/version may update
bound -> missing       adapter proves native session absent
bound -> error         binding exists but cannot currently open
missing/error -> bound only through explicit repair/attach/rebind action
```

The store uses revision-based compare-and-set for `unbound -> bound` so two gateways cannot create competing native sessions. `bound` and `missing` require a native session id. Native-session uniqueness is adapter-scoped, including across multiple configured instances of the same adapter. Credentials never enter the binding.

Compatibility:

- Existing `sessions.pi_session_id` stays unchanged and unique for Pi rows.
- Pi binding writes dual-write the old field and binding table.
- Reads prefer binding table, synthesize from `piSessionId` when absent, and opportunistically backfill where safe.
- Non-Pi sessions allow `pi_session_id IS NULL` in v2 storage.
- No removal occurs in this goal.

Rollback:

- Old binaries ignore the additive table and continue reading Pi rows.
- Rollback is safe only while all newly created sessions are Pi-backed or the operator accepts that old binaries cannot operate non-Pi sessions.
- Migration documentation requires database backup before rolling back after native Codex sessions exist.

## Decision: Portable Pibo tool contract

```ts
type PiboToolDefinition<TSchema extends PiboJsonSchema> = {
  name: string;
  title: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  inputSchema: TSchema;
  outputSchema?: PiboJsonSchema;
  executionMode?: "sequential" | "parallel";
  annotations?: {
    readOnly?: boolean;
    destructive?: boolean;
    idempotent?: boolean;
    openWorld?: boolean;
  };
  portable?: boolean;
  prepareInput?: (input: unknown) => Static<TSchema>;
  execute(
    toolCallId: string,
    input: Static<TSchema>,
    signal: AbortSignal | undefined,
    onUpdate: PiboToolUpdateCallback | undefined,
    context: PiboToolExecutionContext,
  ): Promise<PiboToolResult>;
};

type PiboToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data?: string; mimeType: string; payloadRef?: string; alt?: string }
  >;
  structuredContent?: PiboJsonValue;
  details?: unknown;
  isError?: boolean;
  payloadRefs?: string[];
  metadata?: PiboJsonObject;
};
```

Execution receives Pibo Session id, Room id, profile, working directory, active-message correlation, runtime instance, adapter, and live session generation. Cancellation and progress are explicit arguments, and adapter credentials are never exposed to the tool. Deprecated `label`/`parameters` aliases preserve callers during migration without making Pi types part of the contract.

The Pi compiler converts the JSON Schema and Pibo result model to Pi's accepted direct in-process tool shape. Pibo-owned tool factories use the portable contract. Structurally recognized legacy Pi definitions are wrapped as `portable: false`: they still work through Pi's direct compiler but are rejected for MCP-delivered runtimes.

## Decision: Session-scoped MCP bridge

The first bridge is loopback Streamable HTTP because official Codex supports MCP server URLs plus bearer-token environment variables without editing global config.

Credential record:

```ts
type RuntimeToolCredentialScope = {
  credentialId: string;
  secretHash: Uint8Array;
  piboSessionId: string;
  runtimeInstanceId: string;
  adapterId: string;
  sessionGeneration: string;
  allowedToolNames: ReadonlySet<string>;
  issuedAt: string;
  expiresAt: string;
  lastAliveAt?: string;
  revokedAt?: string;
};
```

Rules:

- Raw token secrets are generated with 256 bits of entropy and returned to adapter-owned process state; only the secret hash and a separate random credential id are retained.
- Secret comparison is constant-time after credential-id lookup.
- The bridge authenticates every Streamable HTTP request and constructs `PiboToolExecutionContext` from the bound scope.
- Tool discovery returns only allowed Pibo-managed tools for that session.
- Each call checks session generation and current selection again.
- Abort/cancellation propagates through MCP to the Pibo tool signal.
- Progress maps to MCP progress notifications and Pibo tool updates.
- Text, image, structured data, errors, and call/session correlation map into MCP results.
- Large results use the existing payload store and bounded previews with payload references.
- Credentials use short fixed leases with a bounded maximum lifetime, explicit live-session renewal, and revocation on dispose/rebind/router shutdown.
- Tests attempt cross-session list/call, stale token, revoked token, wrong instance, and removed-tool access.

The bridge does not reuse Better Auth cookies, machine keys, gateway bearer tokens, or Codex auth.

## Decision: Runtime resource sessions for skills, context, and external MCP

`PiboSessionRouter` creates one `PiboRuntimeResourceSession` before opening the adapter. It uses the same random `sessionGeneration` as the portable-tool session, so credentials, generated files, and adapter lifecycle have one revocation/cleanup boundary. The prepared session is passed through `AgentRuntimeOpenServices.resources`; generic orchestration does not branch on adapter identity.

The resource session exposes two views:

- hydrated selected skills, ordered context contributions, selected MCP server configs, and a session-only environment for the adapter;
- safe inspection data containing source/target paths, byte counts, MCP names and inventory, delivery status/mode/fidelity, and redacted diagnostics without context bodies, resolved configs, or secret values.

Canonical records include:

```ts
type AgentRuntimeContextContribution = {
  id: string;
  kind: "automatic" | "product" | "context-file" | "generated";
  source: "pibo-product" | "profile" | "plugin" | "managed" | "generated";
  intent: "developer" | "project" | "session" | "user-visible";
  required: boolean;
  order: number;
  content?: string;
  byteSize?: number;
  sourcePath?: string;
  materializedPath?: string;
};

type AgentRuntimeDeliveryReport = {
  contributionId: string;
  status: "delivered" | "degraded" | "unsupported" | "failed";
  mode: string;
  fidelity: "exact" | "equivalent" | "lossy" | "none";
  target?: string;
  diagnostic?: string;
};
```

Materialized adapters receive a private generation tree:

```text
$PIBO_HOME/agent-runtimes/<runtime-instance-id>-<hash>/<pibo-session-id>-<hash>/<generation>-<hash>/
  home/
  skills/
  context/
  config/
  protocol/
```

Directories are mode `0700`; generated MCP configuration is mode `0600`. Skill materialization copies the selected skill directory only, resolves symlinks, rejects paths escaping the selected source root or cycles, and enforces file-count and byte limits. It never scans the global skill catalog. Context files are read in profile order and written only when the adapter advertises materialized delivery. A materialized adapter may claim automatic AGENTS.md / CLAUDE.md only by declaring the `native-project-discovery` mode; otherwise save/start validation rejects automatic context instead of assuming discovery. Required failed/unsupported contributions reject live startup; inspection uses non-strict mode so Agent Designer and Context Build can explain the same failure.

Pi continues using its native base prompt, skill loader, context loader, and built-in tools. The resource session supplies only the selected skill/context additions, so Pi delivery is reported as native/equivalent without converting them to a foreign prompt. Materialized external adapters receive generated skill/context paths; later Codex work maps those paths into the exact official App Server channels. Pibo's Pi base prompt is never part of an external adapter's resource plan.

## Decision: External MCP delivery

Pibo loads unresolved MCP definitions so `${ENV}` placeholders can be rebound without placing resolved credentials in generated files. Only selected server definitions are copied into the runtime generation. Environment/header values, command arguments, referenced variables, and sensitive URL fields are replaced with generated `PIBO_RUNTIME_MCP_*` references; resolved values exist only in the resource session's adapter-scoped environment. Neither `process.env`, the source MCP file, user-global harness configuration, bindings, nor inspection output is mutated.

Before live startup completes, the resource service connects to each selected server through the official MCP SDK with a bounded timeout and records safe server identity/version, exposed tools after include/exclude filtering, resources, and resource templates. A definition is not reported delivered merely because a file was written. Missing configuration, missing secret variables, startup/protocol failure, unsupported adapter delivery, and inventory failure become contribution diagnostics and fail required live startup.

For the Pi adapter, the generated selected-only MCP file and secret environment are injected into a Pi-owned Bash definition rather than the gateway process. Existing `pibo mcp` commands therefore see exactly the session selection while Pi's native prompt and standard tool semantics remain intact. The generated session sets `PIBO_MCP_ISOLATED_ENV=1`, causing stdio MCP children to inherit the SDK's safe baseline plus explicit server environment rather than unrelated gateway variables; non-session CLI behavior remains backward compatible. Profiles selecting external MCP must provide Bash either through the Pi built-in set or run control. Context Build reports connected/failed/unsupported state, delivery fidelity, tools/resources/templates, and the private target path while omitting secret values. Disposal removes the generation tree and clears in-memory scoped configuration. Gateway and Chat Web deletion await live router disposal before removing session persistence or returning success, so permanent deletion cannot leave a generation containing scoped MCP state behind.

## Decision: History and trace

`AgentRuntimeHistoryEntry`, `AgentRuntimeHistoryInspection`, and `AgentRuntimeHistoryPage` are Pibo-owned normalized inputs to trace materialization. New routed turns persist durable user/assistant messages plus terminal reasoning, tool, lifecycle, error, compaction, and execution events in Pibo's message/event/payload stores. Normal Chat Web reconstruction reads those records and does not locate or open native transcript files.

An adapter that declares `maintenance.history` must implement both:

- `inspectHistory`, which reports availability, safe metadata, an adapter-scoped locator, version, and diagnostics;
- `readHistory`, which returns normalized native entries and an opaque provider cursor.

Generic trace modules consume only normalized history entries and normalized Pibo events. They distinguish product history from native compatibility history so product messages suppress only duplicate assistant output while terminal reasoning and tool events remain visible. Runtime history cursors wrap opaque provider cursors with the Pibo Session, configured runtime instance, and adapter identity; Chat Web rejects a cursor replayed against a different binding.

Pi JSONL discovery, bounded reads, pagination, parsing, and normalization live in `src/agent-runtimes/pi/history.ts`. Existing databases migrate to schema v5 and mark pre-existing runtime bindings for native-history compatibility without changing Pibo Session ids, Pi session ids, transcript paths, or binding revisions. Fresh sessions do not receive that marker. Old/forked Pi sessions may read native history through the selected adapter, while a missing native transcript falls back to surviving Pibo product history and remains a visible diagnostic rather than creating a replacement transcript.

Large product messages and terminal event bodies are hydrated from `PayloadStore` before trace/debug projection. Debug trace defaults to product history and reads native history only for an empty legacy session or explicit `--native-history`. `pibo debug session <ps_...> runtime` exposes binding identity and bounded product-history counts; other session-scoped debug surfaces include runtime identity but omit binding locator/config/metadata values. Codex later maps the same provider contract to official thread history APIs. Native transcripts remain adapter-owned resume state, not co-equal mutable product history.

## Decision: Approvals and user input

Add normalized runtime request records and output events. Requests are persisted with:

- Pibo Session id;
- runtime instance/adapter;
- native request id (opaque/redacted in normal UI);
- turn/message correlation;
- request type and safe summary;
- structured fields/options;
- status and timestamps.

Generic execution actions respond through capability-gated `controls.respondToApproval` and `controls.respondToUserInput`. Chat Web presents pending requests in the active session. Abort/disposal resolves or rejects outstanding requests deterministically. Pi may initially advertise unsupported if no equivalent request surface exists.

## Decision: Native Codex adapter

Transport and schema:

- Spawn configured `codex app-server --stdio` (or the exact equivalent supported by the validated binary).
- Use newline-delimited JSON request/response/notification framing; never parse human terminal output.
- Send `initialize` once, then `initialized`.
- Generate TypeScript/JSON schema from the exact candidate binary and store deterministic fixtures/version metadata.
- Prefer stable v2 methods. Experimental methods require explicit initialization capability and adapter capability flags.
- Treat `-32001` overload as retryable with bounded exponential backoff and jitter.

Lifecycle:

1. Create isolated generation directory and process environment.
2. Materialize selected skills/context/MCP configuration.
3. Issue Pibo MCP bridge credential.
4. Spawn app-server and initialize.
5. For `unbound`, call `thread/start`, persist returned thread id using binding CAS.
6. For `bound`, call `thread/resume` for the exact thread id.
7. If resume proves missing, mark binding `missing`; do not call `thread/start` automatically.
8. `turn/start` sends text/images and selected model/reasoning/options.
9. Normalize notifications and server requests.
10. `turn/interrupt` aborts active work.
11. Disposal unsubscribes, rejects requests, stops child process, revokes credentials, and cleans generation state.

Official surfaces currently identified in the inspected schema include thread start/resume/fork/read/list, turn start/steer/interrupt, model list, reasoning effort, thread token usage, compaction, skills list/extra roots, MCP startup/status/tool APIs, approvals, and structured user input. Final capability claims depend on the exact Pibo2 binary and generated schema.

Profile compatibility:

- Persisted/custom `codex-compat-openai-web` and `codex` references remain Pi-backed; native Codex does not claim the retired built-in alias that is absent from the August 14, 2026 baseline registry.
- Add `codex-native` selecting runtime instance `codex-native`.
- Native Codex does not load `context/codex-base-prompt.md` or the Pi Codex-compatibility extension.

## Decision: Diagnostics and CLI discovery

Capability catalog and profile inspection are the primary programmatic surfaces. Add compact CLI discovery only when implementation is ready, for example:

```text
pibo runtimes
pibo runtimes show <instance>
pibo runtimes schema <instance>
pibo runtimes doctor <instance>
pibo debug session <ps_...> runtime
```

Top-level help lists only immediate commands. Schema, full capabilities, environment requirements, and protocol details stay behind deeper commands.

Debug output redacts:

- MCP bearer tokens and hashes;
- Codex/Pi auth material;
- environment secret values;
- web cookies/machine keys;
- raw config values marked secret.

## Decision: Adapter contract suite

`runAgentRuntimeAdapterContract(factory, expectations)` is reusable by fake, Pi, and Codex fixture tests. It checks:

- descriptor/config/diagnostic validity;
- unique isolated sessions;
- new binding and resume;
- prompt, assistant stream, final message, usage;
- reasoning/tool events only when advertised;
- abort and idempotent disposal;
- missing native session behavior;
- process crash and malformed event normalization;
- every advertised control;
- no unadvertised method/capability mismatch;
- no events after terminal disposal;
- credential/session isolation where MCP is supported.

The deterministic fake adapter supports scripted events, delayed prompt, failure, crash, missing binding, and cleanup assertions. Generic router tests use it instead of Pi unless the test specifically protects Pi compatibility.

## Decision: Import boundaries

An architectural test scans imports and fails if:

- `src/agent-runtime/**` imports `@earendil-works/pi-*`, Codex client/schema modules, or adapter implementation directories;
- generic `src/core/routed-session.ts` or its replacement imports Pi/Codex packages;
- generic history/trace modules import Pi/Codex packages;
- product orchestration branches on literal adapter names when a capability dispatch is available.

Adapter directories may import their native dependencies. Compatibility facade files are explicitly allowlisted and documented.

## Risks and mitigations

### Pi behavior changes during extraction

Mitigation: move behavior before redesigning it; retain compatibility facade; run focused tests after each move; full suite and real Pibo2 parity gate before Codex.

### Interface becomes a Pi-shaped abstraction

Mitigation: fake adapter first, normalized semantic events, optional controls, no Pi types in generic modules, and Codex design review before freezing v1 interfaces.

### Capability claims exceed real delivery

Mitigation: save/start validation, delivery reports, contract assertions, exact-binary integration, and visible unsupported states.

### Native prompt damage

Mitigation: context plan separates Pibo product contributions from harness base prompt. Codex adapter never imports Pi prompt assembly.

### Credential leakage

Mitigation: one-time raw tokens, hashed registry, bounded debug, no binding persistence, per-session allowlists, explicit revocation, cross-session tests.

### Dual source of history

Mitigation: normalized Pibo history is product-visible source for new turns; native history is resume/import/debug source only.

### Migration rollback after Codex data exists

Mitigation: additive schema, documented backup/rollback boundary, and old-binary limitation called out explicitly.

## Migration and rollback sequence

1. Land contracts/registry/fake adapter with no persistence change.
2. Extract Pi and prove parity.
3. Add binding table/backfill/dual writes.
4. Add profile runtime selection defaulting to Pi.
5. Add portable tools/MCP/materialization and runtime-neutral history.
6. Add Designer/debug surfaces and authoring skill.
7. Add native Codex.
8. Validate exact integrated candidate on Pibo2.

A rollback before step 7 is transparent to old Pi behavior because compatibility columns and APIs remain. After native Codex sessions exist, rollback requires retaining the new binary or accepting that old binaries cannot run those sessions; no automatic conversion to Pi is permitted.
