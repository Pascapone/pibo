# Design: Pibo Workflow Authoring API

**Status:** Draft  
**Created:** 2026-05-10  
**Related specs:**

- `docs/specs/changes/pibo-workflow-system-v1/spec.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-framework-architecture.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-runtime-kernel.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-xstate-integration.md`
- `docs/specs/changes/pibo-workflow-system-v1/references.md`

## Purpose

This document defines the developer-facing shape of Pibo Workflow authoring. The goal is a small TypeScript framework API that hides runtime complexity but still exposes the concepts needed for serious workflows: Agent nodes, TypeScript code nodes, nested workflows, human approval nodes, typed ports, adapters, state, guards, retries, registry integration, and UI projection metadata.

A user should be able to start with one prompt and grow toward a graph without changing mental models.

## Design Principles

1. **One concept per line.** A simple workflow should not require ceremony.
2. **Everything serializes to IR.** Builder APIs and object definitions produce the same Workflow Definition IR.
3. **Ports are contracts.** Inputs and outputs are always text or JSON Schema-backed JSON.
4. **Adapters are explicit.** If data does not fit, the definition says how it is adapted.
5. **Agent nodes are Pibo-native.** They select profiles, tools, skills, context, and routing.
6. **TypeScript nodes are bounded.** They run registered handlers, not arbitrary hidden code.
7. **Complexity is opt-in.** Retries, merge policies, guards, loops, approvals, and nested workflows appear only when needed.
8. **Code is the authoring source.** Workflows are TypeScript code using the Pibo Workflow Framework syntax. The runtime stores workflow facts, not editable workflow source.
9. **Prompt assets are reusable.** Long prompts should be references where possible, not embedded in every node.

## Authoring Scope

Pibo should follow XState's `setup(...)` idea without copying XState's full type complexity. A workflow project can define a typed scope first, then define one or more workflows inside that scope.

```ts
const workflows = setupWorkflow({
  profiles: {
    planner: fixedProfile("project-planner")
  },
  handlers: {
    normalizePlan
  },
  guards: {
    testsPassed
  },
  adapters: {
    textToSummaryInput
  }
});
```

Rules:

- `setupWorkflow(...)` registers names, handlers, guards, adapters, and type hints.
- `defineWorkflow(...)` or `workflow(...)` creates Pibo Workflow IR from TypeScript code.
- `provideWorkflow(...)` can bind or override implementations for tests or deployments.
- `registerWorkflow(...)` publishes the workflow to the Workflow Registry.
- Persisted run records store workflow ids, versions, hashes, and runtime facts, not inline closures or editable source definitions.

## Authoring Styles

V1 should support two TypeScript authoring styles.

### Object Definition

Good for generated workflows, tests, and agent-authored TypeScript changes.

```ts
const workflow: WorkflowDefinition = {
  id: "summarize",
  version: "1.0.0",
  input: { kind: "text" },
  output: { kind: "text" },
  initial: "summarizer",
  nodes: {
    summarizer: {
      kind: "agent",
      runtime: "pibo",
      profile: { kind: "fixed", id: "default" },
      promptTemplate: "Summarize this:\n\n{{input.text}}"
    }
  },
  edges: {}
};
```

### Builder API

Good for humans writing TypeScript.

```ts
const summarize = workflow("summarize")
  .input(text())
  .output(text())
  .agent("summarizer", {
    profile: fixedProfile("default"),
    prompt: template("Summarize this:\n\n{{input.text}}")
  })
  .startAt("summarizer")
  .doneFrom("summarizer")
  .build();
```

The builder must never create hidden behavior that cannot be represented in the IR.

## Workflow Registry

The Workflow Registry is the code-defined catalog for V1. It lives in `packages/workflows` and exposes hooks for Pibo plugins to register workflow capabilities.

It should register:

- workflow definitions
- TypeScript code handlers
- adapter handlers
- guard handlers
- prompt builders and prompt assets
- workflow metadata and routing hints
- human action definitions
- runtime capability declarations

Rules:

- A workflow run starts from a registry-resolved workflow id and version.
- Registry entries produce canonical Workflow IR for validation, compilation, XState projection, and execution.
- Handlers/adapters/guards/human actions are referenced by id in IR and resolved through the registry.
- Plugins can register workflows and related implementations through the registry.
- The runtime DB may store the registry id, version, definition hash, and optional compiled snapshot for replay/audit, but source definitions remain TypeScript code.

## Ports

Ports describe what a workflow or node accepts and emits.

```ts
type WorkflowPort =
  | { kind: "text"; description?: string }
  | { kind: "json"; schema: JsonSchema; description?: string };
```

Helper API:

```ts
const textPort = text("Free-form user prompt");

const specPort = json({
  type: "object",
  required: ["title", "body"],
  properties: {
    title: { type: "string" },
    body: { type: "string" }
  }
});
```

