# Design: Pibo Workflow Framework Architecture

**Status:** Draft  
**Created:** 2026-05-10  
**Related specs:**

- `docs/specs/changes/pibo-workflow-system-v1/spec.md`
- `docs/specs/changes/pibo-workflow-system-v1/design.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-authoring-api.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-runtime-kernel.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-xstate-integration.md`
- `docs/specs/changes/pibo-workflow-system-v1/references.md`

**Research inputs:**

- `docs/reports/2026-05-10-workflow-research-langgraphjs.md`
- `docs/reports/2026-05-10-workflow-research-openworkflow.md`
- `docs/reports/2026-05-10-workflow-research-graphology.md`
- `docs/reports/2026-05-10-workflow-research-graphlib.md`
- `docs/reports/2026-05-10-workflow-research-xstate.md`
- `docs/reports/2026-05-10-workflow-research-archon.md`

## Why

Pibo needs a workflow framework that is easy to author, safe to persist, visible in Chat Web, and flexible enough for agent workflows, TypeScript code, adapters, and nested workflows. The framework should hide execution complexity behind small interfaces. A user should be able to create a one-node workflow in a few lines, while advanced users can compose graphs, schema-bound ports, state policies, retries, and nested workflows.

The main lesson from the research is clear:

- Use **LangGraphJS** as a reference for graph compilation, state updates, commands, subgraphs, streaming, interrupts, and checkpoints.
- Use **OpenWorkflow** as a reference for durable execution, attempts, leases, replay, retry, and wakeups.
- Use **Graphology** as a reference for a disciplined graph store, events, serialization, and modular utilities.
- Use **Graphlib** as a reference for a small graph kernel, traversal, cycle detection, topsort, and structural validation.
- Use **XState** as a real dependency for statecharts, actors, guards, actions, delays, inspection, visualization, and local orchestration projection.
- Use **Archon** as a reference for product-ready AI coding workflow UX: prompt assets, approval gates, isolation, provider capabilities, CLI operations, and agent-facing docs.

Pibo should not copy any single project. Pibo should combine their best ideas behind Pibo-native concepts: Agent nodes backed by explicit Agent Designer profiles, TypeScript code nodes, human approval nodes, explicit ports, registered TypeScript adapters, global/local state, edge payloads, durable waits, TypeScript framework authoring in `packages/workflows`, a dedicated Workflow Registry with plugin registration hooks, workflow-specific runtime persistence in `pibo-workflows.sqlite`, and XState-backed projections.

## Design Goals

1. **Minimal by default.** A workflow with one Agent node should be easy to write and inspect.
2. **Composable.** Workflows, nodes, ports, adapters, and nested workflows should connect like Lego blocks.
3. **Explicit interfaces.** Text and JSON Schema ports should define what a workflow consumes and emits.
4. **Visible adaptation.** Incompatible outputs and inputs require explicit adapters.
5. **Pibo-native execution.** Agent nodes run through Pibo Runtime with profiles, tools, skills, context, and session routing.
6. **Durable at node boundaries.** Runs persist state, attempts, edge payloads, and checkpoints.
7. **Graph first, runtime second.** The definition is a declarative graph. The runtime executes a compiled plan.
8. **XState-backed projection.** UI visualization and future editing use an XState projection, not the internal persistence kernel.
9. **Kernel-first durability.** XState snapshots may speed rehydration, but Pibo run/attempt/checkpoint records are the durable truth.
10. **Small core, rich utilities.** Keep the kernel small. Put traversal, validation, layout, analysis, and UI helpers around it.
11. **Product authoring matters.** Keep TypeScript framework code and the Workflow Registry canonical while supporting prompt assets, routing hints, agent-facing docs, and later UI authoring.

## Non-Goals

- Do not clone LangGraphJS's Pregel runtime for V1.
- Do not make XState the persisted workflow format.
- Do not build a full visual editor in V1.
- Do not hide schema conversion behind implicit LLM calls.
- Do not expose a large generic abstraction before Pibo has concrete workflow needs.

## Layered Architecture

