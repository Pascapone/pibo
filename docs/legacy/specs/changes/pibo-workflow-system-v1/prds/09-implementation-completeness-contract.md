# PRD: Pibo Workflow System V1 — Implementation Completeness Contract

**Status:** Draft  
**Created:** 2026-05-10  
**Purpose:** Second-pass completeness PRD for implementation agents.  
**Related docs:** all source docs in `../`, all PRDs in this directory.

## 1. Executive Summary

- **Problem Statement**: The workflow feature spans authoring, registry, validation, graph compilation, durable runtime, node execution, human actions, CLI/UI, XState projection, and testing. If implementation agents receive only high-level PRDs, they may miss cross-cutting contracts that live across several design docs.
- **Proposed Solution**: Treat this PRD as the implementation completeness contract. It consolidates every mandatory source-doc requirement into one agent-ready checklist and defines the minimum implementation surface, validation rules, runtime records, CLI/UI behavior, tests, non-goals, and traceability needed to deliver the complete V1 feature.
- **Success Criteria**:
  - SC-01: Every requirement in `../spec.md` maps to at least one PRD and at least one concrete validation or implementation checklist item in this file.
  - SC-02: Every task group in `../tasks.md` maps to an implementation area and a pass/fail validation gate.
  - SC-03: An implementation agent can start from these PRDs and identify package layout, public APIs, IR shapes, node kinds, store records, runtime statuses, commands, UI/CLI surfaces, tests, and deferred items without reading the original design docs.
  - SC-04: A reviewer can reject an implementation when any checklist item marked MUST is missing.
  - SC-05: The V1 implementation passes typecheck, workflow unit tests, persistence/restart tests, projection snapshot tests, and three manual flows: one-node `pibo-agent`, adapter composition, and bounded review/fix loop.

## 2. User Experience & Functionality

- **User Personas**:
  - Implementation agent that receives PRDs as its only source of truth.
  - Reviewer verifying feature completeness against source requirements.
  - Runtime developer implementing kernel/store/executors.
  - Framework developer implementing authoring API/registry/validation.
  - Full-stack developer implementing CLI/debug, Projects UI, human actions, and Workflow/XState tab.

- **User Stories**:
  - As an implementation agent, I want one consolidated completeness contract so that I do not miss behavior hidden in design details.
  - As a reviewer, I want requirement/task traceability so that I can prove V1 coverage before merge.
  - As a developer, I want exact MUST/SHOULD/MUST NOT rules so that ambiguous design choices do not block implementation.
  - As a QA engineer, I want pass/fail gates for every major capability so that acceptance is repeatable.

- **Acceptance Criteria**:
  - The implementation includes all V1 node kinds: `agent`, `code`, `workflow`, `adapter`, and `human`.
  - The implementation includes all V1 workflow surfaces: TypeScript authoring API, Workflow Registry, validation, graph store/compiler, runtime kernel, workflow store, node executors, CLI/debug, Project UI human actions, Workflow/XState visualization tab, event/inspection projections, and tests.
  - The implementation includes all V1 contracts: text/JSON ports, Structured Outputs/tool-calling JSON Schema subset, typed edges, explicit adapters, global/local/edge state separation, merge policies, guards, joins, bounded loops, retries, durable waits, leases, wakeups, checkpoints, and XState projection.
  - The implementation excludes all V1 non-goals listed in this PRD unless a later approved change updates scope.

- **Non-Goals**:
  - Do not implement a full visual workflow editor in V1.
  - Do not add workflow YAML/JSON file import/export as a product feature in V1.
  - Do not add arbitrary inline TypeScript, shell, or script nodes as first-class V1 primitives.
  - Do not add hidden LLM/agent-assisted schema coercion.
  - Do not treat XState machines or snapshots as canonical durable truth.
  - Do not build marketplace/package discovery, cross-user sharing, or a new permission model in V1.
  - Do not move normal Pibo/Pi session traces, spans, transcripts, tool calls, or session records into `pibo-workflows.sqlite`.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Pibo Runtime/session routing for Agent nodes.
  - Agent Designer profile registry with fixed profile refs such as `pibo-agent`.
  - Existing tool, skill, context, auth, owner-scope, Project Session, compute-worker, trace/event, CLI, and Chat Web systems.
  - OpenAI Structured Outputs / tool-calling JSON Schema subset validator for workflow/node/adapter inputs and outputs.
  - `xstate` dependency for projection, visualization, inspection, simulation, and local orchestration support.

- **Evaluation Strategy**:
  - **Definition validation evals**: accept valid fixtures and reject malformed definitions with structured diagnostics.
  - **AI-output validation evals**: every schema-bound Agent output either validates against its declared output port or fails before workflow completion/downstream transfer.
  - **Composition evals**: direct compatible edges pass; incompatible edges require explicit registered adapters.
  - **Persistence evals**: completed, failed, waiting, resumed, retry-scheduled, cancelled, nested-child-failed, stale-lease-reclaimed, and restart-after-boundary cases pass.
  - **UI/CLI evals**: the same persisted run/wait token can be inspected and controlled through CLI/debug and Projects UI.
  - **Projection evals**: deterministic XState snapshots are stable for representative fixtures and can be reconstructed from kernel records without persisted XState snapshots.

