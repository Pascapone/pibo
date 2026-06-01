# Design: Pibo Workflow System V1

**Status:** Draft  
**Created:** 2026-05-10  
**Related spec:** `docs/specs/changes/pibo-workflow-system-v1/spec.md`

**Detailed design documents:**

- `docs/specs/changes/pibo-workflow-system-v1/design-framework-architecture.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-authoring-api.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-runtime-kernel.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-xstate-integration.md`
- `docs/specs/changes/pibo-workflow-system-v1/references.md`

## Document Roles

| Document | Role |
|---|---|
| `design.md` | Compact design summary and shared vocabulary. |
| `design-framework-architecture.md` | Layered architecture and cross-project design decisions. |
| `design-authoring-api.md` | Public authoring API, builder/object style, examples, and validation UX. |
| `design-runtime-kernel.md` | Durable execution, attempts, checkpoints, retries, leases, wakeups, and events. |
| `design-xstate-integration.md` | XState projection, actor integration, inspection, and UI editing boundaries. |
| `references.md` | Research report index and mapping from external references to design decisions. |

## Context

Pibo already has the right agent primitive: a Pibo Runtime, as used by a routed Pibo Session. V1 workflows should compose that primitive instead of replacing it. A workflow can be as small as one Agent node with a prompt. It can also grow into a graph of TypeScript code nodes, Agent nodes, nested workflows, typed edges, state mappings, and adapters.

LangGraph remains a reference for graph-shaped agent execution. XState remains the reference model for state machines, visualization, guards, actions, actors, and editing. Archon remains the reference for product-shaped AI coding workflow UX: command/prompt assets, approval gates, isolation, provider capabilities, CLI operations, and agent-facing workflow docs. Pibo owns the saved workflow contract, framework authoring model, workflow store, and runtime integration.

## Goals / Non-Goals

### Goals

- Keep a minimal workflow definition small.
- Make workflow interfaces explicit and schema-checkable.
- Compose workflows through typed edges.
- Allow explicit adapters for mismatched interfaces.
- Use normal Pibo Runtime behavior for agent nodes, including agent profiles, tools, skills, context, and session routing.
- Support nested workflows without a second runtime model.
- Persist workflow runs separately from trace history.
- Produce an XState-backed machine projection for Web UI visualization and later UI editing.
- Treat XState snapshots as optional projections, not durable truth.
- Define workflows as TypeScript code using the Pibo Workflow Framework syntax; no workflow file import/export product layer in V1.
- Model human approval/input as a durable workflow primitive, not a process-local callback.

### Non-Goals

- Clone LangGraph.
- Depend on XState-specific persisted internals or use XState snapshots as the only recovery model.
- Build a full visual workflow editor in V1.
- Build a general data-pipeline DAG engine in V1.
- Allow invisible schema coercion.

## Core Model

### Workflow Definition

A workflow definition is a versioned IR object produced by TypeScript workflow code in `packages/workflows` and registered through the Workflow Registry.

```ts
type WorkflowDefinition = {
  id: string;
  version: string;
  name?: string;
  description?: string;
  input: WorkflowPort;
  output: WorkflowPort;
  state?: WorkflowStateSpec;
  nodes: Record<NodeId, WorkflowNode>;
  edges: Record<EdgeId, WorkflowEdge>;
  initial: NodeId | NodeId[];
  final?: WorkflowFinalSpec;
};
```

A minimal one-node workflow may omit most optional fields.

```ts
const summarizeWorkflow = {
  id: "summarize-text",
  version: "1.0.0",
  input: { kind: "text" },
  output: { kind: "text" },
  initial: "agent",
  nodes: {
    agent: {
      kind: "agent",
      runtime: "pibo",
      promptTemplate: "Summarize this:\n\n{{input.text}}"
    }
  },
  edges: {}
};
```

### Ports

Ports define the interface layer.

```ts
type WorkflowPort =
  | { kind: "text"; description?: string }
  | { kind: "json"; schema: JsonSchema; description?: string };
```

Rules:

- Text input is a string.
- JSON input is validated against the declared schema before execution.
- JSON schemas use the OpenAI Structured Outputs / tool-calling JSON Schema subset in V1.
- Text output is a string.
- JSON output is validated before completion.
- Ports are part of the public workflow contract.
- Two ports are directly compatible when both are `text`, or both are `json` and the source schema is assignable to the target schema under the V1 compatibility rules.
- If direct compatibility cannot be proven, the edge needs an adapter.

