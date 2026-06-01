# Design: Pibo Workflow Runtime Kernel

**Status:** Draft  
**Created:** 2026-05-10  
**Related specs:**

- `docs/specs/changes/pibo-workflow-system-v1/spec.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-framework-architecture.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-authoring-api.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-xstate-integration.md`

## Purpose

This document defines the execution model for Pibo Workflows V1. The runtime kernel should be durable, inspectable, and small. It should execute compiled workflow plans while delegating actual work to node executors: Agent nodes backed by Pibo Runtime, registered TypeScript code nodes, nested workflow nodes, human wait nodes, and adapters.

The kernel should follow OpenWorkflow's strongest lesson: durable execution should persist runs and attempts, then resume by replaying stable boundaries rather than preserving an in-memory JavaScript call stack.

## Runtime Principles

1. **Definition and execution are separate.** Definitions compile into execution plans. Runs execute plans.
2. **Persist at boundaries.** Persist workflow start, node attempt start, node attempt result, edge transfer, wait, retry, failure, and completion.
3. **Replay from persisted facts.** After restart, reconstruct run state from workflow run records, checkpoints, node attempts, and edge transfers.
4. **Node attempts are first-class.** Agent nodes, TypeScript code nodes, nested workflows, and adapters share the same attempt model.
5. **Leases prevent duplicate ownership.** Long work needs leases and heartbeats.
6. **Retry is pure policy.** Retry decisions should be deterministic functions over attempt state and policy.
7. **Events are product facts.** Runtime events drive traces, Chat Web, CLI inspection, and XState projection.
8. **Kernel snapshots are authoritative.** XState snapshots are optional cached projections and must be reconstructable from Pibo state.
9. **No hidden coercion.** Adapters are node/edge executions with persisted inputs, outputs, and errors.
10. **Human waits are durable.** Approval/input waits create persisted tokens and never rely only on process-local callbacks.
11. **Execution environment is workflow-defined.** Workflows can run anywhere by default; host, worktree, Docker worker, or remote choices are explicit workflow/node policies, not a global Workflow System runtime decision.

## Runtime Objects

### Snapshot Kinds

Pibo distinguishes durable kernel snapshots from XState and UI snapshots.

```ts
type WorkflowSnapshotKind = "kernel" | "xstate" | "ui";
```

Rules:

- `kernel` snapshot is durable truth.
- `xstate` snapshot is a cached orchestration/projection view.
- `ui` snapshot is compact and lossy.
- Rehydration must work from kernel records even if XState snapshots are missing.

### WorkflowRun

```ts
type WorkflowRun = {
  id: WorkflowRunId;
  workflowId: string;
  workflowVersion: string;
  ownerScope: string;
  parentRunId?: WorkflowRunId;
  parentNodeAttemptId?: NodeAttemptId;
  piboSessionId?: string;
  projectId?: string;
  environment?: WorkflowExecutionEnvironment;
  status: WorkflowRunStatus;
  current: WorkflowRunCursor;
  input: WorkflowValue;
  output?: WorkflowValue;
  state: WorkflowRunState;
  checkpoint?: WorkflowCheckpointRef;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failedAt?: string;
};

type WorkflowRunStatus =
  | "pending"
  | "running"
  | "waiting"
  | "failed"
  | "completed"
  | "cancelled";
```

### NodeAttempt

```ts
type NodeAttempt = {
  id: NodeAttemptId;
  workflowRunId: WorkflowRunId;
  nodeId: NodeId;
  attempt: number;
  kind: "agent" | "code" | "workflow" | "adapter" | "human";
  status: NodeAttemptStatus;
  input: WorkflowValue;
  output?: WorkflowValue;
  localState?: Record<string, unknown>;
  error?: WorkflowErrorSummary;
  lease?: WorkflowLease;
  startedAt?: string;
  heartbeatAt?: string;
  completedAt?: string;
  failedAt?: string;
  availableAt?: string;
};

type NodeAttemptStatus =
  | "pending"
  | "leased"
  | "running"
  | "waiting"
  | "retry_scheduled"
  | "failed"
  | "completed"
  | "cancelled";
```