Rules:

- A text port carries a string.
- A JSON port carries a JSON value validated by its schema.
- V1 uses the OpenAI Structured Outputs / tool-calling JSON Schema subset for structured ports, rather than arbitrary full JSON Schema.
- The canonical supported subset is documented in `structured-outputs-json-schema-subset.md`.
- The validator should enforce the important subset constraints: supported primitive/container types, object roots for structured outputs, no root `anyOf`, all object fields listed in `required`, and `additionalProperties: false` on objects.
- Schema compatibility is checked at definition validation time when possible.
- If compatibility cannot be proven, an adapter is required.

## Node Types

### Agent Node

An Agent node runs through Pibo Runtime.

```ts
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
};
```

Prompt builder contract:

```ts
type PromptBuilderRef =
  | string
  | { kind: "promptBuilder"; language: "typescript"; id: string };

type PromptBuilderContext<I = WorkflowValue> = {
  input: I;
  state: WorkflowRunState;
  global: WorkflowGlobalStateReader;
  local: NodeLocalStateReader;
  edge: EdgePayloadReader;
  node: AgentNodeDefinition;
  nodeId: string;
  run?: WorkflowRun;
  workflow?: WorkflowDefinition;
};

type PromptBuilderResult = string | { prompt: string; metadata?: Record<string, JsonValue> };

type PromptBuilderHandler<I = WorkflowValue> =
  (ctx: PromptBuilderContext<I>) => PromptBuilderResult | Promise<PromptBuilderResult>;
```

Prompt builder rules:

- `promptTemplate` and `promptBuilder` are mutually exclusive prompt sources.
- Prompt builders are registered TypeScript handlers referenced by id in persisted workflow IR.
- The builder input contract is the Agent node's declared `input` port.
- The builder output contract is final prompt text; returning an object allows future runtime metadata without changing the prompt contract.
- Builder context exposes workflow input, global state, current-node local state, and edge payload readers; state writes are out of scope for prompt builders.

Selection policies:

```ts
type AgentProfileSelection =
  | { kind: "fixed"; id: string };
```

V1 rules:

- `profile` is required and must reference an Agent Designer profile, for example `pibo-agent`.
- `tools`: inherit from selected profile unless explicitly narrowed by policy.
- `skills`: inherit from selected profile unless explicitly narrowed by policy.
- `context`: inherit from selected profile and workflow context unless explicitly extended by policy.
- `routing`: create a child Pibo Session linked to the workflow run.

Simple Agent node:

```ts
.agent("plan", {
  profile: fixedProfile("project-planner"),
  input: json(ProjectBriefSchema),
  output: json(ProjectPlanSchema),
  prompt: template("Create a plan for {{input.title}}")
})
```

### TypeScript Code Node

A TypeScript code node runs a registered handler.

```ts
type TypeScriptCodeNodeDefinition = BaseNodeDefinition & {
  kind: "code";
  language: "typescript";
  handler: string;
};
```

Handler contract:

```ts
type CodeNodeHandler<I, O> = (ctx: CodeNodeContext<I>) => Promise<CodeNodeResult<O>> | CodeNodeResult<O>;

type CodeNodeContext<I> = {
  input: I;
  global: WorkflowGlobalStateReader;
  local: NodeLocalStateReader;
  edge: EdgePayloadReader;
  emit: WorkflowEventEmitter;
  command: WorkflowCommandEmitter;
};

type CodeNodeResult<O> = {
  output: O;
  globalPatch?: StatePatch;
  localPatch?: StatePatch;
  command?: WorkflowCommand | WorkflowCommand[];
};
```

Rules:

- V1 code nodes reference registered handlers.
- Inline arbitrary code is out of scope.
- Handler input and output are validated against ports.
- Handlers may emit commands but cannot mutate runtime internals directly.

### Nested Workflow Node

A nested workflow node invokes another workflow.

```ts
type NestedWorkflowNodeDefinition = BaseNodeDefinition & {
  kind: "workflow";
  workflowId: string;
  workflowVersion?: string;
  namespace?: string;
};
```

Rules:

- The nested workflow has its own run id.
- It uses a child checkpoint namespace.
- Parent receives only the child output unless state export is explicit.
- Parent/child relationship is visible in traces and inspection.

### Human / Approval Node

A human node asks for approval or structured input and resumes through a durable wait token.

```ts
type HumanNodeDefinition = BaseNodeDefinition & {
  kind: "human";
  prompt: string;
  schema?: JsonSchema;
  timeout?: DurationSpec;
};
```

Rules:

- Human nodes persist a wait token before returning control to the caller.
- Resume data is validated against `schema` when present.
- Approval and rejection should be visible as workflow events.
- Human nodes are preferred over hidden callback logic for review gates.

