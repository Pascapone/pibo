# Design: XState Integration for Pibo Workflows

**Status:** Draft  
**Created:** 2026-05-10  
**Related specs:**

- `docs/specs/changes/pibo-workflow-system-v1/spec.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-framework-architecture.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-authoring-api.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-runtime-kernel.md`

**Research input:**

- `docs/reports/2026-05-10-workflow-research-xstate.md`
- `docs/reports/2026-05-10-workflow-research-archon.md`

## Purpose

This document defines how Pibo should use XState as a V1 dependency without letting XState become Pibo's canonical workflow model. XState is valuable for event-driven orchestration, actor semantics, guards, actions, delays, final states, parallel state visualization, inspection, and future UI editing. Pibo still needs its own Workflow IR and durable runtime kernel because Pibo must own Pibo Runtime sessions, profiles, tools, skills, context, routing, edge payloads, adapters, retries, replay, leases, and long-lived persistence.

## Core Decision

Pibo MUST treat XState as a **projection and local orchestration helper**, not as the source of truth.

```text
Pibo Workflow IR          canonical normalized definition produced by TypeScript code
Pibo Runtime Kernel       durable execution truth
XState Projection         visualization, simulation, inspection, local actor orchestration, future editor
XState Snapshot           optional cached view, not durable truth
```

## What XState Should Do

Use XState for:

- UI run visualization and future editor visualization.
- Interactive orchestration states.
- Guards, actions, delays, and transition semantics.
- Actor modeling for Agent nodes, TypeScript code nodes, nested workflows, and human waits.
- Simulation and path exploration.
- Inspection streams for Chat Web and debugging.
- Local statechart execution for short-lived orchestration slices.

## What XState Should Not Do

Do not use XState as:

- the canonical Workflow IR or TypeScript authoring API.
- the long-term durable persistence format.
- the only replay/resume mechanism.
- the complete audit log for agent/tool execution.
- an implicit adapter system for incompatible workflow ports.
- the place where all global/local/edge state is collapsed into one context blob.

## Mapping: Pibo IR to XState

| Pibo concept | XState representation | Notes |
|---|---|---|
| Workflow definition | Machine | Generated projection. TypeScript-defined Pibo IR remains canonical. |
| Workflow run status | Machine snapshot/status | View over kernel state. |
| Agent node | Invoked actor | Actor backed by Pibo Runtime. |
| TypeScript code node | Action or invoked actor | Prefer invoked actor when async or retryable. |
| Nested workflow node | Invoked child actor/machine | Uses child workflow namespace. |
| Adapter edge | Action or adapter actor | Complex adapters should be visible actors/nodes. |
| Data edge | Transition with payload metadata | Edge payload remains Pibo-owned. |
| Control edge | Transition | Guard maps to XState guard. |
| Error edge | `onError` transition or explicit error transition | Kernel stores failure facts. |
| Human node / wait | Waiting state with resume event | Kernel owns durable wait token. |
| Retry delay | `after`/delay projection | Kernel owns durable retry policy and timer. |
| Global state | Context projection | Do not store all truth only in XState context. |
| Local node state | Actor/local snapshot projection | Kernel owns durable node state. |
| Edge payload | Event payload / metadata | Kernel owns transfer record. |

## Actor Model

Pibo should define a small actor interface inspired by XState, but Pibo-owned.

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
```

XState actors can implement this interface internally, but the public framework should depend on Pibo's actor contract. This keeps Pibo free to execute some actors through Pibo Runtime, some through TypeScript handlers, and some through XState.

## Setup API Pattern

XState's `setup(...)` pattern is useful. Pibo should adopt the idea with a Pibo-specific API.

```ts
const projectWorkflows = setupWorkflow({
  types: {
    input: {} as ProjectBrief,
    output: {} as ProjectResult,
    events: {} as ProjectWorkflowEvent
  },
  profiles: {
    planner: fixedProfile("project-planner"),
    implementer: fixedProfile("implementer")
  },
  actors: {
    runPiboAgent: piboRuntimeActor,
    runSubworkflow: workflowActor
  },
  handlers: {
    normalizePlan,
    extractArtifacts
  },
  guards: {
    testsPassed,
    needsHumanReview
  },
  adapters: {
    textToSummaryInput
  }
});
```

Then define and register workflows inside that typed scope:

```ts
const workflow = projectWorkflows.defineWorkflow("standard-project", ({ agent, code, edge }) => ({
  input: json(ProjectBriefSchema),
  output: json(ProjectResultSchema),
  nodes: [
    agent("plan", { profile: "planner", output: json(ProjectPlanSchema) }),
    code("normalize", { handler: "normalizePlan" })
  ],
  edges: [edge("plan", "normalize")]
}));
```

Rules:

- `setupWorkflow` registers names and types.
- `defineWorkflow` creates IR from TypeScript code.
- `registerWorkflow` publishes workflow definitions to the Workflow Registry.
- `provideWorkflow` can bind or override implementations later.
- Workflow IR stores names/refs, not inline closures.

## Inspection Model

XState treats inspection as first-class. Pibo should do the same.

```ts
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

These events should project to:

- Chat Web live workflow view.
- CLI/debug inspection.
- trace timeline.
- dedicated Web UI Workflow/XState tab.
- persisted event log if needed.