```text
Authoring API
  -> Workflow Definition IR
    -> Workflow Graph Store
      -> Validator + Compiler
        -> Execution Plan
          -> Durable Runtime Kernel
            -> Pibo Runtime / TypeScript Handler / Nested Workflow Executor
              -> Events + Trace + Workflow Run Store
                -> CLI / Debug API / Chat Web / XState Projection
```

### 1. Authoring API

The authoring API is the public developer-facing surface. It should support two TypeScript styles:

- object-first definitions for generated definitions, tests, and agent-authored TypeScript changes
- builder helpers for fluent human-authored composition

The authoring API writes the same Workflow Definition IR in both cases. The Workflow Registry is the V1 definition catalog. The runtime DB stores execution facts and optional compiled snapshots, not editable workflow source.

### 2. Workflow Definition IR

The IR is the canonical normalized workflow definition produced by TypeScript code at registration time. It is JSON-serializable for validation, compilation, debugging, XState projection, and optional run snapshots, but it is not a file-based product format in V1.

The IR contains:

- workflow metadata, including routing hints such as `useWhen`, `notFor`, examples, and tags
- prompt asset references for prompt-heavy Agent nodes
- input and output ports using the OpenAI Structured Outputs / tool-calling JSON Schema subset for JSON ports
- nodes
- edges
- adapters
- state schema/policies
- retry policies
- UI metadata
- version and migration metadata

### 3. Workflow Registry and Graph Store

The Workflow Registry owns code-defined workflow discovery and handler resolution. It lives in `packages/workflows` and plugins can register entries with it. It registers:

- workflow definitions
- TypeScript code handlers
- registered TypeScript adapter handlers
- guard handlers
- prompt builders and prompt assets
- human action definitions
- routing hints and capability metadata

The in-memory graph store owns normalized structure and mutation during validation/compilation. It should resemble Graphology/Graphlib in spirit:

- stable node ids
- stable edge ids
- explicit `add`, `set`, `merge`, `update`, and `drop` operations
- redundant indices for fast reads
- event payloads for mutations
- serialization for debug snapshots and deterministic tests

The graph store should not execute workflows. It stores and validates structure for a compiled definition.

### 4. Validator + Compiler

Validation checks the author-facing definition. Compilation produces an execution plan.

Validation answers:

- Are node and edge ids valid?
- Do ports exist?
- Are ports directly compatible?
- Are adapters explicit when needed?
- Are cycles allowed and explained?
- Are Agent node profiles/tools/skills resolvable?
- Are TypeScript handlers registered?
- Are nested workflows present and version-compatible?
- Are human wait nodes valid and resumable?
- Are prompt/template references valid?
- Are join policies and fan-in semantics explicit?
- Are requested runtime capabilities supported by the selected profile/provider?

Compilation produces:

- normalized nodes and edges
- entry/exit nodes
- topological layers where possible
- loop metadata where cycles are allowed
- execution queue seeds
- checkpoint namespace paths
- XState projection metadata

### 5. Durable Runtime Kernel

The runtime kernel executes compiled plans. It owns:

- workflow runs
- node attempts
- leases and heartbeats
- retries
- wait states
- wakeups
- checkpoints
- cancellation propagation
- replay/resume

It does not know how to run an agent by itself. It delegates node execution to node executors.

### 6. Node Executors

V1 has four primitive executors:

| Node kind | Executor | Description |
|---|---|---|
| `agent` | Pibo Runtime executor | Starts or attaches to a routed Pibo Runtime using profile, tools, skills, context, and session routing. |
| `code` | TypeScript handler executor | Runs a registered bounded TypeScript handler. |
| `workflow` | Nested workflow executor | Starts a child workflow run with its own namespace and state. |
| `human` | Human wait executor | Creates a durable wait token and resumes with validated approval/input. |

Adapters are registered TypeScript adapter handlers. They can be referenced by edge adapters or represented as first-class `adapter` nodes. V1 does not include a declarative mapping DSL or hidden agent-assisted adapters.

### 7. Events, Trace, and Projections

The runtime emits product events. Consumers can project those events into:

- Chat Web trace
- workflow run inspector
- terminal/debug output
- XState-backed machine state
- analytics or audit views