### Adapter Node

A first-class adapter node transforms one port shape into another.

```ts
type AdapterNodeDefinition = BaseNodeDefinition & {
  kind: "adapter";
  handler: AdapterRef;
  mode: "deterministic";
};
```

V1 supports registered deterministic TypeScript adapters only. Agent-assisted transformations must be modeled as explicit Agent nodes, not hidden adapters.

## Edges

Edges are typed connections.

```ts
type WorkflowEdgeDefinition = {
  id: string;
  from: NodePortRef;
  to: NodePortRef;
  kind?: "data" | "control" | "error" | "resume";
  guard?: GuardRef;
  join?: JoinPolicy;
  adapter?: EdgeAdapterDefinition;
};
```

Helper API:

```ts
.edge("plan", "implement")
.edge("draft.output", "review.input")
.edge("summarize.output", "save.input", {
  adapter: "adapters.textToSummaryJson"
})
```

Rules:

- If no port is named, use the node default output/input.
- Direct edges require compatible ports.
- Incompatible ports require an edge adapter or adapter node.
- Error edges route failures.
- Resume edges route human or external resume events.
- Fan-in edges can declare a join policy: `all_success`, `one_success`, `none_failed_min_one_success`, or `all_done`.

## Adapters

Adapters exist because workflows must remain composable even when their public contracts differ.

### Edge Adapter

Use for simple deterministic mapping.

```ts
.edge("extract.output", "store.input", {
  adapter: {
    kind: "edgeAdapter",
    output: json(StoreInputSchema),
    transform: "adapters.extractToStoreInput"
  }
})
```

### Deferred Adapter Forms

V1 does not support `sourceOutputAdapter`, `targetInputAdapter`, declarative mapping DSLs, or hidden agent-assisted adapters. If an agent should transform data, model that as an explicit Agent node.

### Recommendation

Use registered TypeScript edge adapters for simple deterministic mappings. Use adapter nodes for mappings that should be visible, retryable, inspectable, or reused.

## State Authoring

A workflow can define state paths and merge policies.

```ts
state: {
  global: {
    projectGoal: { schema: { type: "string" }, merge: { kind: "replace" } },
    findings: { schema: { type: "array" }, merge: { kind: "append" } }
  }
}
```

Node state access should be explicit:

```ts
.code("collect", {
  reads: ["global.projectGoal"],
  writes: ["global.findings"],
  handler: "collectFindings"
})
```

Rules:

- Global state reads and writes must be declared.
- Local state is private by default.
- Edge payload is immutable after transfer.
- Concurrent writes require merge policy.

## Guards

Guards decide whether an edge can fire.

```ts
.edge("test", "fix", {
  guard: { handler: "guards.testsFailed" }
})
.edge("test", "review", {
  guard: { handler: "guards.testsPassed" }
})
```

Guard contract:

```ts
type GuardHandler = (ctx: GuardContext) => boolean | Promise<boolean>;
```

Rules:

- Guards should be deterministic when possible.
- Guard failures should produce diagnostics.
- If multiple outgoing edges match, ordering or priority must be explicit.

## Retry Policies

Retry can be declared at workflow, node, or adapter level.

```ts
retry: {
  maxAttempts: 3,
  backoff: { kind: "exponential", initialMs: 1000, maxMs: 30000 },
  retryOn: ["timeout", "transient-error"]
}
```

Inheritance order:

1. Node/adapter retry policy.
2. Workflow retry policy.
3. System default.

Retry decisions should be pure functions in the runtime kernel.

## Human Input

Human-in-the-loop should be an explicit command or `human` node. It should also create a durable Pibo wait token. XState projection may show a waiting state, but Pibo owns the resume token and validation. V1 displays human actions in the Projects tab for the associated project and exposes the same actions through CLI/debug commands.

```ts
return {
  output: draft,
  command: {
    kind: "requestHumanInput",
    prompt: "Approve this implementation plan?",
    schema: ApprovalSchema
  }
};
```

The workflow enters a waiting state. Resume data is validated before execution continues. Use a `human` node when the wait is part of the visible workflow graph; use `requestHumanInput` when an executor discovers the need dynamically.

Built-in actions are `approve`, `reject`, `resume`, and `cancel`. Additional actions are registered with `registerWorkflowHumanAction(...)`.

## Example: Composed Project Workflow