## 4. Technical Specifications

### 4.1 Package and Module Contract

The implementation MUST create `packages/workflows` with these internal submodules or direct equivalents:

| Module | Required responsibility |
|---|---|
| `src/api` | Public authoring helpers, builder API, object definition normalization. |
| `src/registry` | Workflow Registry, plugin registration, handler/adapter/guard/prompt/human-action lookup. |
| `src/types` | Workflow IR, runtime, store, diagnostics, events, utility types. |
| `src/validation` | Definition, schema, graph, registry-ref, capability, state, and loop validation. |
| `src/graph` | Graph store, traversal, successor/predecessor indices, cycle/toposort validation, serialization. |
| `src/compiler` | Validated definition to execution plan, loop/join metadata, checkpoint namespace metadata, projection metadata. |
| `src/runtime` | Durable kernel, scheduling, attempts, retries, waits, leases, commands, cancellation. |
| `src/store` | `pibo-workflows.sqlite` schema/store and persistence API. |
| `src/xstate` | XState projection, snapshot projection, inspection helpers. |
| `src/fixtures` | Required workflow fixtures for tests/manual validation. |
| `src/testing` | Test harnesses, fake registry/providers, persistence/restart helpers. |

### 4.2 Public Authoring API Contract

The public API MUST expose these functions or equivalent names in the project’s CLI/code style:

```ts
setupWorkflow(options: WorkflowSetupOptions): WorkflowSetup;
workflow(id: string): WorkflowBuilder;
defineWorkflow(id: string, definition: WorkflowDefinitionInput): WorkflowDefinition;
provideWorkflow(definition: WorkflowDefinition, providers: WorkflowProviders): ProvidedWorkflow;
registerWorkflow(definition: WorkflowDefinition, options?: WorkflowRegistrationOptions): WorkflowRegistration;
registerWorkflowHandler(id: string, handler: CodeNodeHandler<any, any>): void;
registerWorkflowAdapter(id: string, adapter: AdapterHandler<any, any>): void;
registerWorkflowGuard(id: string, guard: GuardHandler): void;
registerWorkflowHumanAction(action: WorkflowHumanActionDefinition): void;
registerPluginWorkflows(pluginId: string, register: (registry: WorkflowRegistry) => void): void;
text(description?: string): WorkflowPort;
json(schema: JsonSchema, description?: string): WorkflowPort;
template(value: string): PromptTemplate;
fixedProfile(id: string): AgentProfileSelection;
validateWorkflow(definition: WorkflowDefinition): ValidationResult;
compileWorkflow(definition: WorkflowDefinition): CompileResult;
serializeWorkflowForDebug(definition: WorkflowDefinition): JsonWorkflowDefinition;
projectToXState(definition: WorkflowDefinition): XStateMachineConfig;
resolveWorkflowDefinition(id: string, version?: string): WorkflowDefinition;
```

The API SHOULD expose utility types tied to ports:

```ts
type WorkflowInputFrom<TWorkflow extends { input: WorkflowPort }> = InferPortValue<TWorkflow["input"]>;
type WorkflowOutputFrom<TWorkflow extends { output: WorkflowPort }> = InferPortValue<TWorkflow["output"]>;
type NodeInputFrom<TNode extends { input?: WorkflowPort }> = InferPortValue<TNode["input"]>;
type NodeOutputFrom<TNode extends { output?: WorkflowPort }> = InferPortValue<TNode["output"]>;
type WorkflowSnapshotFrom<TWorkflow> = WorkflowMachineSnapshot<WorkflowInputFrom<TWorkflow>, WorkflowOutputFrom<TWorkflow>>;
```

### 4.3 Canonical Workflow IR Contract

The canonical IR MUST be JSON-serializable for validation, compilation, debugging, run snapshots, and XState projection. It MUST NOT be marketed as file import/export product support in V1.

Minimum definition shape:

```ts
type WorkflowDefinition = {
  id: string;
  version: string;
  name?: string;
  description?: string;
  input: WorkflowPort;
  output: WorkflowPort;
  nodes: Record<NodeId, WorkflowNodeDefinition>;
  edges: Record<EdgeId, WorkflowEdgeDefinition>;
  initial?: NodeId | NodeId[];
  final?: WorkflowFinalSpec;
  state?: WorkflowStateDefinition;
  retry?: RetryPolicyRef;
  ui?: WorkflowUiMetadata;
  metadata?: {
    useWhen?: string;
    notFor?: string;
    examples?: string[];
    tags?: string[];
    routingHints?: Record<string, unknown>;
    promptAssetRefs?: string[];
    migration?: WorkflowMigrationMetadata;
  };
};
```