This follows the LangGraphJS and XState lesson: streaming and inspection should be projections over a shared event protocol, not one monolithic UI stream. XState inspection semantics are a useful model, but Pibo inspection events stay Pibo-owned.

## Core Domain Model

### WorkflowDefinition

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
  state?: WorkflowStateDefinition;
  retry?: RetryPolicyRef;
  ui?: WorkflowUiMetadata;
};
```

### WorkflowNodeDefinition

```ts
type WorkflowNodeDefinition =
  | AgentNodeDefinition
  | TypeScriptCodeNodeDefinition
  | NestedWorkflowNodeDefinition
  | AdapterNodeDefinition
  | HumanNodeDefinition;
```

`AdapterNodeDefinition` is optional in the primitive set but recommended for complex adapter logic. Simple adapters may live on edges.

`HumanNodeDefinition` represents an approval or structured-input wait. It creates a durable wait token and resumes through validated input rather than a process-local callback.

### Ports

```ts
type WorkflowPort =
  | { kind: "text"; description?: string }
  | { kind: "json"; schema: JsonSchema; description?: string };
```

Ports are public contracts. They belong to workflows, nodes, and adapters.

### Edges

```ts
type WorkflowEdgeDefinition = {
  id: EdgeId;
  from: NodePortRef;
  to: NodePortRef;
  kind?: "data" | "control" | "error" | "resume";
  guard?: GuardRef;
  join?: JoinPolicy;
  adapter?: EdgeAdapterDefinition;
  state?: EdgeStateMapping;
  ui?: EdgeUiMetadata;
};
```

Edges carry data and control. They should not be plain arrows. They should know which source port feeds which target port and whether an adapter is needed.

Join policies define fan-in behavior. V1 should support `all_success`, `one_success`, `none_failed_min_one_success`, and `all_done`.

## State Model

Pibo should use three state levels.

### Global Workflow State

Long-lived state visible to the workflow run. It can be checkpointed and used by later nodes.

### Local Node State

Node-private state. It is not visible to other nodes unless explicitly mapped to global state or edge payload.

### Edge Payload

The concrete data transferred from one node output to another node input.

This separation combines the best lessons from LangGraphJS and OpenWorkflow. LangGraphJS shows the value of explicit merge semantics. OpenWorkflow shows the value of durable step/attempt state. Pibo should keep V1 smaller: replace-by-default, optional merge policies, and conflict errors for ambiguous writes.

## Merge Policies

V1 should support a small merge policy set:

```ts
type MergePolicy =
  | { kind: "replace" }
  | { kind: "append" }
  | { kind: "shallowMerge" }
  | { kind: "custom"; handler: string };
```

Rules:

- Default is `replace`.
- Concurrent writes to the same global path fail unless a merge policy exists.
- Local node state is private by default.
- Edge payload is immutable after transfer.

## Commands

Pibo should include a small command protocol inspired by LangGraphJS.

```ts
type WorkflowCommand =
  | { kind: "goto"; nodeId: NodeId; payload?: unknown }
  | { kind: "update"; patch: StatePatch }
  | { kind: "resume"; value?: unknown }
  | { kind: "requestHumanInput"; prompt: string; schema?: JsonSchema }
  | { kind: "emitArtifact"; artifact: WorkflowArtifact }
  | { kind: "handoff"; target: NodeId | WorkflowId; payload?: unknown };
