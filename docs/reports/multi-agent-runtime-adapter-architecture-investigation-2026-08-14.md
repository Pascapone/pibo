# Multi-Agent Runtime Adapter Architecture Investigation

**Status:** Investigation / proposed direction
**Date:** 2026-08-14
**Scope:** Pibo core, routed sessions, profiles, tools, skills, context, persistence, traces, and future harness adapters

## Executive Summary

Pibo can support multiple agent harnesses, but the current implementation is not one adapter away from doing so. Pi Coding Agent is embedded across runtime construction, routed-session behavior, session persistence, tool definitions, model/auth discovery, context inspection, transcript repair, compaction, branching, and Chat Web trace reconstruction.

The recommended target is:

- Pibo remains the product and orchestration layer.
- Each agent harness is integrated through a registered **Agent Runtime Adapter**.
- A Pibo Session remains the stable product identity.
- The harness owns its native session and transcript.
- Pibo stores an opaque **Runtime Session Binding** that identifies the adapter, native session, and optional locator.
- Pibo owns the normalized input/output event contract and durable product projections.
- Pibo-owned tools use a harness-neutral tool definition and are compiled either directly into an embedded runtime or exposed through a session-scoped MCP bridge.
- Skills remain canonical `SKILL.md` packages and are materialized through adapter-specific skill-directory or prompt mechanisms.
- Context files are compiled into adapter-supported instruction channels without replacing a harness's tuned base prompt.
- Capabilities are negotiated. Unsupported operations are hidden or rejected explicitly rather than emulated silently.

The safest migration is a strangler refactor:

1. Define runtime-neutral contracts and contract tests.
2. Move all existing Pi behavior behind a `pi` adapter without changing product behavior.
3. Replace `piSessionId` as the generic persistence model with runtime bindings while retaining compatibility fields.
4. Decouple Chat Web history from direct Pi JSONL reads.
5. Introduce portable tool/skill/context delivery.
6. Add Codex as the first genuinely different runtime.
7. Add an ACP adapter base for Kimi Code and compatible harnesses.
8. Add richer Oh My Pi and Prime Agent adapters through their RPC surfaces where ACP is insufficient.

## Current-State Findings

### Coupling size

Repository inspection found:

- 36 source files directly import one or more `@earendil-works/pi-*` packages.
- 36 source files contain Pi-session-specific identifiers such as `piSessionId`, `pi_session_id`, `PiSession`, or `PiboPi`.
- There are 267 occurrences of those Pi-session-specific identifiers in `src/`.
- 12 source files define or consume Pi `ToolDefinition` values.
- The principal runtime/session/trace hot spots total more than 7,000 lines:
  - `src/core/runtime.ts`: 748 lines
  - `src/core/routed-session.ts`: 1,623 lines
  - `src/core/session-router.ts`: 1,260 lines
  - `src/apps/chat/trace.ts`: 707 lines
  - `src/core/context-build.ts`: 825 lines

This is manageable, but only if the migration extracts boundaries in stages instead of attempting a broad rename.

### Current ownership boundary

The existing intended boundary is sound:

- Pibo owns product sessions, rooms, profiles, routing, jobs, loops, workflows, UI, events, and product data.
- Pi owns model turns, transcript persistence, native tools, streaming, compaction, and low-level session operations.

The implementation problem is that this boundary is expressed through concrete Pi types instead of a Pibo-owned runtime interface.

### Runtime assembly is fully Pi-specific

`src/core/runtime.ts` directly owns:

- `SessionManager` creation/opening
- Pi auth storage
- Pi model registry and provider registration
- Pi resource loader configuration
- Pi extension factories
- Pi tool definitions and built-in tool allowlists
- Pi skill loading
- Pi context-file merging
- Pi package loading
- Pi compaction and context-guard extensions
- transcript-integrity installation
- Pi TUI startup

`createPiboRuntime()` currently returns `AgentSessionRuntime`. This function is therefore the existing Pi adapter implementation, even though it is named as a generic Pibo runtime.

### RoutedSession mixes orchestration with Pi internals

`src/core/routed-session.ts` contains reusable product behavior:

- per-session message queue
- message correlation
- lifecycle events
- execution-action dispatch
- disposal and quiescence
- Pibo run reminders

It also contains extensive Pi-specific behavior:

- Pi event normalization
- direct `AgentSessionRuntime` types
- direct `session.prompt`, `steer`, `abort`, and `compact`
- direct access to Pi model and settings managers
- direct tool activation changes
- direct Pi session manager tree/list/fork/switch operations
- patching Pi's provider stream functions for fast mode
- patching Pi agent continuation for compaction
- transcript-integrity continuation
- Pi context-guard continuation
- Pi/provider-specific retry recovery

This class must be split. The queue and product lifecycle should remain generic; Pi behavior should move into the Pi runtime handle/adapter.

### Product session persistence assumes Pi

`src/sessions/store.ts` requires every Pibo Session to have a non-null `piSessionId`.

The same assumption is persisted in:

- `src/sessions/sqlite-store.ts`
- `src/sessions/pibo-data-store.ts`
- `src/data/schema.ts`
- `src/data/session-store.ts`
- Chat Web read models and API payloads

The uniqueness rule is currently global uniqueness of `pi_session_id`. The future invariant must be uniqueness of `(runtime_adapter_id, native_session_id)` when a native session ID exists.

A newly created external-runtime Pibo Session may not have a native session ID until the adapter starts the harness. The target model must therefore support an unbound state.

