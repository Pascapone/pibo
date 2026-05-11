# Workflow Interface Adapters

Interface adapters make data shape changes explicit in Pibo workflows. Direct edges are allowed only when the source node output port is compatible with the target node input port. When the contracts differ, V1 requires a registered deterministic TypeScript adapter referenced from the workflow definition.

Adapters are not hidden schema coercion. The saved workflow IR must show which adapter is used, and the adapter implementation must be resolved through the Workflow Registry.

## When to use an adapter

Use an adapter when any of these are true:

- a text output must feed a JSON input
- a JSON output must be flattened into text
- two JSON ports use different schema contracts
- a downstream node should receive only a selected or normalized subset of upstream output

Do not use an adapter for agentic rewriting. If a model should interpret, rewrite, or infer data, model that work as an explicit `agent` node with a fixed profile.

## Adapter placements

V1 supports two adapter placements.

| Placement | Use when | Workflow visibility |
|---|---|---|
| Edge adapter | The transform is a small deterministic mapping tied to one edge. | The edge stores `adapter: edgeAdapter(adapterRef(...), outputPort)`. |
| Visible `adapter` node | The transform should appear as a node, have its own input/output contract, be reused by multiple edges, or be inspected as a node attempt. | The graph contains a node with `kind: "adapter"`. |

Both placements use the same registry-backed `AdapterHandler` shape:

```ts
import type { AdapterHandler } from "@pasko70/pibo-workflows";

const textToTopic: AdapterHandler<string, { topic: string }> = ({ input }) => ({
  output: { topic: input.trim() },
});
```

The workflow definition stores only a stable adapter id. The handler function stays in trusted TypeScript registration code.

## Edge adapter example: text to JSON

This example connects an agent that emits text to a code node that requires a structured JSON topic payload.

```ts
import {
  adapterRef,
  edgeAdapter,
  json,
  registerWorkflowAdapter,
  text,
  type WorkflowDefinition,
  type WorkflowRegistry,
} from "@pasko70/pibo-workflows";

const topicInput = json({
  type: "object",
  properties: {
    topic: { type: "string" },
  },
  required: ["topic"],
  additionalProperties: false,
});

const summaryOutput = json({
  type: "object",
  properties: {
    summary: { type: "string" },
    status: { type: "string", enum: ["draft", "approved"] },
  },
  required: ["summary", "status"],
  additionalProperties: false,
});

export function registerAdapters(registry: WorkflowRegistry): void {
  registerWorkflowAdapter(registry, "adapters.textToTopic", ({ input }) => ({
    output: { topic: typeof input === "string" ? input : JSON.stringify(input) },
  }));
}

export const textToJsonWorkflow: WorkflowDefinition = {
  id: "examples.text-to-json-adapter",
  version: "1.0.0",
  input: text("User request"),
  output: summaryOutput,
  initial: "collect",
  final: "summarize",
  nodes: {
    collect: {
      kind: "agent",
      runtime: "pibo",
      profile: { kind: "fixed", id: "pibo-agent" },
      input: text(),
      output: text(),
      promptTemplate: "Extract a short topic from: {{input}}",
    },
    summarize: {
      kind: "code",
      language: "typescript",
      handler: "handlers.summarizeTopic",
      input: topicInput,
      output: summaryOutput,
    },
  },
  edges: {
    "collect-to-summarize": {
      id: "collect-to-summarize",
      from: { nodeId: "collect" },
      to: { nodeId: "summarize" },
      kind: "data",
      adapter: edgeAdapter(adapterRef("adapters.textToTopic"), topicInput),
    },
  },
};
```

Without the `adapter` field, validation rejects this edge because a text output cannot directly feed a JSON input. With the adapter, validation checks that the adapter's declared `output` port is compatible with the target node input.

## Visible adapter node example: normalize a human decision

Use a visible adapter node when the transform is important enough to inspect in the graph. This example turns a human decision payload into the normalized summary shape consumed by a nested workflow or publishing node.

```ts
import {
  adapterRef,
  json,
  registerWorkflowAdapter,
  type WorkflowDefinition,
  type WorkflowRegistry,
} from "@pasko70/pibo-workflows";

const reviewDecision = json({
  type: "object",
  properties: {
    approved: { type: "boolean" },
    notes: { type: ["string", "null"] },
  },
  required: ["approved", "notes"],
  additionalProperties: false,
});

const normalizedSummary = json({
  type: "object",
  properties: {
    summary: { type: "string" },
    status: { type: "string", enum: ["approved", "needs_revision"] },
  },
  required: ["summary", "status"],
  additionalProperties: false,
});

export function registerVisibleAdapters(registry: WorkflowRegistry): void {
  registerWorkflowAdapter(registry, "adapters.decisionToSummary", ({ input }) => {
    const decision = input as { approved: boolean; notes: string | null };
    return {
      output: {
        summary: decision.notes ?? "No review notes provided.",
        status: decision.approved ? "approved" : "needs_revision",
      },
    };
  });
}

export const visibleAdapterWorkflow: WorkflowDefinition = {
  id: "examples.visible-adapter-node",
  version: "1.0.0",
  input: normalizedSummary,
  output: normalizedSummary,
  initial: "review",
  final: "normalize",
  nodes: {
    review: {
      kind: "human",
      prompt: "Approve or request changes.",
      input: normalizedSummary,
      output: reviewDecision,
      schema: reviewDecision.schema,
    },
    normalize: {
      kind: "adapter",
      handler: adapterRef("adapters.decisionToSummary"),
      mode: "deterministic",
      input: reviewDecision,
      output: normalizedSummary,
    },
  },
  edges: {
    "review-to-normalize": {
      id: "review-to-normalize",
      from: { nodeId: "review" },
      to: { nodeId: "normalize" },
      kind: "resume",
    },
  },
};
```

The adapter node input and output ports are normal node contracts. Runtime dispatch validates the input before executing the adapter handler and validates the output before it can move downstream.

## Registry and validation checklist

When adding an adapter:

1. Define the source and target ports first.
2. Add the smallest explicit adapter contract that bridges those ports.
3. Register the handler with `registerWorkflowAdapter(registry, id, handler)` or include it in `createWorkflowRegistry({ adapters: { ... } })`.
4. Reference the adapter with `adapterRef(id)`.
5. For edge adapters, wrap the ref with `edgeAdapter(ref, adapterOutputPort)`.
6. Run `validateWorkflow(definition, { registry })` so missing adapter refs and incompatible adapter output ports fail before runtime.
7. Add a runtime test for the adapter's successful output and at least one invalid-output case when the schema is non-trivial.

Useful implementation references:

- Authoring helpers: `packages/workflows/src/api/index.ts`
- Registry functions: `packages/workflows/src/registry/index.ts`
- Positive adapter fixtures: `packages/workflows/src/fixtures/index.ts`
- Runtime transfer tests: `packages/workflows/src/testing/runtime-edge-transfer.test.ts`
- Visible adapter node tests: `packages/workflows/src/testing/runtime-mixed-node-workflow.test.ts`