Final/completion semantics MUST be explicit:

- `initial` or builder `startAt(...)` defines one or more entry nodes.
- `final` or builder `doneFrom(...)` defines terminal node(s) or output mapping.
- A terminal node's output becomes the workflow output unless a final output mapper is declared.
- Multi-initial workflows require deterministic join/final behavior before the workflow can complete.
- A workflow MUST validate final output against the workflow output port before marking the run completed.

V1 ports:

```ts
type WorkflowPort =
  | { kind: "text"; description?: string }
  | { kind: "json"; schema: JsonSchema; description?: string };
```

V1 node kinds:

```ts
type WorkflowNodeDefinition =
  | AgentNodeDefinition
  | TypeScriptCodeNodeDefinition
  | NestedWorkflowNodeDefinition
  | AdapterNodeDefinition
  | HumanNodeDefinition;
```

Agent node MUST include `kind: "agent"`, `runtime: "pibo"`, and fixed profile selection in V1:

```ts
type AgentProfileSelection = { kind: "fixed"; id: string };
type AgentNodeDefinition = BaseNodeDefinition & {
  kind: "agent";
  runtime: "pibo";
  profile: AgentProfileSelection;
  tools?: ToolSelectionPolicy;
  skills?: SkillSelectionPolicy;
  context?: ContextSelectionPolicy;
  routing?: SessionRoutingPolicy;
  promptTemplate?: string;
  promptBuilder?: PromptBuilderRef;
  session?: SessionInheritancePolicy;
};
type AdapterRef = string;
```

Base node fields MUST support:

```ts
type BaseNodeDefinition = {
  label?: string;
  input?: WorkflowPort;
  output?: WorkflowPort;
  reads?: StatePath[];
  writes?: StatePath[];
};
```

Other V1 node definitions MUST include:

```ts
type TypeScriptCodeNodeDefinition = BaseNodeDefinition & {
  kind: "code";
  language: "typescript";
  handler: string;
};

type NestedWorkflowNodeDefinition = BaseNodeDefinition & {
  kind: "workflow";
  workflowId: string;
  workflowVersion?: string;
  namespace?: string;
};

type AdapterNodeDefinition = BaseNodeDefinition & {
  kind: "adapter";
  handler: AdapterRef;
  mode: "deterministic";
};

type HumanNodeDefinition = BaseNodeDefinition & {
  kind: "human";
  prompt: string;
  schema?: JsonSchema;
  timeout?: DurationSpec;
};
```

Object-first definitions and builder definitions are both required authoring styles. Prompt-heavy Agent nodes SHOULD reference prompt assets instead of embedding long prompts. TypeScript code node MUST reference a registered handler. Nested workflow node MUST reference a known workflow id/version when statically resolvable. Adapter node MUST reference a registered adapter. Human node MUST create durable wait tokens.

Edges MUST identify source/target refs and MAY include kind, event, condition/guard, join, map, adapter, state mapping, and UI metadata:

```ts
type WorkflowEdgeDefinition = {
  id: EdgeId;
  from: NodePortRef;
  to: NodePortRef;
  kind?: "data" | "control" | "error" | "resume";
  event?: string;
  condition?: GuardRef;
  guard?: GuardRef;
  join?: JoinPolicy;
  map?: EdgeMap;
  adapter?: EdgeAdapterDefinition;
  state?: EdgeStateMapping;
  ui?: EdgeUiMetadata;
};
```

Edge adapters MUST use the V1 registered TypeScript adapter shape:

```ts
type EdgeAdapterDefinition = {
  kind: "edgeAdapter";
  output: WorkflowPort;
  transform: AdapterRef;
};
```

`sourceOutputAdapter`, `targetInputAdapter`, declarative mapping DSLs, and hidden agent-assisted adapters remain deferred.

Edge semantics MUST be testable:

- `data` edges transfer validated source output or mapped/adapted payload into target input.
- `control` edges route execution without implying a data-shape transformation unless a map/adapter is declared.
- `error` edges route recoverable node/adapter/output failures to declared recovery nodes.
- `resume` edges route durable human/external resume events.
- Edge maps are explicit and persisted as part of transfer metadata when they alter payload shape.
- Multiple matching outgoing guarded edges MUST use explicit priority/order or fail validation as ambiguous.

V1 join policies MUST include:

```ts
type JoinPolicy = "all_success" | "one_success" | "none_failed_min_one_success" | "all_done";
```

Join decisions MUST be computed from persisted upstream attempt statuses. Skipped upstream nodes MUST be interpreted according to the selected join policy, not ad hoc executor logic. Join decisions that affect routing MUST emit workflow events or structured diagnostics.

V1 merge policies MUST include:

```ts
type MergePolicy =
  | { kind: "replace" }
  | { kind: "append" }
  | { kind: "shallowMerge" }
  | { kind: "custom"; handler: string };
```

