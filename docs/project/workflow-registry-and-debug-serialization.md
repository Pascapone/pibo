# Workflow Registry, Plugin Registration, and Debug Serialization

Pibo Workflow System V1 keeps workflow definitions serializable and resolves executable behavior through a scoped Workflow Registry. Use this document when adding registered TypeScript handlers, adapters, prompt builders, routing metadata, human actions, or deterministic debug snapshots.

For the overall workflow capability contract, see `docs/project/workflows.md`.

## Registry role

The Workflow Registry is the trusted lookup boundary between workflow IR and executable TypeScript code. A workflow definition stores stable ids; the registry stores the implementation values behind those ids.

Current registry maps:

| Registry map | Register with | Referenced by |
|---|---|---|
| `workflows` | `registerWorkflowDefinition(...)` | nested `workflow` nodes and workflow selection |
| `profiles` | `registerWorkflowAgentProfile(...)` | `agent` nodes with `fixedProfile(...)` |
| `handlers` | `registerWorkflowHandler(...)` | `code` nodes |
| `adapters` | `registerWorkflowAdapter(...)` | edge adapters and visible `adapter` nodes |
| `guards` | `registerWorkflowGuard(...)` | guarded edges and bounded loop policies |
| `promptBuilders` | `registerWorkflowPromptBuilder(...)` | `agent` nodes with `promptBuilderRef(...)` |
| `humanActions` | `registerWorkflowHumanAction(...)` | `human` nodes and wait-token actions |

Use `createWorkflowRegistry()` for an empty scoped registry, or pass provider maps into `createWorkflowRegistry({ ... })` for fixtures, tests, or plugin assembly. Avoid global mutable registries in tests; construct the registry that each workflow needs and pass it into validation/runtime seams.

## Stable ids and plugin registration pattern

Registry ids should be stable, namespaced strings because they are persisted in definitions, run metadata, wait tokens, events, and inspection output. Prefer ids like:

- `acme.workflows.releaseSummary`
- `acme.handlers.makePlan`
- `acme.adapters.textToTopic`
- `acme.guards.approved`
- `acme.promptBuilders.releaseDraft`
- `acme.humanActions.approveRelease`

Plugin-provided workflow capabilities should expose a small registration function that receives the target `WorkflowRegistry`. The plugin function registers definitions and providers; workflow definitions still contain only ids.

```ts
import {
  createWorkflowRegistry,
  fixedProfile,
  promptBuilderRef,
  registerWorkflowAgentProfile,
  registerWorkflowDefinition,
  registerWorkflowGuard,
  registerWorkflowHandler,
  registerWorkflowHumanAction,
  registerWorkflowPromptBuilder,
  text,
  validateWorkflow,
  type WorkflowDefinition,
  type WorkflowRegistry,
} from "@pasko70/pibo-workflows";

export function registerReleaseWorkflowPlugin(registry: WorkflowRegistry): void {
  registerWorkflowAgentProfile(registry, "pibo-agent", {
    tools: ["read", "bash", "edit", "write"],
    skills: [],
    contextFiles: [],
  });

  registerWorkflowHandler(registry, "acme.handlers.makePlan", ({ input }) => ({
    output: { plan: `Plan for ${JSON.stringify(input)}` },
  }));

  registerWorkflowGuard(registry, "acme.guards.approved", ({ output, input }) => {
    const value = output ?? input;
    return typeof value === "object" && value !== null && "approved" in value && value.approved === true;
  });

  registerWorkflowPromptBuilder(registry, "acme.promptBuilders.releaseDraft", ({ input }) => ({
    prompt: `Draft a release note from: ${JSON.stringify(input)}`,
    metadata: { source: "release-plugin" },
  }));

  registerWorkflowHumanAction(registry, "acme.humanActions.approveRelease", {
    id: "acme.humanActions.approveRelease",
    kind: "approve",
    title: "Approve release",
  });

  const definition = {
    id: "acme.workflows.releaseSummary",
    version: "1.0.0",
    input: text("Release request"),
    output: text("Release summary"),
    initial: "draft",
    final: "draft",
    nodes: {
      draft: {
        kind: "agent",
        runtime: "pibo",
        profile: fixedProfile("pibo-agent"),
        input: text(),
        output: text(),
        promptBuilder: promptBuilderRef("acme.promptBuilders.releaseDraft"),
      },
    },
    edges: {},
    metadata: {
      tags: ["release"],
      promptAssetRefs: ["acme.prompts.releaseDraft.v1"],
      routingHints: { channel: "pibo.workflows" },
    },
  } satisfies WorkflowDefinition;

  const validation = validateWorkflow(definition, { registry });
  if (!validation.ok) {
    throw new Error(validation.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }

  registerWorkflowDefinition(registry, definition);
}

const registry = createWorkflowRegistry();
registerReleaseWorkflowPlugin(registry);
```

Notes:

- Validation resolves registry refs only when a registry is passed to `validateWorkflow(definition, { registry })`.
- Use `{ override: true }` only for controlled tests or deliberate deployment overrides.
- Plugin metadata on registry entries (`pluginId`, `title`, `description`, `tags`) is useful for inspection and future capability catalogs.

## Registered TypeScript adapters

Adapters are deterministic TypeScript transforms. A workflow may reference an adapter either as an edge adapter or as a visible `adapter` node.

```ts
import { adapterRef, edgeAdapter, json, registerWorkflowAdapter, type WorkflowRegistry } from "@pasko70/pibo-workflows";

const topicPort = json({
  type: "object",
  properties: { topic: { type: "string" } },
  required: ["topic"],
  additionalProperties: false,
});

export function registerAdapters(registry: WorkflowRegistry): void {
  registerWorkflowAdapter(registry, "acme.adapters.textToTopic", ({ input }) => ({
    output: { topic: typeof input === "string" ? input.trim() : JSON.stringify(input) },
  }));
}

export const adapterReference = edgeAdapter(adapterRef("acme.adapters.textToTopic"), topicPort);
```