### Profiles are partly portable and partly Pi configuration

Portable profile selections already exist:

- Pibo tools
- skills
- context files
- subagent definitions
- MCP server selections
- model intent

Pi-specific profile fields include:

- `piPackages`
- Pi built-in tool names
- Pi `ToolDefinition`
- Pi thinking-level type
- Codex compatibility implemented as Pi extensions/tools
- Pi automatic context-file behavior

The current `InitialSessionContext` should not be replaced in one step. It should first gain a runtime identity and adapter options, then be split into portable selections and adapter-native configuration after the Pi adapter is stable.

### Tool definitions are embedded Pi objects

`ToolProfile.definition` and `ToolProfile.createDefinition` return Pi `ToolDefinition` values. Pibo-generated subagent, yielded-run, goal, runtime, gateway, image, and web-annotation tools also use Pi's definition and schema helpers directly.

This prevents the same tool from being mounted into Codex, Kimi Code, Oh My Pi, Prime Agent, or another runtime without rewriting it.

### Skills are already close to portable

Pibo skills are file-backed `SKILL.md` packages. This is a strong cross-harness foundation because the current external harness ecosystem increasingly supports the same or a compatible Agent Skills layout.

The missing layer is an adapter-specific materializer that can:

- pass explicit skill paths to an embedded runtime
- create an isolated skill directory containing links/copies
- pass a `--skills-dir`-style argument
- populate a runtime-specific home
- fall back to prompt materialization when explicitly allowed

### Context injection currently assumes Pi resource loading

Context files and Pibo runtime metadata are merged into Pi's agent files through `agentsFilesOverride`.

Other harnesses may instead support:

- `AGENTS.md` discovery
- runtime-specific instruction files
- skill/session-start instructions
- a developer/system prompt field
- an initial hidden message
- no safe dynamic context channel at all

Pibo must describe context intent, while the adapter chooses and reports the delivery mechanism.

### Model and auth management are Pi-owned today

The current model catalog and login actions use Pi services and `AuthStorage`. This cannot become the universal model/auth layer.

Each adapter must own or expose:

- model discovery
- authentication status
- optional login flows
- model selection
- reasoning/thinking options
- provider usage information

Pibo should aggregate adapter catalogs instead of imposing the Pi provider registry on every harness.

### Chat Web history directly reads Pi transcripts

`src/apps/chat/trace.ts` and `src/shared/trace-engine.ts` import Pi session types and locate Pi JSONL files directly. Chat Web combines those entries with Pibo events.

This is the largest architectural obstacle after `RoutedSession` because a new runtime would otherwise require its native transcript format to leak into Chat Web.

The target should be:

- normalized Pibo events/materialized messages are the canonical UI history for turns run through Pibo
- the native harness transcript remains the source used by the harness for resume
- an adapter history provider imports/backfills native history when attaching an existing session or migrating old sessions
- Chat Web never locates a harness transcript by naming convention

### Pibo orchestration is mostly reusable

Cron, Loop/Ralph, workflow, project, room, signal, reliability, run, and channel code route through Pibo Session IDs and normalized output events. Most of this can remain unchanged once profile resolution and session creation carry a runtime adapter identity.

Cross-runtime subagents are naturally possible because a Pibo subagent call routes to another Pibo Session. The child profile may select another adapter without changing the parent tool contract.

## Target Vocabulary

The project glossary should eventually distinguish:

- **Agent Harness** — Pi, Codex, Kimi Code, Oh My Pi, Prime Agent, or another engine that owns the model loop and native session.
- **Agent Runtime Adapter** — Pibo plugin that maps one harness/protocol into Pibo runtime contracts.
- **Runtime Session** — one live adapter-owned handle used by a Routed Session.
- **Runtime Session Binding** — persistent link from a Pibo Session to a harness-native session.
- **Runtime Capability** — an optional operation or configuration surface exposed by an adapter.
- **Portable Pibo Capability** — Pibo-owned tool, skill, context file, subagent, or other capability that can be delivered through adapter-specific mechanisms.
- **Code Runtime Tool** — the existing persistent Python/Node `runtime` tool; this name must remain distinct from Agent Runtime.

Recommended code naming should use `agentRuntime` or `runtimeAdapter` to avoid collision with the existing `runtime` tool.

## Target Architecture

```text
Chat / CLI / Cron / Loop / Workflow / Subagent
                    |
                    v
             Pibo Session Router
                    |
                    v
          Generic RoutedSession Queue
                    |
                    v
        AgentRuntimeAdapterRegistry
                    |
        +-----------+------------+-------------+
        |                        |             |
        v                        v             v
   Pi Adapter              Codex Adapter   ACP Adapter Base
   embedded SDK            app-server v2   stdio JSON-RPC
        |                        |             |
        v                        v             v
  Pi native session       Codex thread    Kimi/other ACP session

Portable Pibo tools -----> Direct compiler or session-scoped MCP bridge
Portable skills ---------> Adapter skill materializer
Context files -----------> Adapter instruction materializer
Native events -----------> Adapter event normalizer -> PiboOutputEvent
Native history ----------> Adapter history provider -> Pibo trace/history model
```

## Core Runtime Interfaces

The exact TypeScript shape should be validated in a change spec, but the boundary should resemble the following.