Retry policies MAY be declared at workflow, node, or adapter level.

```ts
type RetryPolicy = {
  maxAttempts: number;
  backoff: BackoffPolicy;
  retryOn?: string[];
};
```

Retry policy inheritance order MUST be node/adapter policy, then workflow policy, then system default. Retry decisions MUST consider `retryOn` when present.

### 4.4 Workflow Registry Contract

The Workflow Registry MUST register and resolve:

- workflow definitions
- TypeScript code handlers
- registered TypeScript adapter handlers
- guard handlers
- prompt builders
- prompt assets
- human action definitions
- routing hints
- runtime capability declarations
- state merge/reducer handlers for custom merge policies
- plugin-provided workflow capabilities

Rules:

- Workflow runs start from registry-resolved workflow id and version.
- IR stores refs/ids, not inline closures.
- Plugins can register entries through `registerPluginWorkflows`.
- Missing statically resolvable refs fail validation before execution.
- The runtime DB stores workflow id, version, definition hash, optional compiled snapshot, and runtime facts; TypeScript source remains in code/registry.

### 4.5 Validation Contract

Validation MUST return structured diagnostics rather than only throwing:

```ts
type WorkflowDiagnostic = {
  code: string;
  message: string;
  path?: string;
  nodeId?: NodeId;
  edgeId?: EdgeId;
  severity: "error" | "warning";
  hint?: string;
};
```

Error families MUST include definition, graph, interface, execution, retry-exhausted, adapter, and node-executor errors. Concrete error classes or codes SHOULD include `WorkflowDefinitionError`, `WorkflowGraphError`, `WorkflowInterfaceError`, `WorkflowExecutionError`, `WorkflowRetryExhaustedError`, `WorkflowAdapterError`, and `WorkflowNodeExecutorError`.

The validator MUST reject:

- duplicate node ids or malformed ids
- missing node ids referenced by `initial`, `final`, edges, commands, or UI metadata when statically resolvable
- edges that reference missing source/target nodes or ports
- text input supplied to JSON ports or JSON input supplied to text ports
- malformed JSON input or output for schema-bound ports
- JSON schemas outside the V1 Structured Outputs/tool-calling subset
- object schemas missing `additionalProperties: false`
- structured object schemas where not all fields are listed in `required`
- root `anyOf` for structured outputs
- incompatible direct edges without explicit registered adapter
- adapter output incompatible with target input
- adapter refs that do not resolve to registered TypeScript adapters
- code nodes without registered handlers
- guard refs that do not resolve when statically known
- prompt/template references to unknown fields when provably invalid
- Agent nodes without resolvable fixed profile selection
- requested tools/skills/context unavailable to the selected profile when statically known
- nested workflow refs that do not resolve when statically known
- invalid join policies or ambiguous fan-in semantics that cannot use default `all_success`
- multiple matching outgoing guards without explicit priority/order
- undeclared state writes in code/adapter/prompt-builder behavior when statically or runtime detectable
- concurrent writes to the same global path without merge policy
- custom merge policy handlers that do not resolve to registered deterministic handlers
- cycles without explicit loop policy, wait state, guard, or max-iteration/max-attempt rule
- unbounded back-edges

### 4.6 Graph Store and Compiler Contract

The graph store MUST provide stable node ids, stable edge ids, redundant indices for fast reads, deterministic serialization, and graph mutation utilities. Graph store mutations SHOULD produce event/debug payloads for validation, deterministic tests, and future UI projection. It SHOULD expose this API family or equivalent:

```ts
interface WorkflowGraphStore {
  hasNode(id: NodeId): boolean;
  getNode(id: NodeId): WorkflowNodeDefinition;
  setNode(id: NodeId, node: WorkflowNodeDefinition): void;
  updateNode(id: NodeId, update: NodeUpdate): void;
  dropNode(id: NodeId): void;
  hasEdge(id: EdgeId): boolean;
  getEdge(id: EdgeId): WorkflowEdgeDefinition;
  setEdge(id: EdgeId, edge: WorkflowEdgeDefinition): void;
  updateEdge(id: EdgeId, update: EdgeUpdate): void;
  dropEdge(id: EdgeId): void;
  successors(id: NodeId): NodeId[];
  predecessors(id: NodeId): NodeId[];
  inEdges(id: NodeId): WorkflowEdgeDefinition[];
  outEdges(id: NodeId): WorkflowEdgeDefinition[];
  export(): WorkflowDefinition;
  copy(): WorkflowGraphStore;
  project(filter: WorkflowGraphFilter): WorkflowGraphStore;
}
```

The compiler MUST produce an execution plan with normalized nodes/edges, initial nodes, terminal nodes, loop metadata, join metadata, state policy, runnable queue seeds, checkpoint namespace metadata, and deterministic XState projection metadata.