### Nodes

```ts
type WorkflowNode =
  | AgentNode
  | CodeNode
  | NestedWorkflowNode
  | AdapterNode
  | HumanNode;

type BaseNode = {
  label?: string;
  input?: WorkflowPort;
  output?: WorkflowPort;
  reads?: StatePath[];
  writes?: StatePath[];
};

type CodeNode = BaseNode & {
  kind: "code";
  language: "typescript";
  handler: string;
};

type AgentNode = BaseNode & {
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

type NestedWorkflowNode = BaseNode & {
  kind: "workflow";
  workflowId: string;
  workflowVersion?: string;
};

type AdapterNode = BaseNode & {
  kind: "adapter";
  handler: AdapterRef;
  mode: "deterministic";
};

type HumanNode = BaseNode & {
  kind: "human";
  prompt: string;
  schema?: JsonSchema;
  timeout?: DurationSpec;
};
```

### Edges

Edges carry data and state between nodes.

```ts
type WorkflowEdge = {
  id: EdgeId;
  from: NodePortRef;
  to: NodePortRef;
  kind?: "data" | "control" | "error" | "resume";
  event?: string;
  condition?: GuardRef;
  join?: JoinPolicy;
  map?: EdgeMap;
  adapter?: WorkflowAdapter;
};
```

An edge is valid when the source output can become the target input directly or through an adapter. Simple adapters may live on edges. Complex or reusable adapters should be modeled as visible `adapter` nodes so they can be inspected, retried, and edited.

V1 join policies should include the Archon-style fan-in cases `all_success`, `one_success`, `none_failed_min_one_success`, and `all_done`.

### Interface Adapters

Adapters make mismatched interfaces explicit. They are the only V1 mechanism for connecting ports that do not match directly. V1 supports registered TypeScript adapters only.

```ts
type WorkflowAdapter = {
  kind: "edgeAdapter";
  output: WorkflowPort;
  transform: AdapterRef;
};
```

Interpretation:

- `edgeAdapter` maps source output and state to target input without changing either workflow's public contract.
- `AdapterRef` resolves to a registered TypeScript adapter in the Workflow Registry.
- Complex or reusable mappings should be visible `adapter` nodes.

`sourceOutputAdapter`, `targetInputAdapter`, declarative mapping DSLs, and hidden agent-assisted adapters are deferred.

### State

Workflow state has separate scopes.

```ts
type WorkflowRunState = {
  global: Record<string, unknown>;
  nodes: Record<string, NodeLocalState>;
  edges: Record<string, EdgeTransferState>;
};
```

Rules:

- Global state is shared by the workflow run.
- Local node state is private by default.
- Edge data is the explicit transfer between nodes.
- A node can read or write global state only when its definition allows that path.
- A node can expose local state only through an edge map or explicit state write.

## Authoring, Registration, and Discovery

Pibo is framework-first. Workflows are defined as TypeScript code using the Pibo Workflow Framework syntax. That code builds canonical Workflow IR at registration time.

Workflow definitions are not authored as YAML/JSON files in V1. There is no workflow file import/export product concept. JSON IR and XState machine output may still exist as internal/debug projections.

Workflow metadata should support routing hints inspired by Archon:

- `useWhen`: when this workflow is appropriate.
- `notFor`: when this workflow should not be selected.
- `examples`: short invocation examples.
- `tags`: search and grouping labels.

Prompt-heavy Agent nodes should be able to reference prompt assets instead of embedding long prompt text in graph structure.

Workflow resolution goes through a dedicated Workflow Registry in `packages/workflows`. The registry owns workflow definitions, code handlers, registered TypeScript adapters, guards, prompt assets, human actions, plugin registrations, and capability metadata. The workflow runtime DB stores run-time facts, not editable workflow source.

## Runtime Flow

```text
start workflow
  -> validate definition
  -> validate input
  -> create workflow run
  -> enter initial node
  -> execute node
  -> validate node output
  -> apply state writes
  -> choose matching outgoing edge
  -> adapt/map edge data
  -> enter next node
  -> repeat until final output
  -> validate workflow output
  -> mark run completed
```

Failure states are explicit:

```text
running -> waiting | failed | completed | cancelled
```

Node statuses:

```text
pending -> running -> waiting | failed | completed | skipped
```

## Definition Validation

The validator should reject definitions with:

- duplicate or missing node ids
- an `initial` node id that does not exist
- edges that reference missing nodes
- incompatible ports without an adapter
- adapters whose declared output does not match the target input
- adapter refs that do not resolve to registered TypeScript adapters
- invalid join policies or ambiguous fan-in behavior
- template references to unknown nodes, ports, state paths, or output fields that can be proven invalid
- Agent nodes without a resolvable Pibo Runtime selection policy
- TypeScript code nodes without a registered handler
- nested workflow nodes that reference unknown workflow definitions
- cycles without an explicit loop policy, wait state, guard, or max-iteration rule

## Agent Node Execution

An `agent` node creates or attaches to a normal Pibo Runtime.

Required behavior:

- It uses normal Pibo session routing.
- It records created Pibo Session ids.
- It accepts fixed prompts or built prompts.
- It selects an Agent Designer profile explicitly, for example `pibo-agent`.
- It inherits tools, skills, and context from that selected profile unless narrowed or extended by node policy.
- It records the effective profile, tools, skills, context, and routing policy used for the run.
- It emits normal trace events plus workflow-specific run events.
- It validates requested structured output, tools, skills, session resume, budget, timeout, and isolation requirements against runtime/profile capabilities when those capabilities are known.

## Backtracking and Limited Loops

V1 allows a workflow to move back to a previous step only through an explicit back-edge or retry policy with `maxAttempts`.

Rules:

- Free cycles are rejected.
- Back-edges must declare a guard and max attempts.
- The runtime persists each attempt and fails with a clear diagnostic when the max is exceeded.
- This supports review/fix loops without introducing unbounded cyclic execution.

## Code Node Execution

A code node runs bounded TypeScript logic.

V1 choices to confirm during implementation:

- TypeScript code nodes may reference registered TypeScript handlers rather than embed arbitrary code.
- Handlers receive `{ input, globalState, localState, edgeData }`.
- Handlers return `{ output, globalPatch?, localPatch? }`.
- Handlers run inside existing trusted runtime boundaries.

This keeps V1 lightweight while avoiding unsafe ad hoc code execution.

## Human Node Execution

A `human` node creates a durable wait token and waits for external input or approval.

Rules:

- The wait token is persisted by the kernel.
- Resume input is validated against the node schema before execution continues.
- Approval/rejection should be visible in run events and Chat Web.
- XState may project the node as a waiting state, but it does not own the durable wait.

## Nested Workflow Execution

A nested workflow node starts another workflow run.

Rules:

- The parent workflow passes input to the nested workflow through the node input contract.
- The nested run has its own global and local state.
- The parent sees only the nested workflow output unless explicit state export is configured.
- Failure bubbles to the parent node unless the edge or node defines failure handling.

## XState-Compatible Model

The workflow definition projects to a state machine.

Mapping:

| Pibo concept | XState-compatible concept |
|---|---|
| Workflow definition | Machine |
| Node | State with invoke/action metadata |
| Edge | Transition |
| Condition | Guard |
| TypeScript code node | Action or invoked actor |
| Agent node | Invoked actor backed by Pibo Runtime |
| Nested workflow node | Invoked actor / nested machine |
| Waiting node | State with resume event |
| Failure | Error state or transition target |
| Completed workflow | Final state |

The projection should be deterministic. It should not include private runtime data unless requested for debugging. V1 should use the real `xstate` package for projection/local orchestration support while keeping Pibo IR and kernel records authoritative. The V1 UI inspects workflow runs and uses the XState projection for display and simulation. UI-based workflow creation/editing is deferred.

## Decisions

### Decision: Workflow definitions are TypeScript code

- **Choice:** Define workflows in TypeScript using the Pibo Workflow Framework. The code registers workflow definitions into the Workflow Registry and produces canonical Workflow IR.
- **Rationale:** Pibo workflows are framework constructs with typed handlers, adapters, guards, Pibo Runtime integration, and code-level composition. YAML/JSON files would create a second authoring model too early.
- **Persistence boundary:** The workflow runtime DB is a fresh dedicated SQLite database named `pibo-workflows.sqlite`. It stores workflow-specific run data: runs, events, node attempts, edge transfers, checkpoints, wakeups, wait tokens, status, and optional compiled-definition snapshots for replay/audit. Normal session data such as tool calls, traces, spans, and Pi/Pibo session history remains in the standard session stores.
- **Alternatives considered:** File-first workflow definitions. Rejected for V1 because Pibo should be framework-first.