```ts
type AgentRuntimeAdapterDescriptor = {
  id: string;
  displayName: string;
  version?: string;
  transport: "embedded" | "rpc" | "acp" | "process" | "remote";
  capabilities: AgentRuntimeCapabilities;
  configSchema?: PiboJsonObject;
};

type RuntimeSessionBinding = {
  adapterId: string;
  nativeSessionId?: string;
  state: "unbound" | "bound" | "missing" | "error";
  protocol?: string;
  adapterVersion?: string;
  locator?: {
    kind: "local-file" | "local-directory" | "uri" | "remote" | "adapter-resolved";
    value?: string;
  };
  metadata?: PiboJsonObject;
};

type OpenAgentRuntimeInput = {
  piboSession: PiboSession;
  profile: ResolvedPiboAgentProfile;
  binding?: RuntimeSessionBinding;
  workspace: string;
  sessionContext: PiboRuntimeSessionContext;
  portableCapabilities: CompiledPortableCapabilities;
  activeModel?: ModelProfile;
};

interface AgentRuntimeAdapter {
  readonly descriptor: AgentRuntimeAdapterDescriptor;
  validateProfile(input: ValidateRuntimeProfileInput): RuntimeDiagnostic[];
  openSession(input: OpenAgentRuntimeInput): Promise<AgentRuntimeSession>;
  inspectProfile?(input: InspectRuntimeProfileInput): Promise<RuntimeAssemblyInspection>;
  listNativeSessions?(input: ListNativeSessionsInput): Promise<NativeSessionInfo[]>;
  readHistory?(input: ReadRuntimeHistoryInput): Promise<RuntimeHistoryPage>;
  resolveBinding?(input: ResolveRuntimeBindingInput): Promise<RuntimeSessionBinding>;
}

interface AgentRuntimeSession {
  readonly binding: RuntimeSessionBinding;
  readonly capabilities: RuntimeSessionCapabilities;
  readonly cwd: string;

  subscribe(listener: (event: RuntimeSemanticEvent | RuntimeNativeEvent) => void): () => void;
  prompt(input: RuntimePromptInput): Promise<void>;
  steer?(input: RuntimePromptInput): Promise<void>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
  getStatus(): RuntimeStatusSnapshot;

  getModel?(): ModelProfile | undefined;
  setModel?(model: ModelProfile): Promise<ModelProfile>;
  getReasoning?(): RuntimeReasoningState;
  setReasoning?(value: string): Promise<RuntimeReasoningState>;
  compact?(instructions?: string): Promise<RuntimeCompactionResult>;
  fork?(input: RuntimeForkInput): Promise<RuntimeSessionBinding>;
  clone?(): Promise<RuntimeSessionBinding>;
  getTree?(): Promise<RuntimeSessionTree>;
  navigateTree?(input: RuntimeTreeNavigationInput): Promise<RuntimeTreeNavigationResult>;
}
```

Optional methods must be paired with advertised capabilities. Callers must not infer support from adapter identity.

## Capability Model

A capability descriptor should cover at least:

### Session lifecycle

- persistent sessions
- lazy binding
- resume/load
- list/discover native sessions
- close/delete
- native fork
- native tree navigation
- native clone
- attach to externally created session

### Input

- text
- images
- audio/video
- steering while active
- queued follow-up
- structured output
- user elicitation

### Output

- assistant deltas
- final assistant messages
- reasoning deltas
- tool-call argument deltas
- tool progress/results
- token usage
- native plans/todos/diffs
- raw native events

### Configuration

- model selection
- runtime-native reasoning options
- runtime-native modes
- fast/service-tier options
- system/developer instructions
- project instruction files
- skills directories
- client-provided MCP servers
- direct custom tools
- approvals/permissions
- sandbox options

### Maintenance

- compaction
- context usage
- provider usage/rate limits
- runtime health/version
- history read/import

The Agent Designer and execution actions should render or reject based on this descriptor. Silent degradation should be allowed only when a profile explicitly opts into a declared fallback.

## Runtime Registry and Plugin Changes

Extend the plugin API with runtime registration:

```ts
registerRuntimeAdapter(adapter: AgentRuntimeAdapter): void;
```

The capability catalog should include:

- adapter id and display name
- availability/installation state
- version
- transport
- capabilities
- configuration schema
- diagnostics
- supported portable capability delivery modes

The core plugin registers the Pi adapter. Other adapters can live in built-in or separately installed plugins.

Suggested source layout:

```text
src/agent-runtime/
  types.ts
  registry.ts
  capabilities.ts
  routed-session.ts
  profile-compiler.ts
  history.ts
  tool-bridge/

src/agent-runtimes/pi/
  adapter.ts
  runtime.ts
  event-normalizer.ts
  context.ts
  history.ts
  session-operations.ts
  recovery.ts

src/agent-runtimes/acp/
  client.ts
  adapter-base.ts
  event-normalizer.ts

src/agent-runtimes/codex/
  adapter.ts
  app-server-client.ts
  event-normalizer.ts
  context.ts
  history.ts

src/agent-runtimes/kimi-code/
  adapter.ts
  context.ts

src/agent-runtimes/oh-my-pi/
  adapter.ts

src/agent-runtimes/prime-agent/
  adapter.ts
```

Do not split adapters into separate npm packages until the in-repository interface has survived at least the Pi extraction and one external adapter.

## Generic RoutedSession Refactor

Keep in generic `RoutedSession`:

- queueing
- `message_queued`, `message_started`, `message_finished`
- message correlation and provenance
- message preflight
- generic error emission
- action dispatch
- quiescence/disposal coordination
- run-reminder scheduling integration
- capability checks

Move to the Pi adapter/session:

- `normalizePiEvent`
- `SessionManager` operations
- provider-stream fast-mode patches
- Pi continuation compaction patch
- transcript-integrity repair
- Pi context-guard recovery
- Pi provider recovery continuation
- Pi tool activation mutation
- Pi model registry access
- Pi session tree/fork/switch/list behavior

The generic class should subscribe to adapter semantic events. Adapter-native raw events may be forwarded as a generic `runtime_event` only when enabled.

## Event Contract Changes

The existing `PiboOutputEvent` is already close to a runtime-neutral contract. Retain:

- message lifecycle
- assistant text
- reasoning/thinking
- tool call/execution
- usage
- compaction
- session error
- execution result
- subagent links

Change or extend:

- add `runtimeAdapterId` to runtime-originated event metadata where useful
- replace `pi_event` with `runtime_event` containing adapter id and native event
- retain `pi_event` as a deprecated compatibility variant during migration
- normalize adapter errors into the existing Pibo error classes plus optional native metadata
- allow adapter-specific semantic extensions only through namespaced event payloads, not new global assumptions

## Session Persistence Model

### Recommended table

Add a dedicated binding table instead of turning `sessions` into a large adapter-specific record.

```sql
CREATE TABLE session_runtime_bindings (
  pibo_session_id TEXT PRIMARY KEY,
  runtime_adapter_id TEXT NOT NULL,
  native_session_id TEXT,
  binding_state TEXT NOT NULL,
  protocol TEXT,
  adapter_version TEXT,
  locator_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (pibo_session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX session_runtime_binding_native_unique
ON session_runtime_bindings(runtime_adapter_id, native_session_id)
WHERE native_session_id IS NOT NULL;
```

### Semantics

- `PiboSession.id` remains the only product route.
- `runtime_adapter_id` selects the adapter, for example `pi`, `codex`, `kimi-code`, `oh-my-pi`, or `prime-agent`.
- `native_session_id` is opaque to Pibo core.
- `locator_json` is advisory. It may name a file, directory, URI, or tell the adapter to resolve the location.
- Credentials and auth tokens must never be stored in this binding.
- A binding can be `unbound` until the first runtime start.
- If the native session disappears, the binding becomes `missing`; Pibo does not silently create a replacement transcript for an existing product session.
- Rebinding should use compare-and-set or a revision to avoid two gateway instances creating different native sessions concurrently.

### Migration

1. Add the binding table.
2. Backfill every existing session as:
   - adapter: `pi`
   - native session id: existing `pi_session_id`
   - state: `bound`
3. Keep `sessions.pi_session_id` and TypeScript `piSessionId` as deprecated compatibility fields.
4. During the compatibility period, Pi updates write both locations.
5. New non-Pi sessions leave `pi_session_id` null or use no compatibility value.
6. Update read models and APIs to expose a generic `runtimeBinding`.
7. Remove direct Pi-column dependencies only after Chat Web, debug CLI, and migration tooling use the binding table.

Existing Pi session IDs and transcripts must not be rewritten.

## Profile Evolution

### First migration step

Add to `InitialSessionContext`:

```ts
runtimeAdapterId: string; // default "pi"
runtimeOptions?: PiboJsonObject;
```

Keep existing Pi fields temporarily.

### Target profile shape

```ts
type ResolvedPiboAgentProfile = {
  profileName: string;
  runtime: {
    adapterId: string;
    options?: PiboJsonObject;
    nativeToolPolicy?: {
      mode: "default" | "disabled" | "allowlist";
      names?: string[];
    };
    packages?: string[];
  };
  portable: {
    tools: PiboToolSelection[];
    skills: SkillProfile[];
    contextFiles: ContextFileProfile[];
    subagents: SubagentProfile[];
    mcpServers: string[];
  };
  model?: ModelProfile;
  mainModel?: ModelProfile;
  subagentModel?: ModelProfile;
  runtimeConfig?: PiboJsonObject;
};
```

Adapter-native packages and built-in tools must not be presented as universal Pibo capabilities.

### Custom Agent changes

Add durable fields:

- `runtime_adapter_id`
- `runtime_options_json`

Agent Designer changes:

- runtime selector
- adapter availability/doctor status
- runtime-native settings section
- portable tools/skills/context section
- capability compatibility report
- clear unsupported/degraded badges

Changing an agent's runtime affects future sessions. Existing Pibo Sessions keep their stored runtime adapter and binding unless an explicit migration action is added later.

## Portable Tool Architecture

### Canonical tool definition

Replace Pi-owned tool definitions at the Pibo plugin boundary with a runtime-neutral shape based on JSON Schema and Pibo result content.

```ts
type PiboToolDefinition = {
  name: string;
  label?: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  inputSchema: PiboJsonObject;
  executionMode?: "serial" | "parallel";
  annotations?: {
    readOnly?: boolean;
    destructive?: boolean;
    idempotent?: boolean;
    openWorld?: boolean;
  };
  execute(context: PiboToolExecutionContext, args: unknown): Promise<PiboToolResult>;
};
```

### Delivery modes

An adapter may deliver a Pibo tool through:

1. **Direct compiler** — convert to an embedded harness tool definition. Pi uses this path.
2. **Session-scoped MCP bridge** — expose selected Pibo tools to an external harness.
3. **Harness plugin/extension** — only when a richer integration is justified.
4. **Unsupported** — explicit profile validation error or declared degradation.

### MCP bridge

The recommended external-runtime path is a Pibo-owned stdio MCP bridge launched by the harness with a short-lived session capability token.