### EdgeTransfer

```ts
type EdgeTransfer = {
  id: EdgeTransferId;
  workflowRunId: WorkflowRunId;
  edgeId: EdgeId;
  sourceNodeAttemptId: NodeAttemptId;
  targetNodeId: NodeId;
  status: "pending" | "transferred" | "failed";
  payload: WorkflowValue;
  adapterAttemptId?: NodeAttemptId;
  createdAt: string;
};
```

### WorkflowCheckpoint

```ts
type WorkflowCheckpoint = {
  id: WorkflowCheckpointId;
  workflowRunId: WorkflowRunId;
  namespace: string;
  cursor: WorkflowRunCursor;
  globalState: Record<string, unknown>;
  pendingNodeIds: NodeId[];
  completedNodeIds: NodeId[];
  edgePayloadRefs: EdgeTransferId[];
  createdAt: string;
};
```

Checkpointing should start simple: create checkpoints at workflow start, node completion, wait/interrupt, retry scheduling, and workflow completion.

## Execution Plan

The compiler produces a plan.

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
  xstateProjection: XStateLikeMachine;
};
```

The runtime only executes compiled plans. It does not interpret unchecked definitions.

## Execution Loop

The basic loop:

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

The loop should be resumable after every persisted step.

## Runnable Node Selection

A node is runnable when:

- its input is available
- its incoming dependencies are satisfied
- its guard conditions allow execution
- it is not already completed unless the loop policy permits another iteration
- its `availableAt` time is now or in the past
- it is not leased by another active worker

V1 should support sequential and simple fan-out/fan-in execution. Complex superstep semantics can wait.

## Join Policies

V1 supports simple fan-in semantics inspired by Archon.

```ts
type JoinPolicy =
  | "all_success"
  | "one_success"
  | "none_failed_min_one_success"
  | "all_done";
```

Rules:

- Join decisions are computed from persisted upstream attempt statuses.
- Ambiguous fan-in without a join policy uses `all_success` by default.
- A skipped upstream counts according to the selected policy, not by ad hoc executor logic.
- Join decisions that affect routing are emitted as workflow events or diagnostics.

## Node Executors

### Pibo Actor Contract

Node executors may be represented as actors for XState projection or local orchestration, but the public contract is Pibo-owned.

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

XState actors can implement this internally. The kernel must not depend on raw XState actor internals.

### Agent Executor

The Agent executor starts or resumes a Pibo Runtime.

Responsibilities:

- resolve effective profile, tools, skills, context, and routing
- create or attach to a child Pibo Session
- build the final prompt from template or prompt builder
- send the prompt/input through Pibo session routing
- collect text or structured output
- validate output port
- record session ids and trace links
- handle cancellation and timeout

Result shape:

```ts
type AgentNodeResult = {
  output: WorkflowValue;
  piboSessionId: string;
  piSessionId?: string;
  effectiveProfile: string;
  effectiveTools: string[];
  effectiveSkills: string[];
  commands?: WorkflowCommand[];
};
```

### TypeScript Code Executor

The code executor calls a registered handler.

Responsibilities:

- load handler by id
- validate input
- provide scoped context readers/writers
- enforce state read/write declarations
- record output, patches, commands, and emitted artifacts
- reject undeclared writes

Result shape:

```ts
type CodeNodeResult = {
  output: WorkflowValue;
  globalPatch?: StatePatch;
  localPatch?: StatePatch;
  commands?: WorkflowCommand[];
};
```

### Nested Workflow Executor

The nested workflow executor starts a child workflow run.

Responsibilities:

- validate child workflow availability and version
- create child namespace
- pass input through child workflow input port
- wait for child completion or failure
- map child output to parent node output
- preserve parent/child trace linkage

### Human Wait Executor

The human wait executor creates and resolves durable wait tokens.

Responsibilities:

- persist a wait token before returning control
- expose the wait in Chat Web/CLI inspection
- validate resume payload against the node schema
- record approval, rejection, timeout, or cancellation events
- resume the waiting node or route an error/resume edge

Result shape:

```ts
type HumanNodeResult = {
  output: WorkflowValue;
  waitTokenId: string;
  resumedBy?: string;
  decision?: "approved" | "rejected" | "submitted" | "timed_out";
};
```

### Adapter Executor

An adapter executor transforms payloads.

Responsibilities:

- validate source payload
- run deterministic transform or registered handler
- validate adapter output
- persist transformation attempt
- produce target input payload

Adapters can be edge-local or visible as adapter nodes, but V1 adapter implementations are always registered TypeScript adapters resolved through the Workflow Registry. Complex adapters should be visible nodes.

## State Application

State writes must be explicit.

```text
node result
  -> validate output
  -> validate declared patches
  -> apply merge policy
  -> detect conflicts
  -> persist new state snapshot/checkpoint