### Decision: Use registered TypeScript adapters for interface mismatch

- **Choice:** Invalid direct edges require saved adapter refs. V1 adapter implementations are registered TypeScript adapters resolved through the Workflow Registry.
- **Rationale:** Invisible coercion makes workflows hard to debug and unsafe to edit visually.
- **Alternatives considered:** Auto-coerce text to JSON with an LLM. Rejected for V1 because it is not deterministic unless modeled as an explicit node or adapter.

### Decision: Prefer edge adapters over changing workflow contracts

- **Choice:** Use `edgeAdapter` as the default recommendation.
- **Rationale:** It lets two reusable workflows keep their public contracts.
- **Alternatives considered:** Mutate the upstream output layer or downstream input layer by default. Rejected because it makes reuse harder to reason about.

### Decision: Keep TypeScript code nodes registered and bounded in V1

- **Choice:** TypeScript code nodes reference known handlers.
- **Rationale:** This supports lightweight TypeScript nodes without adding unsafe arbitrary code execution.
- **Alternatives considered:** Inline code in workflow JSON. Deferred.

## Risks / Trade-offs

### Risk: The model becomes too broad

The requested system can grow from one-node workflows to complex graphs. V1 must keep the minimal path small.

**Mitigation:** Implement the one-node Pibo Runtime path first. Add TypeScript code nodes, nested workflows, and adapters behind the same contract.

### Risk: Adapters become hidden workflows

Adapters can grow complex.

**Mitigation:** Treat complex adapters as visible adapter nodes or TypeScript code nodes. Keep V1 adapters registered and deterministic.

### Risk: XState export and runtime diverge

If the export is only approximate, UI editing will become unsafe.

**Mitigation:** Make machine export deterministic and test it against representative workflows.

### Risk: State writes conflict

Parallel or branching workflows may write the same global path.

**Mitigation:** V1 should reject ambiguous concurrent writes unless a merge strategy is declared.

## Migration / Rollback

V1 can be introduced without changing normal Pibo Sessions.

Migration path:

1. Keep existing sessions unchanged.
2. Add a workflow-specific runtime DB for runs, events, attempts, edge transfers, checkpoints, wakeups, wait tokens, and status.
3. Register code-defined workflows through the Workflow Registry.
4. Treat `simple-chat` as a workflow wrapper around the existing session behavior.
5. Link Project Sessions to workflow runs only when a workflow is selected.

Rollback path:

- Disable workflow execution while leaving normal sessions available.
- Preserve workflow run records for inspection.
- Ignore workflow metadata in session routing if the workflow feature is off.

## Finalized Decisions

- Workflow package: `packages/workflows`.
- Workflow runtime DB: fresh dedicated SQLite database named `pibo-workflows.sqlite`.
- Workflow definitions: TypeScript code using the Pibo Workflow Framework syntax.
- Workflow Registry: dedicated registry in `packages/workflows`.
- Plugin integration: Pibo plugins can register workflows, handlers, adapters, guards, prompt assets, and human actions.
- V1 adapters: registered TypeScript adapters only.
- Agent nodes: each Agent node explicitly selects an Agent Designer profile.
- Backtracking: explicit back-edges/retry policies with max attempts only; no free cycles.
- Human actions: Projects tab plus CLI/debug, registered through an extensible registry-backed action interface.
- CLI: workflow list/validate/run/inspect/approve/reject/resume/cancel; no XState CLI command.
- XState UI: workflow visualization gets its own Web UI tab.

## Implementation Defaults

- Internal submodules under `packages/workflows/src`: `api`, `registry`, `types`, `validation`, `graph`, `compiler`, `runtime`, `store`, `xstate`, `fixtures`, and `testing`.
- First implementation fixture: a minimal one-node Agent workflow using Agent Designer profile `pibo-agent`.
- Second fixture after the minimal path: `plan -> approve(human) -> implement(agent) -> review(code) -> back-edge to implement with max attempts`.