```text
External harness
  -> starts `pibo runtime-tools serve`
  -> bridge authenticates to local Pibo gateway/control socket
  -> bridge lists only tools selected for one Pibo Session
  -> tool call executes through Pibo-owned controllers
  -> result returns through MCP
```

Security requirements:

- bind token to one Pibo Session, adapter instance, and selected tool set
- short expiration and rotation on runtime recreation
- no raw web-auth cookie reuse
- no cross-session tool discovery
- cancellation propagation
- bounded result payloads with payload-store references for large data

### Important limitation

Pibo cannot generically wrap an external harness's private built-in tools with `pibo_run_start`.

For external runtimes, yielded run control can reliably wrap:

- Pibo-owned MCP tools
- Pibo subagent tools
- the Pibo persistent code runtime tool
- other Pibo-managed tools

Wrapping a harness-native shell/edit tool requires an adapter-specific host-tool API. Profiles and inspection must report this distinction.

## Skills and Context Delivery

### Skills

Keep Pibo's canonical skill format as `SKILL.md` packages.

Adapter delivery may use:

- direct additional skill paths
- generated isolated skill roots containing symlinks/copies
- runtime-specific home directories
- CLI skill-directory flags
- project `.agents/skills` overlays
- explicit prompt fallback when allowed

Pibo should not mutate a user's global Codex/Kimi/OMP home merely to start one session.

Recommended state root:

```text
$PIBO_HOME/agent-runtimes/<adapter-id>/<pibo-session-id>/
```

### Context files

Introduce a compiled context plan with ordered contributions and delivery fidelity:

```ts
type RuntimeContextContribution = {
  id: string;
  sourcePath?: string;
  content: string;
  intent: "system" | "project-instructions" | "session-context" | "skill" | "user-visible";
  required: boolean;
};
```

The adapter reports how each contribution was delivered:

- native system/developer instruction
- project instruction file
- runtime-specific instruction file
- session-start skill
- hidden message
- user-visible bootstrap message
- skipped/unsupported

Do not replace a harness's tuned base prompt with Pibo's Pi base prompt. Preserve the harness-native prompt and inject only the Pibo context needed for product integration.

## MCP Server Selection

Pibo already stores MCP server definitions and profile selections. The runtime adapter should compile selected MCP servers into the harness-native launch/session configuration.

Possible paths:

- pass server definitions through ACP `session/new`/`session/load`
- write an isolated runtime-specific MCP config
- pass app-server/thread configuration
- connect through a Pibo MCP proxy when the harness lacks a required transport

The adapter must report which servers connected and which tools became available. Merely writing configuration is not sufficient verification.

## Model, Auth, and Runtime Options

Introduce an adapter-owned service surface:

```ts
interface AgentRuntimeCatalogService {
  listModels(): Promise<RuntimeModelCatalog>;
  getAuthStatus(): Promise<RuntimeAuthStatus[]>;
  startLogin?(input: RuntimeLoginInput): Promise<RuntimeLoginChallenge>;
  completeLogin?(input: RuntimeLoginCompletion): Promise<RuntimeAuthStatus>;
  setApiKey?(input: RuntimeApiKeyInput): Promise<RuntimeAuthStatus>;
  logout?(input: RuntimeLogoutInput): Promise<void>;
}
```

Pibo aggregates catalogs by adapter.

Changes required:

- session active model remains frozen, but is interpreted by the selected adapter
- API/UI model selectors are scoped to a runtime adapter
- reasoning/thinking values come from adapter option catalogs, not one Pi-derived union
- Pi fast mode becomes an adapter-specific option
- provider usage is optional and adapter-provided

## Trace and History Decoupling

### Target source-of-truth split

- Pibo Session Store: product identity and runtime binding
- Pibo event/message stores: product-visible history and normalized semantic execution
- Harness native session store: model-resume state
- Adapter history provider: import/backfill/debug access

### Required refactor

- Move Pi `SessionEntry` parsing out of `src/shared/` into `src/agent-runtimes/pi/history.ts`.
- Change generic trace builders to consume a Pibo-owned normalized history entry type.
- Persist enough terminal semantic data for every Pibo-routed turn to reconstruct Chat Web without reopening native transcripts.
- Continue using the payload store for large tool results.
- Use native transcript history only for:
  - migration of existing Pi sessions
  - attaching a session created outside Pibo
  - repair/backfill
  - adapter-specific debug inspection

This avoids implementing one Chat Web transcript parser per harness as part of the normal path.

## Gateway Actions

Classify actions into two groups.

### Product-generic

- status
- clear queue
- abort
- dispose
- kill / kill descendants
- Pibo Session identity
- model selection when supported
- runtime configuration when supported

### Runtime-capability-gated

- compact
- native session list/discovery
- native fork
- native clone
- native tree
- native tree navigation
- native session switch/attach
- thinking/reasoning
- fast mode

Existing Pi-specific action names must remain functional for Pi sessions during migration. New generic UI should derive available actions from runtime capabilities.

`session.switch` with a Pi file path must not become a universal session-switch contract.

## Subagents Across Runtimes

Pibo-managed subagents should remain product-level tools.

A parent session can use adapter A while the child target profile uses adapter B:

```text
Pi parent -> Pibo subagent MCP/direct tool -> Codex child Pibo Session
Codex parent -> Pibo subagent MCP tool -> Kimi Code child Pibo Session
```

Rules:

- product hierarchy uses Pibo `parentId`
- child runtime binding is independent
- native parent-session references are passed only when parent and child use the same adapter and the adapter explicitly supports them
- cross-runtime subagent replies return through the existing normalized assistant result
- depth, room, workspace, timeout, signals, and trace linking remain Pibo-owned

This is one of the highest-value outcomes of the adapter architecture.

## Adapter Strategy by Harness

### Pi Coding Agent

**Integration:** embedded SDK

**Role:** default adapter and compatibility baseline

**Recommendation:** move current implementation behind `PiAgentRuntimeAdapter` with behavior-preserving facades such as deprecated `createPiboRuntime()` exports during migration.

Pi remains the richest adapter because Pibo can directly access tools, resource loading, session trees, compaction, transcript repair, model registry, and provider events.

### Codex

**Integration:** Codex app-server v2 JSON-RPC, not terminal scraping

**Why first external adapter:** it is architecturally different from Pi and therefore proves that the Pibo boundary is real. Its app-server exposes threads, turns, streaming items, resume, list, fork, interrupt, approvals, skills, and MCP-related configuration.

**Recommended mapping:**

- Pibo Session binding -> Codex thread id plus optional thread path
- message -> `turn/start`
- steer -> `turn/steer` when supported
- abort -> `turn/interrupt`
- clone/fork -> `thread/fork`
- history -> `thread/read` or adapter import
- Pibo tools -> session-scoped MCP bridge
- approvals -> Pibo UI/action bridge or configured adapter policy

Do not repurpose the existing `codex-compat-openai-web` profile. That profile is Pi with Codex-like behavior. Introduce a distinct canonical profile such as `codex-native`. Keep the existing `codex` alias stable until an explicit migration decision is approved.

### Kimi Code / Kimi K3

Kimi K3 is a model. The harness integration target is Kimi Code.

**Integration:** native ACP over stdio plus adapter-specific launch/materialization

**Recommended mapping:**

- Pibo Session binding -> Kimi session id
- create/load/list/cancel -> ACP capabilities
- tool/reasoning streams -> ACP session updates
- Pibo tools and selected MCP servers -> ACP client-provided MCP servers
- skills -> explicit Kimi skill directories or isolated Kimi runtime home
- runtime-specific model/mode settings -> Kimi config/session options where supported

A Kimi adapter should extend a shared ACP adapter base but remain a named adapter because launch flags, skill handling, data locations, and capability quirks are harness-specific.

### Oh My Pi

**Integration:** prefer its richer JSONL RPC mode for full behavior; use ACP as a baseline/fallback

Oh My Pi is Pi-derived but has its own tools, memory, subagents, extensions, skills, hooks, approval model, and session behavior. Embedding its library directly would reintroduce dependency/version coupling.

A subprocess protocol adapter gives Pibo isolation and allows OMP to own its tuned harness behavior.

### Prime Agent

**Integration:** JSON/RPC plus its daemon/session controls

Prime Agent is also Pi-derived but adds persistent kernels, daemon-backed continuity, scheduling, goals, and RLM/subagent behavior.

Pibo must define overlap policy:

- Pibo remains authoritative for Pibo cron, loops, workflows, and product goals.
- Prime-native schedules/goals/subagents are runtime-native features and should be disabled by default or surfaced as explicitly separate capabilities.
- Pibo must not assume that disposing a terminal attachment stops a daemon-owned Prime session.

Use Prime's RPC/session APIs rather than embedding its package internals.

### Generic ACP

ACP is a useful shared transport but not the Pibo runtime contract.

Use an `AcpRuntimeAdapterBase` for:

- initialize/capability negotiation
- session new/load/list/resume/close
- prompt/cancel
- session updates
- MCP server forwarding
- modes/models/config options where available

Keep harness-specific adapters because ACP does not standardize every requirement Pibo has, including full context placement, skill selection, native transcript location, compaction, branch trees, runtime-specific auth, daemon ownership, and direct custom-tool semantics.

## Migration Roadmap

### Phase 0 — Contract and terminology lock

Deliverables:

- change proposal/spec/design
- glossary additions
- runtime capability matrix
- explicit compatibility policy
- fake adapter contract fixture

Verification:

- no production behavior changes
- every current Pi action classified as generic or Pi-specific

### Phase 1 — Runtime-neutral interfaces and fake adapter

Deliverables:

- `AgentRuntimeAdapterRegistry`
- `AgentRuntimeSession` interface
- generic semantic runtime events
- fake deterministic adapter used by router tests
- router accepts a runtime factory instead of importing `createPiboRuntime`

Verification:

- queue, correlation, disposal, subagent, loop, cron, and signal tests run without Pi through the fake adapter

### Phase 2 — Extract the Pi adapter with zero behavior change

Deliverables:

- move Pi runtime assembly under `src/agent-runtimes/pi/`
- move Pi normalization and recovery out of generic `RoutedSession`
- retain compatibility exports
- default adapter remains `pi`

Verification:

- full existing suite passes
- Pi persisted session reopen is unchanged
- Chat Web default path is visually and behaviorally unchanged
- fork, clone, tree, compaction, steering, run control, context guard, and transcript repair retain focused tests

### Phase 3 — Runtime binding persistence

Deliverables:

- `session_runtime_bindings` schema/store
- backfill existing Pi rows
- lazy unbound-to-bound transition
- generic runtime binding in APIs/read models
- deprecated Pi compatibility fields

Verification:

- old database opens without data loss
- every existing Pi session keeps its Pi session id
- duplicate native session ownership is rejected per adapter
- missing native sessions are reported, not silently replaced