```ts
type WorkflowExecutionPlan = {
  definitionId: string;
  definitionVersion: string;
  nodes: Record<NodeId, CompiledNode>;
  edges: Record<EdgeId, CompiledEdge>;
  initialNodeIds: NodeId[];
  terminalNodeIds: NodeId[];
  loops: CompiledLoopPolicy[];
  joins: CompiledJoinPolicy[];
  state: CompiledStatePolicy;
  queueSeeds: CompiledRunnableSeed[];
  checkpointNamespaces: Record<string, string>;
  xstateProjection: XStateLikeMachine;
};
```

### 4.7 Runtime Kernel Contract

The runtime MUST execute only compiled plans. It MUST persist at boundaries: workflow start, node attempt start, node attempt result, edge transfer, wait, retry scheduling, failure, cancellation, checkpoint, and completion.

Workflow run statuses MUST include:

```ts
type WorkflowRunStatus = "pending" | "running" | "waiting" | "failed" | "completed" | "cancelled";
```

Node attempt statuses MUST include:

```ts
type NodeAttemptStatus =
  | "pending"
  | "leased"
  | "running"
  | "waiting"
  | "retry_scheduled"
  | "failed"
  | "completed"
  | "skipped"
  | "cancelled";
```

If the persistence implementation chooses not to create attempts for skipped nodes, skipped state MUST still be represented in workflow events and UI/projection snapshots so join policies can reason about skipped upstream nodes.

The execution loop MUST perform this sequence or equivalent transactional boundaries:

```text
claim runnable workflow run
  -> load compiled plan
  -> load checkpoint/state
  -> find runnable node attempts
  -> lease node attempt
  -> execute node through executor
  -> validate output
  -> persist result
  -> apply state writes
  -> evaluate outgoing edges
  -> create edge transfers
  -> enqueue target node attempts
  -> checkpoint
  -> emit events
```

A node is runnable only when input is available, incoming dependencies are satisfied, guards allow execution, loop policy permits another iteration, `availableAt` is due, and no active lease is owned by another worker. Guards used for durable routing MUST be deterministic when possible. Non-deterministic guards MUST declare that they are runtime-only. Guard results that affect durable routing MUST be persisted. Guard failures MUST produce structured diagnostics.

Retry decisions MUST be deterministic over policy, attempt, error, and time. Backoff policies MUST include fixed, linear, exponential, and none or accepted equivalents.

Leases MUST prevent duplicate active ownership.

```ts
type WorkflowLease = {
  leaseId: string;
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
};
```

Long-running attempts SHOULD heartbeat and store heartbeats. Expired leases MUST be reclaimable. Node attempts MUST use deterministic idempotency keys derived from run id, namespace/path, node id, attempt number, and loop iteration where applicable.

### 4.8 Workflow Store Contract

The implementation MUST use a fresh workflow-specific SQLite database named `pibo-workflows.sqlite` or an equivalent store configured to the same logical schema. It MUST store workflow execution facts only.

Required logical tables/records:

| Table | Required fields |
|---|---|
| `workflow_definition_snapshots` | `id`, `workflow_id`, `workflow_version`, `definition_hash`, `compiled_definition_json`, `created_at` |
| `workflow_runs` | `id`, `workflow_id`, `workflow_version`, `workflow_definition_hash`, `definition_snapshot_id`, `owner_scope`, `parent_run_id`, `parent_node_attempt_id` / `parentNodeAttemptId`, `pibo_session_id`, `project_id`, `environment_json`, `status`, `input_json`, `output_json`, `state_json`, `current_json`, `created_at`, `updated_at`, `completed_at`, `failed_at` |
| `workflow_events` | `id`, `workflow_run_id`, `type`, `node_id`, `edge_id`, `attempt_id`, `payload_json`, `created_at` |
| `workflow_node_attempts` | `id`, `workflow_run_id`, `node_id`, `attempt_number`, `kind`, `status`, `environment_json`, `input_json`, `output_json`, `local_state_json`, `error_json`, `lease_json`, `available_at`, `started_at`, `heartbeat_at`, `completed_at`, `failed_at` |
| `workflow_edge_transfers` | `id`, `workflow_run_id`, `edge_id`, `source_node_attempt_id`, `target_node_id`, `payload_json`, `adapter_attempt_id`, `status`, `created_at` |
| `workflow_checkpoints` | `id`, `workflow_run_id`, `namespace`, `cursor_json`, `state_json`, `pending_json`, `created_at` |
| `workflow_wakeups` | `id`, `workflow_run_id`, `node_attempt_id`, `kind`, `available_at`, `correlation_id`, `payload_json`, `created_at` |
| `workflow_wait_tokens` | `id`, `workflow_run_id`, `node_attempt_id`, `kind`, `available_actions_json`, `schema_json`, `status`, `resume_payload_json`, `expires_at`, `created_at`, `resolved_at` |
| `workflow_human_actions` | `id`, `workflow_run_id`, `wait_token_id`, `kind`, `actor_json`, `payload_json`, `created_at` |