Runtime adapter dispatch validates the source value, executes the registered adapter, and validates the adapter output before downstream execution. Do not hide model-based rewriting inside adapters; represent that as an explicit `agent` node.

## Prompt assets and prompt builders

V1 supports two prompt construction paths for agent nodes:

- `promptTemplate`: fixed template text stored in workflow IR.
- `promptBuilder: promptBuilderRef(id)`: registry-backed TypeScript prompt construction.

Long reusable prompt assets should be referenced by stable ids in `workflow.metadata.promptAssetRefs` and resolved by the prompt-builder implementation or surrounding plugin code. The current registry stores prompt builders, not raw prompt asset bodies.

Prompt builders receive scoped input/state readers and return either a string or `{ prompt, metadata }`. Runtime records the final prompt on node-attempt metadata under existing trace/privacy rules.

```ts
registerWorkflowPromptBuilder(registry, "acme.promptBuilders.draft", ({ input, global }) => ({
  prompt: `Draft from ${JSON.stringify(input)} with goal ${String(global.get("goal") ?? "")}`,
  metadata: { promptAssetRef: "acme.prompts.draft.v1" },
}));
```

Keep prompt builders deterministic over their declared inputs when possible. If a builder depends on plugin configuration, record enough metadata to debug which asset/version was used.

## Routing hints and fixed profile selection

Agent nodes must select a fixed Agent Designer profile in V1:

```ts
profile: fixedProfile("pibo-agent")
```

Runtime profile resolution records selected profile metadata plus effective tools, skills, context files, and session routing on the node attempt. Use node-level `routing` for concrete routing fields such as legacy `appContext` compatibility, `projectId`, `roomId`, `parentSessionId`, and `channel`. Use `workflow.metadata.routingHints` for non-authoritative hints that help plugin/UI selection but do not affect execution by themselves.

Simple chat sessions should remain unbadged unless they are linked to workflow metadata. Workflow-backed sessions should persist workflow run ids through the normal project/session linkage rather than duplicating Pibo/Pi traces in the workflow store.

## Human actions

Human nodes create durable wait tokens and list available registry-backed actions. Built-in kinds are `approve`, `reject`, `resume`, and `cancel`; custom kinds must also be registered before registry-backed validation/runtime use.

```ts
import { json, registerWorkflowHumanAction, type WorkflowRegistry } from "@pasko70/pibo-workflows";

const decisionPort = json({
  type: "object",
  properties: {
    approved: { type: "boolean" },
    notes: { type: ["string", "null"] },
  },
  required: ["approved", "notes"],
  additionalProperties: false,
});

export function registerHumanActions(registry: WorkflowRegistry): void {
  registerWorkflowHumanAction(registry, "acme.humanActions.resumeDecision", {
    id: "acme.humanActions.resumeDecision",
    kind: "resume",
    title: "Resume with decision",
    input: decisionPort,
    output: decisionPort,
  });
}
```

Runtime human-action handling validates token status, availability, action kind, payload schema, and stewardship context before resolving the token. Accepted actions are recorded in `workflow_human_actions`, resolve the wait token, and schedule a human wakeup so resumed waits survive restart.

## Debug serialization

Workflow debug serialization should be deterministic and inspection-oriented. It is not a V1 import/export product surface.

Recommended debug snapshot contents:

1. Canonical workflow definition object.
2. Sorted registry ref summary by map (`profiles`, `handlers`, `adapters`, `guards`, `promptBuilders`, `humanActions`).
3. Validation diagnostics from `validateWorkflow(definition, { registry })`.
4. Projection summary from `projectWorkflowToXStateProjection(definition)` when graph visualization is relevant.
5. Persisted run facts from `inspectWorkflowRun(store, runId)` for runtime debugging.

Keep executable functions, raw private payloads, prompts, and credentials out of normal debug snapshots unless the caller is explicitly authorized for app-space debug access. Store refs and metadata instead of function source.

A small deterministic helper can be kept next to plugin tests:

```ts
import { projectWorkflowToXStateProjection, validateWorkflow, type WorkflowDefinition, type WorkflowRegistry } from "@pasko70/pibo-workflows";

export function serializeWorkflowForDebug(definition: WorkflowDefinition, registry: WorkflowRegistry): string {
  const registryRefs = Object.fromEntries(
    (["profiles", "handlers", "adapters", "guards", "promptBuilders", "humanActions"] as const).map((key) => [
      key,
      [...registry[key].keys()].sort(),
    ]),
  );

  return JSON.stringify(
    sortObject({
      definition,
      registryRefs,
      validation: validateWorkflow(definition, { registry }),
      xstate: projectWorkflowToXStateProjection(definition),
    }),
    null,
    2,
  );
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortObject(item)]));
}
```

For persisted run inspection, prefer the package helpers:

```ts
const inspection = await inspectWorkflowRun(store, runId);
```

Use `formatWorkflowRunInspection(inspection)` for compact text output in CLI/debug surfaces.

## Checklist

Before shipping a workflow/plugin registration:

- Stable ids are namespaced and versioned where needed.
- Workflow definitions contain only serializable IR and registry refs.
- The registry is scoped and passed into validation/runtime seams.
- Adapters, handlers, guards, prompt builders, profiles, and human actions are registered before validation.
- Agent nodes use fixed profiles and record routing metadata through node `routing` or run linkage.
- Human action payloads have JSON/text ports and are validated before resume.
- Debug serialization emits deterministic metadata and avoids raw private payload leakage.
- Tests cover missing refs and at least one successful runtime path for each new executable capability.