### Phase 4 — Portable profile and capability compiler

Deliverables:

- runtime id on profiles/custom agents
- adapter options schema
- profile validation against adapter capabilities
- runtime selector and compatibility UI
- generic model catalog aggregation

Verification:

- existing profiles default to Pi
- existing sessions do not change runtime after profile edits/default changes
- unsupported selections fail before runtime start

### Phase 5 — Portable tools and MCP bridge

Deliverables:

- `PiboToolDefinition`
- Pi compiler
- session-scoped MCP tool bridge
- conversion of Pibo-owned generated tools
- secure capability tokens

Verification:

- same Pibo tool behavior through Pi direct mode and MCP bridge fixture
- cancellation, progress, errors, image/text content, and large results tested
- cross-session access denied

### Phase 6 — Skills, context, and MCP materialization

Deliverables:

- isolated adapter runtime homes
- skill directory materializers
- ordered context plan and fidelity report
- selected MCP server compilation
- Build Context inspector becomes adapter-aware

Verification:

- selected skill is visible to the runtime and unselected skill is absent
- no mutation of user-global harness configuration
- context contribution delivery is visible in inspection

### Phase 7 — Trace/history decoupling

Deliverables:

- Pibo normalized history type
- generic trace builder
- Pi history provider/importer
- complete semantic event persistence for new turns
- adapter-native history API

Verification:

- a new Pibo-routed Pi session renders correctly without reopening Pi JSONL for the normal trace path
- old Pi sessions still render through migration/import
- missing transcript files do not remove product sessions

### Phase 8 — Codex adapter

Deliverables:

- app-server lifecycle client
- thread binding/start/resume/fork
- turn streaming normalization
- approvals integration
- Pibo MCP tool bridge
- skills/context materialization
- model catalog/auth integration as supported

Verification:

- real Codex binary through the dev gateway and Chat Web
- restart/resume
- tool call, approval, abort, failure, and fork scenarios
- no terminal-output scraping

### Phase 9 — ACP base and Kimi Code adapter

Deliverables:

- ACP client transport
- capability negotiation
- Kimi launcher/materializer
- MCP forwarding and skill directories

Verification:

- real Kimi Code ACP session through dev gateway
- create/load/list/cancel
- tool/reasoning streaming
- persisted session resume

### Phase 10 — Oh My Pi and Prime Agent adapters

Deliverables:

- OMP RPC adapter with ACP fallback where useful
- Prime RPC/daemon adapter
- explicit native-vs-Pibo orchestration policy

Verification:

- long-running detach/reattach semantics
- runtime process/daemon ownership tests
- no accidental duplicate scheduling or subagent ownership

### Phase 11 — Optional package split

Only after at least Pi plus Codex/Kimi are stable:

- consider `@pibo/runtime-pi`, `@pibo/runtime-codex`, etc.
- make external harness binaries optional installs
- retain one built-in adapter registry and discoverable CLI

## Recommended First Implementation Slice

The first implementation PR should not add Codex yet.

It should do only:

1. Add runtime-neutral adapter/session/event interfaces.
2. Add a deterministic fake adapter.
3. Make `PiboSessionRouter` receive/create adapters through a registry.
4. Wrap the current Pi runtime in a `PiAgentRuntimeAdapter` without moving every file initially.
5. Refactor `RoutedSession` to depend on `AgentRuntimeSession` for prompt, events, abort, dispose, status, and optional controls.
6. Preserve every existing public API and database field.
7. Add contract tests proving the router works with both fake and Pi adapters.

This creates the seam with the smallest blast radius. Data migration, generic tools, and trace decoupling should be separate PRs.

## Concrete Code Hotspots

| Area | Current files | Required direction |
|---|---|---|
| Runtime creation | `src/core/runtime.ts` | Pi adapter implementation plus generic facade |
| Routed queue | `src/core/routed-session.ts` | Split generic queue from Pi runtime handle |
| Runtime selection | `src/core/session-router.ts` | Resolve adapter from stored session/profile |
| Profile model | `src/core/profiles.ts` | Add adapter id/options; later split portable/native config |
| Plugin registry | `src/plugins/types.ts`, `src/plugins/registry.ts` | Register/discover runtime adapters |
| Session store | `src/sessions/*`, `src/data/schema.ts` | Runtime binding table and compatibility migration |
| Tools | `src/subagents/tool.ts`, `src/runs/tools.ts`, `src/loops/tools.ts`, `src/tools/**` | Generic tool IR plus Pi/MCP compilers |
| Context inspection | `src/core/context-build.ts` | Adapter assembly inspection and delivery fidelity |
| Model/auth | `src/apps/chat/model-catalog.ts`, `src/auth/login-actions.ts` | Adapter-owned catalogs and auth services |
| Trace | `src/apps/chat/trace.ts`, `src/shared/trace-*` | Generic history plus Pi history provider |
| Custom Agents | `src/apps/chat/agent-store.ts`, `agent-profiles.ts`, Agents UI | Runtime selection and adapter options |
| Gateway actions | `src/plugins/builtin.ts`, `src/plugins/types.ts` | Generic vs capability-gated controls |
| Debug CLI | `src/debug/session.ts`, `src/debug/trace.ts` | Resolve binding and invoke adapter history/debug services |
| CLI/TUI | `src/local/*`, `src/cli.ts` | Pi TUI remains Pi adapter; generic routed clients stay event-based |

## Tests and Acceptance Gates