### 4.9 Node Executor Contract

Executors MUST share the node attempt model and MUST validate input/output at boundaries.

Agent executor MUST:

- resolve fixed Agent Designer profile
- inherit/narrow/extend tools, skills, context, and routing according to allowed policy
- create or attach to a child Pibo Session through normal Pibo session routing
- build final prompt from `promptTemplate`, `promptBuilder`, or prompt asset
- send prompt/input to Pibo Runtime
- collect text or structured output
- validate output port
- record `piboSessionId`, optional `piSessionId` when available, trace links, effective profile, effective tools, effective skills, effective context, and routing metadata
- support cancellation and timeout where Pibo Runtime allows

Code executor MUST:

- load registered TypeScript handler by id
- provide scoped context readers/writers for input, global state, local state, edge payload, event emit, and command emit
- enforce declared reads/writes
- validate output and patches
- reject undeclared state writes

Nested workflow executor MUST:

- resolve child workflow id/version
- create child workflow run and checkpoint namespace
- pass input through child input port
- wait for child completion/failure
- map child output to parent node output
- link parent/child run ids and events
- keep child global/local state isolated unless explicit export is configured

Adapter executor MUST:

- resolve registered TypeScript adapter
- validate source payload
- run deterministic transform
- validate adapter output against declared output and target input
- persist adapter attempt and errors

Human executor MUST:

- create durable wait token before returning control
- expose available actions
- validate resume/action payloads
- support wait token statuses for pending/open, resolved, expired, and cancelled states or accepted equivalents
- record approval, rejection, resume, timeout, or cancellation
- return a result that distinguishes `approved`, `rejected`, `submitted`, and `timed_out` decisions when applicable
- route success, rejection, timeout, cancellation, or invalid resume through declared normal/error/resume edges when present
- continue, route, fail, or cancel according to action and workflow definition

### 4.10 Command, Wait, Wakeup, and Human Action Contract

Executors MAY return commands. Commands MUST be persisted before application.

Command execution rules:

- `goto` MUST target an allowed node unless the workflow/node declares explicit dynamic routing permission.
- `update` MUST obey declared state write paths and merge policies.
- `resume` MUST validate the incoming value before continuing.
- `requestHumanInput` MUST create a durable wait token and move the run or node to waiting.
- `emitArtifact` MUST either persist an artifact reference or be explicitly deferred; it MUST NOT disappear silently.
- `complete` MUST validate workflow output before completion.
- `fail` MUST persist structured error details.
- `handoff` MUST target a known node or workflow id unless dynamic handoff is explicitly permitted.

```ts
type WorkflowCommand =
  | { kind: "goto"; nodeId: NodeId; payload?: WorkflowValue }
  | { kind: "update"; patch: StatePatch }
  | { kind: "resume"; value?: WorkflowValue }
  | { kind: "requestHumanInput"; prompt: string; schema?: JsonSchema }
  | { kind: "emitArtifact"; artifact: WorkflowArtifact }
  | { kind: "cancel"; reason?: string }
  | { kind: "complete"; output?: WorkflowValue }
  | { kind: "fail"; error: WorkflowErrorSummary }
  | { kind: "handoff"; target: NodeId | WorkflowId; payload?: WorkflowValue };
```

Wait kinds MUST include human input, child workflow completion, timeout, external signal, scheduled retry, and Pibo Runtime response or accepted equivalents.

Human actions MUST include built-ins `approve`, `reject`, `resume`, and `cancel`. Custom actions MUST be registered through the Workflow Registry. Human approval schemas such as an `ApprovalSchema` are normal JSON-port schemas and MUST be validated before resume. Wakeups MUST store kind, availability time when relevant, `correlationId` / correlation id, payload, and run/attempt linkage so resume/retry/timeout/child/runtime events survive restart.

### 4.11 CLI and UI Contract

CLI/debug MUST expose workflow commands equivalent to:

- `list`
- `validate`
- `run`
- `inspect`
- `approve`
- `reject`
- `resume`
- `cancel`

V1 MUST NOT add an XState CLI command. In short: No XState CLI in V1.

Project UI MUST show:

- workflow-backed sessions/runs
- workflow id/version/status
- current workflow state/current node(s)
- node status list
- final output where permitted
- validation errors and structured diagnostics
- waiting reason and available human actions
- approve/reject/resume/cancel actions for persisted wait tokens

Dedicated Workflow/XState Web UI tab MUST show visualization from Pibo/XState projection. V1 MUST NOT include full visual workflow creation/editing.

### 4.12 XState Projection and Inspection Contract

XState MUST be a projection/local orchestration helper, not durable truth.

Mapping MUST preserve:

| Pibo concept | XState-compatible projection |
|---|---|
| Workflow definition | Machine config |
| Workflow run status | Machine snapshot/status view |
| Node | State or invoked actor |
| Agent node | Invoked actor backed by Pibo Runtime |
| Code node | Action or invoked actor |
| Nested workflow node | Child actor/machine with namespace metadata |
| Adapter edge/node | Action or adapter actor/state |
| Data/control/error/resume edge | Transition with edge id metadata |
| Guard | Named guard ref |
| Human wait | Waiting state with resume event |
| Retry delay | Delay/after state projection backed by durable wakeup |
| Global/local/edge state | Context/snapshot projection only |
| Completion/failure/cancel | Explicit terminal states |

Snapshot kinds MUST be distinguished and versioned. Snapshot versions MUST be recorded when snapshots are persisted:

```ts
type WorkflowSnapshotKind = "kernel" | "xstate" | "ui";
```

XState/UI projection metadata SHOULD preserve tags, descriptions, meta, actor/child hierarchy, and UI hints needed for display. Projection MUST NOT expose raw private payloads unless the caller is authorized for debug.

Pibo MUST define a Pibo-owned actor and inspection contract. XState actors may implement it internally, but public runtime code MUST NOT depend on raw XState internals.

```ts
type PiboWorkflowActor<I = unknown, O = unknown, S = unknown> = {
  id: string;
  kind: "agent" | "code" | "workflow" | "adapter" | "human";
  start(input: I): Promise<void> | void;
  send(event: WorkflowRuntimeEvent): void;
  stop(reason?: string): Promise<void> | void;
  getSnapshot(): S;
  persist?(): PersistedActorSnapshot;
  restore?(snapshot: PersistedActorSnapshot): void;
  inspect?(listener: WorkflowInspectionListener): Unsubscribe;
};

type WorkflowInspectionEvent =
  | { type: "@pibo.workflow.actor.created"; actorId: string; nodeId?: NodeId }
  | { type: "@pibo.workflow.event.sent"; actorId: string; event: WorkflowRuntimeEvent }
  | { type: "@pibo.workflow.transition"; runId: WorkflowRunId; from: string; to: string; edgeId?: EdgeId }
  | { type: "@pibo.workflow.snapshot"; runId: WorkflowRunId; snapshot: WorkflowMachineSnapshot }
  | { type: "@pibo.workflow.action"; runId: WorkflowRunId; action: string }
  | { type: "@pibo.workflow.child.output"; runId: WorkflowRunId; childRunId: WorkflowRunId; output: WorkflowValue }
  | { type: "@pibo.workflow.wait.entered"; runId: WorkflowRunId; reason: string }
  | { type: "@pibo.workflow.wait.resumed"; runId: WorkflowRunId; value?: WorkflowValue };
```

Inspection events MUST include actor created, event sent, transition taken, snapshot updated, action executed, child output received, wait entered, and wait resumed.

Runtime snapshot projection MUST support:

```ts
type WorkflowMachineSnapshot = {
  runId: WorkflowRunId;
  value: string | Record<string, unknown>;
  status: WorkflowRunStatus;
  context: {
    currentNodes: NodeId[];
    completedNodes: NodeId[];
    failedNodes: NodeId[];
    waitingReason?: string;
  };
};
```

V1 MUST defer deep nested parallel statecharts as authoring primitive, history states, SCXML-like semantics, and implicit eventless transition cascades beyond simple compiler-generated transitions.

### 4.13 Execution Environment and Isolation Contract

Workflows and nodes MAY declare execution environment policy:

```ts
type WorkflowExecutionEnvironment =
  | { kind: "inherit" }
  | { kind: "host" }
  | { kind: "worktree"; path?: string; branch?: string }
  | { kind: "docker-worker"; workerId?: string; worktreePath?: string }
  | { kind: "remote"; id: string };
```

Default MUST be `inherit`. Environment choice MUST be stored on run or node attempt for audit/debug. The effective environment MUST be passed to Agent, code, adapter, and nested workflow executors through scoped context. Cleanup/cancellation MUST account for environment-owned resources.

Capability validation MUST check known constraints before execution when possible:

- selected Agent profile exists
- requested tools, skills, and context files are available and allowed
- structured output support exists or an explicit fallback strategy is declared
- session resume is supported when requested
- timeout, budget, isolation, and environment policy are allowed
- known provider/runtime concurrency limits are respected or diagnosed

### 4.14 Compatibility, Related Capabilities, and Migration Contract

The workflow implementation MUST preserve normal Pibo Sessions without workflow configuration. `simple-chat` SHOULD be treatable as a workflow wrapper around existing session behavior when workflow selection is enabled.

Workflow runs MUST be linkable to Pibo Sessions and Project Sessions. Existing capabilities remain relevant:

- `pibo-session-routing` supplies normal routed session behavior for Agent nodes.
- `subagent-delegation` may be used inside Agent nodes that delegate to child Pibo Runtimes.
- `yielded-run-control` may control long-running workflow nodes or nested workflow runs.
- `pibo-event-contract` MUST include workflow run, node, transition, wait, failure, and completion events.