```

Merge policy defaults:

| Policy | Use |
|---|---|
| `replace` | Default single-writer update. |
| `append` | Lists, logs, collected findings. |
| `shallowMerge` | Simple object accumulation. |
| `custom` | Registered reducer for advanced cases. |

Conflict rule:

- If two runnable branches write the same path and no merge policy exists, the run fails with a `WorkflowStateConflictError`.

## Execution Environment and Isolation

Workflows can run anywhere Pibo can run. Isolation is workflow/node-specific policy expressed in TypeScript code, not a global Workflow System runtime choice.

```ts
type WorkflowExecutionEnvironment =
  | { kind: "inherit" }
  | { kind: "host" }
  | { kind: "worktree"; path?: string; branch?: string }
  | { kind: "docker-worker"; workerId?: string; worktreePath?: string }
  | { kind: "remote"; id: string };
```

Rules:

- Default is `inherit`: use the caller/project/session environment.
- A workflow or node may request host, worktree, Docker worker, or remote execution.
- The selected effective environment is stored on the run or node attempt for audit/debugging.
- Agent, code, adapter, and nested workflow executors receive the environment through scoped context.
- Cleanup and cancellation must account for environment-owned resources.
- Docker compute workers are useful for workflows that intentionally perform isolated code work, but they are not required for every workflow.

## Runtime Capability Validation

Before execution, the compiler or run starter should validate known runtime capabilities.

Examples:

- selected Agent profile exists
- requested tools, skills, and context files are available
- structured output is supported or has a fallback strategy
- session resume is supported when requested
- timeout, budget, and isolation policy are allowed
- concurrency limits are known for shared providers/runtimes

Capability validation should fail before execution when possible. Runtime-only capability failures should produce structured diagnostics.

## Commands

Executors may return commands.

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

Rules:

- Commands are persisted before they are applied.
- `goto` must target an allowed node unless the node has explicit dynamic routing permission.
- `update` must obey state write policy.
- `requestHumanInput` moves the run or node to `waiting`.
- `resume` validates incoming value before continuing.

## Retry Model

Retry applies to node attempts, adapters, and workflow runs.

```ts
type RetryPolicy = {
  maxAttempts: number;
  backoff: BackoffPolicy;
  retryOn?: string[];
};

type RetryDecision =
  | { kind: "retry"; availableAt: string; reason: string }
  | { kind: "fail"; reason: string };