## Snapshot Strategy

Pibo should distinguish three snapshot kinds.

```ts
type WorkflowSnapshotKind =
  | "kernel"      // durable truth
  | "xstate"      // local orchestration projection
  | "ui";         // compact UI view
```

Rules:

- Kernel snapshot is authoritative.
- XState snapshot may be saved for fast rehydration but must be reconstructable from kernel state.
- UI snapshot is lossy and optimized for display.
- Snapshot versions must be recorded.

## Human-in-the-Loop

Human input should be a Pibo durable wait, projected to XState as a waiting state.

```text
Agent node requests review
  -> kernel creates wait token
  -> XState projection enters waiting.review
  -> Chat Web shows human task
  -> user submits resume payload
  -> kernel validates payload
  -> XState receives RESUME event projection
  -> workflow continues
```

Do not model human waits only as callback actors. Callback actors are process-local; Pibo needs durable wait tokens.

## Retry and Delays

XState can display retry and delay states, but Pibo owns the durable policy.

```text
node fails
  -> kernel computes retry decision
  -> kernel stores availableAt
  -> XState projection enters retry_wait
  -> wakeup fires from durable store
  -> kernel schedules next attempt
```

This avoids relying on in-memory timers for long-running workflows.

## Actions and Effects

XState's split between pure transition and effect execution is valuable. Pibo should mimic it.

Rules:

- Validation, transition selection, and retry decisions should be pure.
- Effects should be named actions or executors.
- Inline closures should not be required for persisted workflows.
- Action execution should emit inspection events.

## Guards

Guards should be named and typed.

```ts
type WorkflowGuardRef = {
  name: string;
  params?: Record<string, unknown>;
};
```

Rules:

- Guards must be deterministic when used for durable routing.
- Non-deterministic guards must declare that they are runtime-only.
- Guard results should be persisted when they affect durable routing.
- XState guard names should map to Pibo guard refs.

## Parallel and Final States

XState has strong support for parallel and final states. Pibo V1 should use this in projection, but keep runtime simple.

V1 supports:

- sequential flows
- simple fan-out/fan-in
- explicit final nodes
- explicit failure/cancel states

V1 should defer:

- deep nested parallel statecharts as authoring primitive
- history states
- SCXML-like semantics
- implicit eventless transition cascades beyond simple compiler-generated transitions

## UI Inspection and Future Editing

V1 Chat Web should inspect workflow runs under Projects and provide a dedicated Workflow/XState tab for visualization. Human actions are shown and resolved in the Projects tab for the associated project. Full UI workflow creation/editing is deferred. When editing arrives, the UI should edit Pibo workflow definitions/IR concepts, not raw XState JSON.

XState projection should provide:

- state nodes for display
- transitions for display
- tags, descriptions, meta
- current machine snapshot
- actor/child hierarchy
- guard/action names

Future editing writes back:

- Pibo nodes
- Pibo edges
- Pibo ports
- Pibo adapters
- Pibo retry/guard/action refs
- Pibo UI metadata
- Project-scoped human action state

This keeps workflow editing product-aware and prevents XState internals from leaking into Pibo definitions.

## Cross-Document Rules

All workflow design docs should preserve these rules:

1. Treat XState as the statechart/projection reference and Archon as the product workflow UX reference alongside LangGraphJS, OpenWorkflow, Graphology, and Graphlib.
2. State clearly that XState snapshots are not durable truth.
3. Use the `setupWorkflow(...)` / `provideWorkflow(...)` pattern for typed authoring and late binding.
4. Keep a Pibo-owned actor interface between the kernel and any XState actor implementation.
5. Treat inspection events as first-class workflow events.
6. Represent human-in-the-loop as durable Pibo wait tokens.
7. Treat XState context as a projection of global/local/edge state, not the canonical state model.
8. Let V1 UI inspect workflow runs through Pibo/XState projections; later editing should modify Pibo workflow concepts, not raw XState internals.

## Risks

### Risk: XState semantics leak into Pibo IR

If Pibo stores native XState machines as canonical definitions, Pibo-specific workflow concepts will become hard to express.

**Mitigation:** Store Pibo IR. Generate XState projection.

### Risk: Snapshot persistence is mistaken for durable execution

XState snapshots are useful, but they do not replace node attempts, edge transfers, retries, leases, and audit events.

**Mitigation:** Kernel remains authoritative. XState snapshots are cache/projection.

### Risk: Type complexity grows too fast

XState's typing is powerful but heavy.

**Mitigation:** Use `setupWorkflow` to scope types, but keep public utility types small.

### Risk: Edge payloads disappear into events

XState events can carry payloads, but Pibo needs inspectable edge transfers.

**Mitigation:** Persist edge payloads separately and include transfer refs in projection events.

## Acceptance Criteria

- Pibo can project a workflow to an XState machine without losing node ids, edge ids, guards, waits, final states, and actor refs.
- Pibo can reconstruct UI state from kernel state without requiring an XState snapshot.
- Human waits survive process restart through Pibo wait tokens.
- Retry delays survive process restart through durable wakeups.
- UI editor can modify Pibo nodes/edges/ports/adapters without editing raw XState internals.
- Agent nodes, TypeScript code nodes, nested workflow nodes, and adapter nodes appear as actors or states in the XState projection.