Advanced LangGraph-style channels, generalized Pregel/superstep runtime, and pending writes for partial supersteps are deferred from V1.

UI metadata SHOULD support:

```ts
type WorkflowUiMetadata = {
  layout?: "auto" | "manual";
  positions?: Record<NodeId, { x: number; y: number }>;
  collapsed?: NodeId[];
  color?: string;
  icon?: string;
};
```

These fields MUST NOT affect execution.

### 4.15 Required Fixtures and Tests

Fixtures MUST include:

- minimal one-node Agent workflow using profile `pibo-agent`
- mixed workflow with code, agent, human, adapter, and nested workflow nodes
- adapter edge workflow
- human wait/resume workflow
- registry/plugin workflow fixture
- debug serialization fixture
- nested workflow fixture
- bounded back-edge/review-loop fixture

Validation/tests MUST cover:

- malformed definition rejection
- valid and invalid text/JSON inputs and outputs
- direct compatible edges
- incompatible edges without adapter rejection
- registered adapter success and output validation failure
- all five node kinds
- fixed Agent profile selection and unknown profile rejection
- prompt template and prompt builder output
- state read/write isolation and merge conflicts
- bounded back-edge success and retry exhaustion
- deterministic XState projection snapshots
- completed/failed/waiting/resumed/retry/cancel persistence
- restart after workflow start, node completion, edge transfer, wait, retry scheduling, and completion
- stale lease reclaim
- nested child failure propagation
- UI/CLI inspection and human action control

Required validation commands/checks:

- `npm run typecheck`
- workflow unit tests
- workflow persistence/restart tests
- manual one-node `pibo-agent` workflow
- manual two-workflow composition with explicit registered TypeScript adapter
- manual bounded review/fix loop with max attempts

### 4.16 Task Traceability

| Task group from `../tasks.md` | Complete when |
|---|---|
| 1. Foundation | `packages/workflows` layout, types, schema validation, fixtures, malformed-definition tests exist. |
| 2. Interfaces | text/json ports, JSON subset docs, input/output validation, valid/invalid tests pass. |
| 3. First-class runtime unit | one-node Agent workflow routes through Pibo Runtime, persists run facts, emits events, passes start-to-complete test. |
| 4. Edges | source/target validation, compatibility checks, transfer execution, transfer events, two-node test pass. |
| 5. Adapters | edge adapter refs, adapter nodes, registry resolution, output validation, text↔JSON tests pass. |
| 6. Node kinds | code, agent, workflow, adapter, and human dispatch implemented with status persistence and mixed workflow test. |
| 7. Agent profile/routing | fixed profile policy, profile resolution, metadata recording, unknown profile rejection, `pibo-agent` test pass. |
| 8. Prompts | template rendering, promptBuilder contract, registered prompt builders, prompt recording/privacy, fixed/variable prompt tests pass. |
| 9. State/backtracking | global/local state, reads/writes, isolation, conflict detection, bounded back-edge/retry, state/loop tests pass. |
| 10. XState | dependency added, projection shape, nodes/edges/guards/waits/final states mapped, snapshot tests, UI projection surface. |
| 11. Persistence | `pibo-workflows.sqlite` schema/store, runs/events/attempts/transfers/checkpoints/wakeups/tokens/snapshots, session links, restart inspection. |
| 12. UI/Inspection | Project UI surface, Workflow/XState tab, state/node/final/error displays, human action interface, editing deferred. |
| 13. Documentation | canonical capability docs, examples, adapters, projection semantics, registry/plugin/human/debug docs. |
| 14. Validation | typecheck, unit, persistence, manual one-node, adapter composition, and review-loop validation complete. |

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP gate: authoring API, registry, one-node Agent workflow, basic validation, workflow store, events, CLI validate/run/inspect.
  - V1 core gate: ports, edges, adapters, code nodes, state policies, bounded loops, deterministic XState projection, unit tests.
  - V1 product gate: nested workflows, human waits/actions, restart/resume, Project UI, Workflow/XState tab, persistence tests.
  - V1 release gate: all validation commands/manual checks pass and rollback path is verified.
  - V2 candidates: full visual editor, richer adapter DSLs, additional runtime node types, marketplace/discovery, advanced distributed scheduling, advanced parallel/cyclic semantics.

- **Technical Risks**:
  - **Coverage gaps**: mitigated by this PRD, traceability matrix, and rejection of implementations missing any MUST item.
  - **Scope creep**: mitigated by explicit non-goals and phased gates.
  - **Persistence bugs**: mitigated by boundary persistence, idempotency keys, replay/restart tests, and lease tests.
  - **Security bypass**: mitigated by profile/tool/skill/context/capability validation and trusted registered handlers only.
  - **XState leakage**: mitigated by Pibo-owned IR, kernel snapshots as truth, and XState as projection only.
  - **UI/CLI divergence**: mitigated by shared persisted run/wait/action APIs.