```

Retry decisions should be pure functions:

```ts
function computeRetryDecision(input: {
  policy: RetryPolicy;
  attempt: NodeAttempt;
  error: WorkflowErrorSummary;
  now: string;
}): RetryDecision;
```

Backoff policies:

- fixed
- linear
- exponential
- none

V1 should persist `availableAt` and let the worker reclaim attempts when ready.

## Replay and Resume

Replay should not re-run completed attempts.

On resume:

1. Load workflow run.
2. Load latest checkpoint.
3. Load completed attempts and edge transfers after checkpoint if needed.
4. Reconstruct global state and runnable queue.
5. Reclaim stale leased attempts if heartbeat expired.
6. Continue from runnable nodes.

This follows OpenWorkflow's durable replay model while staying graph-aware.

## Leases and Heartbeats

A worker claims work through a lease.

```ts
type WorkflowLease = {
  leaseId: string;
  ownerId: string;
  acquiredAt: string;
  expiresAt: string;
};
```

Rules:

- A leased attempt cannot be executed by another worker.
- Long-running Agent nodes heartbeat periodically.
- Expired leases can be reclaimed.
- Reclaimed work must be idempotent at node boundary.

## Idempotency Keys

Every node attempt should have a deterministic idempotency key.

Recommended key components:

- workflow run id
- checkpoint namespace
- graph path
- node id
- attempt number
- loop iteration index, if any

Nested workflow keys include parent run id and parent node attempt id.

## Waits, Wakeups, and Human Actions

A run or node may wait for:

- human input
- child workflow completion
- timeout
- external signal
- scheduled retry
- Pibo Runtime response

Persisted wakeup fields:

```ts
type Wakeup = {
  workflowRunId: WorkflowRunId;
  nodeAttemptId?: NodeAttemptId;
  kind: "human" | "child" | "timeout" | "signal" | "retry" | "runtime";
  availableAt?: string;
  correlationId?: string;
};

type WorkflowHumanAction = {
  kind: "approve" | "reject" | "resume" | "cancel" | string;
  waitTokenId: string;
  payload?: WorkflowValue;
  actor: { kind: "user" | "system" | "agent"; id?: string };
};
```

Wakeups should be stored, not held only in memory. Human-in-the-loop waits must create durable wait tokens. XState may project those waits as waiting states, but the Pibo kernel owns token creation, timeout, validation, and resume.

Human actions should use an extensible registry-backed interface so the Projects tab UI and CLI/debug commands can support `approve`, `reject`, `resume`, `cancel`, and later action kinds without changing the wait-token model.

## Events

Runtime emits workflow events.

```ts
type WorkflowEvent =
  | { type: "workflow.started"; runId: WorkflowRunId }
  | { type: "workflow.waiting"; runId: WorkflowRunId; reason: string }
  | { type: "workflow.completed"; runId: WorkflowRunId }
  | { type: "workflow.failed"; runId: WorkflowRunId; error: WorkflowErrorSummary }
  | { type: "node.started"; runId: WorkflowRunId; nodeId: NodeId; attemptId: NodeAttemptId }
  | { type: "node.completed"; runId: WorkflowRunId; nodeId: NodeId; attemptId: NodeAttemptId }
  | { type: "node.failed"; runId: WorkflowRunId; nodeId: NodeId; attemptId: NodeAttemptId; error: WorkflowErrorSummary }
  | { type: "edge.transferred"; runId: WorkflowRunId; edgeId: EdgeId; transferId: EdgeTransferId }
  | { type: "checkpoint.created"; runId: WorkflowRunId; checkpointId: WorkflowCheckpointId };