```ts
const projectWorkflow = workflow("standard-project")
  .input(json(ProjectBriefSchema))
  .output(json(ProjectResultSchema))

  .agent("spec", {
    profile: fixedProfile("spec-writer"),
    input: json(ProjectBriefSchema),
    output: json(ProjectSpecSchema),
    prompt: template("Write a spec for {{input.title}}")
  })

  .agent("plan", {
    profile: fixedProfile("planner"),
    input: json(ProjectSpecSchema),
    output: json(ProjectPlanSchema),
    prompt: template("Create an implementation plan from this spec: {{input}}")
  })

  .code("normalizePlan", {
    input: json(ProjectPlanSchema),
    output: json(NormalizedPlanSchema),
    handler: "project.normalizePlan"
  })

  .workflow("implement", {
    workflowId: "implementation-subflow",
    input: json(NormalizedPlanSchema),
    output: json(ImplementationResultSchema)
  })

  .agent("review", {
    profile: fixedProfile("reviewer"),
    input: json(ImplementationResultSchema),
    output: json(ReviewResultSchema),
    prompt: template("Review this implementation result: {{input}}")
  })

  .edge("spec", "plan")
  .edge("plan", "normalizePlan")
  .edge("normalizePlan", "implement")
  .edge("implement", "review")
  .startAt("spec")
  .doneFrom("review")
  .build();
```

## Example: Incompatible Interface with Adapter

```ts
const wf = workflow("text-to-json-pipeline")
  .input(text())
  .output(json(SavedSummarySchema))
  .agent("summarize", {
    output: text(),
    prompt: template("Summarize: {{input.text}}")
  })
  .code("save", {
    input: json(SaveSummaryInputSchema),
    output: json(SavedSummarySchema),
    handler: "summaries.save"
  })
  .edge("summarize.output", "save.input", {
    adapter: {
      kind: "edgeAdapter",
      output: json(SaveSummaryInputSchema),
      transform: "adapters.textToSaveSummaryInput"
    }
  })
  .build();
```

## Validation Experience

Validation should return structured diagnostics, not just throw.

```ts
const result = validateWorkflow(workflow);

if (!result.ok) {
  for (const diagnostic of result.diagnostics) {
    console.error(diagnostic.message);
  }
}
```

Diagnostic example:

```ts
{
  code: "WORKFLOW_INTERFACE_MISMATCH",
  message: "Edge summarize.output -> save.input connects text to JSON without an adapter.",
  edgeId: "summarize:save",
  severity: "error",
  hint: "Add an edgeAdapter or insert an adapter node."
}
```

## IR Serialization for Debugging

The authoring API must support deterministic IR serialization for tests, debug output, run snapshots, and XState projection. This is not a workflow file import/export product surface.

```ts
const definition = workflowBuilder.build();
const json = serializeWorkflowForDebug(definition);
```

Deterministic serialization/projection tests are required for:

- one-node workflows
- mixed node workflows
- nested workflows
- adapter edges
- human approval nodes
- state policies
- XState projection

## UI Metadata

The IR can include optional UI hints.

```ts
type WorkflowUiMetadata = {
  layout?: "auto" | "manual";
  positions?: Record<NodeId, { x: number; y: number }>;
  collapsed?: NodeId[];
  color?: string;
  icon?: string;
};
```

Rules:

- UI metadata must not affect execution.
- UI metadata should survive registry load, compilation, and projection.
- XState projection may include UI metadata as annotations.

## API Surface for V1

Recommended public functions:

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

Recommended utility types:

```ts
type WorkflowInputFrom<TWorkflow extends { input: WorkflowPort }> = InferPortValue<TWorkflow["input"]>;
type WorkflowOutputFrom<TWorkflow extends { output: WorkflowPort }> = InferPortValue<TWorkflow["output"]>;
type NodeInputFrom<TNode extends { input?: WorkflowPort }> = InferPortValue<TNode["input"]>;
type NodeOutputFrom<TNode extends { output?: WorkflowPort }> = InferPortValue<TNode["output"]>;
type WorkflowSnapshotFrom<TWorkflow> = WorkflowMachineSnapshot<
  WorkflowInputFrom<TWorkflow>,
  WorkflowOutputFrom<TWorkflow>
>;
```

These names mirror XState's useful utility-type pattern, but Pibo should keep the implementations simpler and tied to ports. Avoid exposing runtime internals in the authoring API.

## What to Defer

- Inline TypeScript code in workflow definitions.
- General-purpose arbitrary reducers.
- Automatic LLM schema conversion.
- Full visual editing API.
- Complex cyclic superstep semantics.
- Multi-runtime node types beyond Pibo Runtime.
- Arbitrary shell/script nodes as a first-class V1 primitive; use registered TypeScript handlers first.

## Acceptance Criteria for the API

- A one-node Agent workflow is under 15 lines in builder form.
- A mixed workflow can be expressed without dropping into runtime internals.
- Incompatible interfaces produce a clear diagnostic with a fix hint.
- Every builder-created workflow builds canonical IR.
- Every object definition validates into equivalent canonical IR.
- Agents can read and edit TypeScript object definitions without needing builder semantics.
- V1 has no workflow file import/export product surface; serialization is debug/internal only.
- Human approval nodes create durable wait tokens and resume with validated data.