### Runtime adapter contract suite

Every adapter should be tested for advertised capabilities:

- create or bind session
- resume after adapter/client recreation
- prompt acceptance
- assistant streaming and final response
- reasoning stream when advertised
- tool lifecycle when advertised
- usage when advertised
- abort
- disposal
- missing native session
- native process crash
- malformed native event
- model/reasoning changes when advertised
- history read/import when advertised
- fork/clone/tree when advertised

### Pi parity gate

Before merging the Pi extraction:

- all existing tests pass
- no database migration is required
- current profile output is unchanged
- current context build is unchanged
- current Chat Web trace is unchanged
- direct TUI and routed TUI still work
- existing persisted Pi sessions reopen unchanged

### External adapter gate

An external adapter is not complete with protocol fixture tests alone. It must be validated through:

- the exact installed harness binary/version
- the real development gateway
- authenticated Chat Web
- persisted restart/resume
- one Pibo tool through the MCP bridge
- one selected skill
- one selected context file
- one failure/abort path
- one long-running or queued path

## Main Risks

### False abstraction

Risk: introducing `RuntimeAdapter` while Pi types remain in profiles, tools, traces, and actions.

Mitigation: track forbidden imports. Generic runtime/session/trace directories should not import `@earendil-works/pi-*`.

### Lowest-common-denominator design

Risk: forcing all harnesses into only what ACP supports.

Mitigation: capability-based Pibo SPI with optional adapter extensions. ACP is one transport implementation.

### Prompt damage

Risk: replacing a harness's tuned prompt with Pibo's Pi prompt and reducing model quality.

Mitigation: adapter-specific context slots; preserve native base prompts; inspect delivery fidelity.

### Tool mismatch

Risk: claiming Pibo run control can wrap every harness-native tool.

Mitigation: distinguish Pibo-managed tools from harness-native tools and report yieldability per delivery path.

### Duplicate sources of truth

Risk: treating both Pibo event history and harness transcripts as equal mutable sources.

Mitigation: product history is Pibo-normalized; native transcript is resume state plus import source.

### Runtime home contamination

Risk: writing selected skills/MCP/context into global Codex/Kimi/OMP configuration.

Mitigation: isolated adapter homes and generated per-session/per-profile overlays.

### Existing profile alias breakage

Risk: changing `codex` from the Pi compatibility profile to native Codex.

Mitigation: add `codex-native`; keep current alias stable until explicit migration.

### Daemon ownership conflicts

Risk: Pibo disposes a client connection while Prime/another harness continues work, or both Pibo and harness schedule the same work.

Mitigation: adapter lifecycle descriptors and explicit ownership policy.

### Schema migration complexity

Risk: breaking old Pi session reads while adding nullable external bindings.

Mitigation: additive table, backfill, dual-read/dual-write compatibility, later cleanup.

## Decisions Recommended Now

1. Approve Pibo as a multi-harness orchestrator rather than a permanent Pi wrapper.
2. Define Pibo's own runtime SPI; do not make ACP the core abstraction.
3. Keep Pibo Session identity and product data authoritative.
4. Let each harness own its native session/transcript.
5. Store opaque runtime bindings in a separate table.
6. Preserve Pi as the default adapter and extract it first.
7. Use a portable Pibo tool IR plus a session-scoped MCP bridge.
8. Preserve canonical `SKILL.md` skills and materialize them per adapter.
9. Decouple normal Chat Web history from direct transcript reads before adding several adapters.
10. Implement Codex first after the seam exists, then ACP/Kimi, then OMP/Prime.
11. Keep the existing Pi Codex-compatible profile distinct from a future native Codex runtime.
12. Require real dev-gateway validation for each adapter.

## Open Questions for the Change Spec

- Should runtime selection live only on profiles, or may a new session override its profile's default adapter?
- Should Pibo support attaching existing harness sessions in the first release or only sessions created by Pibo?
- Which Pibo tools are mandatory across adapters, and which are optional?
- Is prompt fallback acceptable for required context files, or should unsupported context injection block runtime start?
- Should Pibo expose harness-native subagents in the Agent Designer, or only Pibo-managed subagents initially?
- How should approval requests be represented in the normalized Pibo event/API model?
- Should the first MCP bridge be stdio-only, or should a loopback HTTP transport also be supported?
- How many releases must deprecated `piSessionId` API fields remain?
- Should runtime binaries be managed by Pibo, discovered from PATH, or both?
- What exact compatibility commitment applies when a runtime adapter's upstream protocol changes?

## External Reconnaissance Notes

Checked on 2026-08-14 against the upstream projects:

- OpenAI Codex exposes a TypeScript SDK and a richer app-server v2 JSON-RPC protocol with persistent threads, turns, streaming events, resume/list/fork, approvals, skills, and protocol schema generation.
- Kimi K3 is the model; Kimi Code is the recommended harness. Kimi Code exposes ACP, persistent sessions, MCP configuration, skills, plugins, and subagents.
- Oh My Pi exposes both ACP and a richer JSONL RPC mode, plus skills, MCP, extensions, hooks, native session operations, and subagents.
- Prime Agent is Pi-derived and exposes JSON/RPC modes plus daemon-backed session continuity, persistent kernels, goals, schedules, and subagents.
- ACP now provides a useful multi-agent client protocol with session lifecycle and capability negotiation, but it does not cover every Pibo-specific integration requirement.

These observations support the adapter strategy but must not be treated as stable contracts. Each adapter should pin and test an upstream protocol/version range.
