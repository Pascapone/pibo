# Design: Workflow Runtime Foundation and Manual Trigger

**Status:** Draft
**Created:** 2026-07-06

## Design Goals

- Keep trigger, node, edge, adapter, guard, and run interfaces stable before adding more UI.
- Reuse `packages/workflows` runtime concepts where possible.
- Keep Chat Web Workflows simple: Play trigger, input, status, result.
- Make every data transformation visible in the graph or edge metadata.
- Avoid implicit full-chat-history handoff.

## Current Implementation Notes

- `packages/workflows` already defines IR types for agent, code, workflow, adapter, and human nodes; ports; edge kinds; adapter refs; guard refs; state; retry; runtime helpers; store contracts; and XState projection.
- Chat Web currently has its own workflow draft/catalog APIs and UI-side graph helpers under `src/apps/chat-ui/src/workflows`.
- Chat Web product routes validate and persist workflow drafts and Project workflow session snapshots.
- Product start currently creates/returns a Project workflow run record; it is not yet wired to a graph executor that dispatches nodes through `packages/workflows`.

## Proposed Runtime Interfaces

The exact TypeScript names can change, but the contract should remain stable.

```ts
type WorkflowRunSource =
  | { kind: "manual.editor"; draftId: string; triggerNodeId: string; actorId: string }
  | { kind: "project.session"; projectId: string; piboSessionId: string; workflowId: string; workflowVersion: string }
  | { kind: "webhook"; webhookId: string }
  | { kind: "cron"; scheduleId: string };

type WorkflowRunRequest = {
  source: WorkflowRunSource;
  definition: JsonObject;
  input: WorkflowValue;
  inputPort?: WorkflowPort;
  idempotencyKey?: string;
  mode: "draft-test" | "project-run" | "external-run";
};

type WorkflowRunStartResult = {
  ok: boolean;
  runId?: string;
  status: "queued" | "running" | "completed" | "waiting" | "failed" | "cancelled" | "blocked";
  diagnostics: WorkflowDraftDiagnostic[];
  output?: WorkflowValue;
};
```

## Trigger Node Shape

Preferred durable shape:

```json
{
  "kind": "trigger",
  "trigger": { "kind": "manual", "mode": "editor" },
  "label": "Manual Start",
  "output": { "kind": "text", "description": "Manual test input" },
  "ui": { "variant": "start" }
}
```

Reasons:

- `kind: "trigger"` leaves room for `trigger.kind = manual | webhook | cron | message | api`.
- The trigger is a node, so normal graph layout, selection, context menu, and edge behavior apply.
- The trigger output is just a port, so edge compatibility and adapters work unchanged.

Open decision: If existing validators prefer a flat node kind, use `kind: "manualTrigger"` short-term and migrate to the nested trigger object before external triggers ship.

## Edge Payload Envelope

Runtime should pass a value plus metadata, not raw sessions:

```ts
type WorkflowEdgePayload = {
  runId: string;
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  producerAttemptId?: string;
  value: WorkflowValue;
  port: WorkflowPort;
  summary?: string;
  metadata?: JsonObject;
};
```

Default behavior:

- Agent output text on a compatible edge becomes downstream input text.
- JSON output on a compatible JSON edge becomes downstream input JSON.
- The linked Pibo Session id is metadata, not input.
- Prompt builders or adapter handlers may read linked session facts only through explicit, policy-checked readers.

## Adapter Contract

Adapters stay deterministic by default:

```ts
type WorkflowAdapterContext = {
  input: WorkflowValue;
  edgePayload?: WorkflowEdgePayload;
  params?: JsonObject;
  state: WorkflowStateReaders;
};

type WorkflowAdapterResult = {
  output: WorkflowValue;
  metadata?: JsonObject;
};
```

Rules:

- Edge adapters are concise transformations tied to one edge.
- Visible adapter nodes are inspectable node attempts.
- Model-based summarization or interpretation is not an adapter; use an agent node.

## Guard and Judge-Agent Contract

Deterministic guard:

```ts
type WorkflowGuardContext = {
  input: WorkflowValue;
  edgePayload: WorkflowEdgePayload;
  params?: JsonObject;
  state: WorkflowStateReaders;
};

type WorkflowGuardResult = boolean | { allowed: boolean; reason?: string; metadata?: JsonObject };
```

Judge-agent pattern:

1. A normal agent node receives context/payload.
2. It emits structured JSON such as `{ "decision": "approved" | "revise" | "abort", "summary": "..." }`.
3. Outgoing edges use guards or route matchers over that explicit output.
4. The run records the judge output and the guard result.

This keeps agentic routing debuggable and prevents hidden LLM logic inside guards.

## Minimal Editor UX

- Add Manual Trigger node as a distinct start-shaped node.
- Show Play on the trigger node when selected/hovered, and in the node inspector.
- Play opens a compact modal/sheet:
  - text area for text input;
  - raw JSON editor for JSON input;
  - Run button;
  - validation errors.
- Runtime feedback uses the existing persistent bottom status bar plus a compact run result panel.
- Do not add a large orchestration dashboard in the first slice.

## Execution Algorithm: First Slice

1. User clicks Manual Trigger Play.
2. UI validates local input shape.
3. UI sends a draft test run request.
4. Server validates draft graph, trigger node, ports, profiles, registry refs.
5. Runtime creates a run record.
6. Runtime records trigger output and transfers it over eligible outgoing edges.
7. Runtime executes downstream agent node(s) through Pibo Session routing.
8. Runtime records node attempts, linked Pibo sessions, edge transfers, output, diagnostics.
9. UI polls/subscribes to run facts and renders status/output.

The first implementation may support only acyclic trigger → agent and trigger → agent → agent paths. The interfaces must not prevent later branching, loops, waits, or retries.

## Validation Gates

Run validation must check:

- valid trigger node id;
- input matches trigger/workflow input port;
- all reached nodes exist;
- all reached edges reference existing nodes;
- direct edges have compatible ports;
- adapters/guards/profiles exist;
- no hidden LLM coercion or inline executable fields;
- unsupported node kinds block execution with diagnostics, not crashes.

## Persistence Choices

The implementation must choose and document one storage path before coding:

1. Integrate `packages/workflows` SQLite store into Chat Web product state.
2. Extend existing Chat Web project workflow tables to cover editor test runs and runtime facts.
3. Add a product-owned workflow run store that maps cleanly to package store contracts.

Preferred direction: reuse package store contracts for runtime facts, while Chat Web catalog/drafts can remain product-owned until a later consolidation.

## Migration / Compatibility

Existing drafts must keep loading. If trigger nodes are absent, old workflows remain valid drafts. The editor may offer "Add manual trigger" as an explicit action instead of mutating existing graphs automatically.

Existing `workflow.ui.positions` and `workflow.ui.edgeRoutes` must remain untouched except for newly added trigger nodes/edges.