```

Events should project to:

- Pibo trace events
- Chat Web workflow state
- CLI/debug inspection
- XState-like current state
- XState-style inspection streams
- durable audit log, if needed

Inspection event families should include actor created, event sent, transition taken, snapshot updated, action executed, child output received, wait entered, and wait resumed.

## Persistence Tables

V1 should use a fresh workflow-specific runtime SQLite database named `pibo-workflows.sqlite`. It stores workflow execution facts only. Normal Pibo/Pi session data such as tool calls, traces, spans, transcript history, and session records remain in the standard session stores.

V1 can start with these logical tables or equivalent store objects:

### `workflow_definition_snapshots`

Optional runtime/audit snapshot of the compiled definition used for a run. This is not the editable source of workflow definitions; source definitions are TypeScript code registered in the Workflow Registry.

- `id`
- `workflow_id`
- `workflow_version`
- `definition_hash`
- `compiled_definition_json`
- `created_at`

### `workflow_runs`

- `id`
- `workflow_id`
- `workflow_version`
- `workflow_definition_hash`
- `definition_snapshot_id`
- `owner_scope`
- `parent_run_id`
- `pibo_session_id`
- `project_id`
- `status`
- `input_json`
- `output_json`
- `state_json`
- `current_json`
- `created_at`
- `updated_at`
- `completed_at`
- `failed_at`

### `workflow_events`

Workflow-specific durable events for run inspection, Project UI, CLI/debug output, and audit. These do not replace normal session traces/tool-call records.

- `id`
- `workflow_run_id`
- `type`
- `node_id`
- `edge_id`
- `attempt_id`
- `payload_json`
- `created_at`

### `workflow_node_attempts`

- `id`
- `workflow_run_id`
- `node_id`
- `attempt_number`
- `kind`
- `status`
- `input_json`
- `output_json`
- `local_state_json`
- `error_json`
- `lease_json`
- `available_at`
- `started_at`
- `heartbeat_at`
- `completed_at`
- `failed_at`

### `workflow_edge_transfers`

- `id`
- `workflow_run_id`
- `edge_id`
- `source_node_attempt_id`
- `target_node_id`
- `payload_json`
- `adapter_attempt_id`
- `status`
- `created_at`

### `workflow_checkpoints`

- `id`
- `workflow_run_id`
- `namespace`
- `cursor_json`
- `state_json`
- `pending_json`
- `created_at`

### `workflow_wakeups`

- `id`
- `workflow_run_id`
- `node_attempt_id`
- `kind`
- `available_at`
- `correlation_id`
- `payload_json`
- `created_at`

### `workflow_wait_tokens`

- `id`
- `workflow_run_id`
- `node_attempt_id`
- `kind`
- `available_actions_json`
- `schema_json`
- `status`
- `resume_payload_json`
- `expires_at`
- `created_at`
- `resolved_at`

### `workflow_human_actions`

- `id`
- `workflow_run_id`
- `wait_token_id`
- `kind`
- `actor_json`
- `payload_json`
- `created_at`

## Failure Handling

Failure should produce structured diagnostics.

Failure paths:

- input validation failure: reject before run starts
- node execution failure: record failed attempt
- adapter failure: record failed adapter attempt
- output validation failure: fail node attempt or route to error edge
- state conflict: fail run unless conflict edge exists
- missing profile/handler/workflow: fail validation before run
- lost lease: reclaim and retry if safe

Error edges can recover:

```ts
.edge("implement.error", "repair.input", { kind: "error" })
```

## Cancellation

Cancellation propagates downward:

```text
parent workflow cancelled
  -> cancel runnable node attempts
  -> cancel active Agent node child sessions when allowed
  -> cancel nested workflow runs
  -> persist cancellation event
```

Cancellation should be best-effort for external processes but exact in Pibo run state.

## XState Projection Runtime State

The runtime should produce a projection for UI:

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

This is not the persistence format. It is a view over runtime state. XState snapshots may be stored as a performance optimization, but they must not be required to recover a workflow run.

## Testing Strategy

Use the reports' strongest test patterns.

### Graphlib / Graphology style

- structure validation
- cycle detection
- IR serialization/debug snapshot roundtrip
- mutation invariants
- projection tests

### OpenWorkflow style

- retry backoff
- lease reclaim
- crash after node completion
- crash after edge transfer
- child workflow completion race
- timeout and wakeup order
- stale heartbeat handling

### LangGraphJS style

- state merge policies
- command routing
- nested workflow namespace
- interrupt/resume
- streaming/event projections

## V1 Execution Scope

Implement now:

- sequential and simple fan-out/fan-in execution
- retries at node boundary
- checkpoint at node boundary and wait boundary
- Agent nodes through Pibo Runtime
- TypeScript code nodes through registered handlers
- nested workflow runs
- edge adapters
- CLI/debug inspection

Defer:

- partial superstep replay
- pending writes
- arbitrary inline code
- distributed multi-worker production scheduler
- full visual editor
- advanced cyclic execution beyond explicit loop policy

## Kernel Acceptance Criteria

- A workflow can resume after process restart without re-running completed node attempts.
- A failed node attempt records a structured error and retry decision.
- An expired lease can be reclaimed safely.
- A nested workflow failure is visible in both child and parent run state.
- A waiting human-input node can resume with validated data.
- Edge transfer payloads are inspectable.
- State conflicts fail with clear diagnostics.
- Runtime events can reconstruct the current workflow status for Chat Web or CLI.