```

Commands are the escape hatch. They let Agent nodes and TypeScript code nodes request routing, state updates, resume, human input, and artifacts without inventing ad hoc side channels.

## Graph Store API Shape

The graph store should expose a small API family.

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

This follows Graphology and Graphlib: keep the core small, predictable, and composable.

## XState-Compatible Projection

Pibo should produce XState-backed machine projection data for Web UI visualization, simulation, local orchestration, and future editing.

Rules:

- Internal IR remains Pibo-owned.
- XState projection is deterministic.
- XState snapshots are optional cached views, not durable truth.
- Agent nodes become invoked actors backed by Pibo Runtime.
- TypeScript code nodes become actions or invoked actors.
- Nested workflows become child machines or invoked actors with namespace metadata.
- Edges become transitions with Pibo edge ids preserved in metadata.
- Guards map to named XState guards.
- Wait/human-input states map to explicit waiting states, while Pibo owns durable wait tokens.
- Retry delays map to waiting/delay states, while Pibo owns durable wakeups.
- Failure and cancellation map to explicit terminal or recovery states.

The projection should support round-trip editing later, but V1 only needs safe export. Chat Web should edit Pibo IR and use the XState projection for display, simulation, and inspection.

## Error Model

Pibo should use structured errors with diagnostic payloads.

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

Recommended error families:

- `WorkflowDefinitionError`
- `WorkflowGraphError`
- `WorkflowInterfaceError`
- `WorkflowExecutionError`
- `WorkflowRetryExhaustedError`
- `WorkflowAdapterError`
- `WorkflowNodeExecutorError`

Diagnostics should be usable by CLI, Chat Web, agents, and tests.

## Design Decisions

### Decision: Define workflows in TypeScript and register IR

Pibo workflows should be TypeScript code using the Pibo Workflow Framework. That code registers definitions into a dedicated Workflow Registry and produces Pibo-owned IR for validation, compilation, execution, debugging, and XState projection.

**Reason:** Pibo needs product concepts that XState and LangGraphJS do not own: Pibo Runtime profiles, tools, skills, context, routing, Pibo Sessions, Project Sessions, handlers, adapters, guards, and capability metadata. File-first workflow definitions would create a second authoring model too early.

### Decision: Compile definitions before execution

Definitions should not execute directly. A compiler should normalize and validate them.

**Reason:** LangGraphJS shows that a compile phase creates a clean boundary between authoring and runtime. It also gives Pibo a place to produce diagnostics and UI projections.

### Decision: Keep the graph kernel small

Use Graphlib/Graphology-style storage and utilities, not a large execution-aware graph class.

**Reason:** Structure, validation, execution, persistence, and UI are different concerns.

### Decision: Persist at workflow and node boundaries

Use OpenWorkflow-style run/attempt persistence. Do not try to persist arbitrary JS call stacks.

**Reason:** Durable replay is easier to reason about and test.

### Decision: Use registered TypeScript adapters

An adapter can be a registered TypeScript edge adapter or a first-class adapter node. It must never be invisible.

**Reason:** Interface mismatch is a design fact. Registered TypeScript adapters are deterministic, testable, and inspectable. Declarative mapping DSLs and agent-assisted adapters can come later if needed.

## V1 Architecture Summary

V1 should implement:

1. Pibo Workflow IR.
2. `packages/workflows` package with Workflow Registry and framework API.
3. Small graph store.
4. Definition validator.
5. Compiler to execution plan.
6. Agent node executor backed by Pibo Runtime and explicit Agent Designer profile selection.
7. TypeScript code node executor backed by registered handlers.
8. Nested workflow executor.
9. Registered TypeScript edge adapters and adapter nodes.
10. Workflow run and node attempt persistence in `pibo-workflows.sqlite`.
11. Durable wait tokens and wakeups for human input, retry, child completion, and external signals.
12. XState-backed projection using the `xstate` dependency.
13. XState-style inspection events.
14. CLI/debug inspection and Project UI run inspection before full UI editing.

V1 should defer:

- full visual editor
- generalized Pregel/superstep runtime
- broad channel system
- arbitrary inline code execution
- automatic LLM coercion between schemas
- pending writes for partial supersteps
- XState as the primary persisted runtime
- workflow YAML/JSON file authoring
- declarative adapter mapping DSLs
- hidden agent-assisted adapters
- free/unbounded cycles

## Source Influence Map

| Source | Use in Pibo |
|---|---|
| LangGraphJS | Compile boundary, commands, subgraphs, checkpoint namespace, streaming projections, state merge policies. |
| OpenWorkflow | Durable kernel, run/attempt model, retry, replay, leases, wakeups, race-condition testing. |
| Graphology | Evented graph store, strict mutations, modular algorithms, import/export, projection APIs. |
| Graphlib | Minimal graph API, internal indices, traversal, topsort, cycle detection, JSON IR discipline. |
| XState | Statechart projection, actor model, guards/actions/delays, inspection, visualization, UI editing patterns, `setup(...)` typing pattern. |
