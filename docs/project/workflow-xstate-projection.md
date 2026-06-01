# Workflow XState Projection Semantics

Pibo Workflow System V1 uses XState as a deterministic projection for visualization, inspection, and local diagnostics. XState is **not** the canonical workflow IR, the durable runtime state, or an authoring format. The Pibo workflow definition, runtime kernel snapshot, and `pibo-workflows.sqlite` records remain the source of truth.

Use the public helpers from `@pasko70/pibo-workflows`:

- `projectWorkflowToXStateProjection(definition)` creates the versioned machine projection.
- `projectWorkflowNodesToXState(definition)` and `projectWorkflowEdgesToXState(definition)` expose lower-level deterministic slices for tests and diagnostics.
- `createWorkflowXStateUiModel(projection, { snapshot | activeStateIds })` creates the compact model consumed by Chat Web Workflow/XState panels.

## Projection identity and versioning

A workflow projection is identified by:

- `kind: "pibo.workflow.xstateProjection"`
- `schemaVersion: 1`
- workflow `id` and `version`
- `initial`, the XState state id for the first workflow initial node

The UI model uses:

- `kind: "pibo.workflow.xstateUiModel"`
- `schemaVersion: 1`

Treat both schema versions as compatibility contracts. Additive fields are allowed, but consumers should branch on `kind` and `schemaVersion` before interpreting projection records.

## Durable truth and snapshot kinds

The projection advertises three snapshot kinds:

| Snapshot kind | Meaning |
|---|---|
| `kernel` | Authoritative runtime snapshot reconstructed from Pibo workflow kernel/store records. |
| `xstate` | Optional XState-engine snapshot cache for simulation or diagnostics. |
| `ui` | Compact UI snapshot or selected-state view. |

`kernel` is always authoritative. `xstate` and `ui` snapshots must be reconstructable from workflow run facts and must not be required for recovery.

The projected context shape is deliberately metadata-only:

- `durableTruth: "kernel"`
- `global` mirrors declared workflow global state fields
- `local` mirrors declared per-node state access policies
- `edge` mirrors declared edge state mappings
- `exposesPrivatePayloads: false`

Do not store raw inputs, outputs, prompts, edge payloads, wait payloads, or private runtime state in projection context. Use workflow store records and existing trace/privacy rules for authorized debug surfaces.

## State and id mapping

Projection ids are stable and deterministic so snapshot tests and UI links can rely on them.

| Pibo concept | XState projection |
|---|---|
| Node `review` | state id `node.review` |
| Node actor | actor id `workflow.node.review` |
| Retry delay for node `review` | state id `node.review.retryDelay`, delay id `workflow.node.review.retryDelay` |
| Edge `approve` | transition id `workflow.edge.approve.transition` |
| Edge transfer action | action id `workflow.edge.approve.transfer` |
| Node completion action | action id `workflow.node.review.complete` |
| Workflow terminal states | `workflow.completed`, `workflow.failed`, `workflow.cancelled` |

The initial projection state is the first configured initial node. If a workflow definition has an array of initial nodes, V1 projects the first initial node as the XState `initial` state while the kernel remains responsible for durable multi-start orchestration semantics.

## Node projection

Each workflow node becomes an atomic projection state plus an invoked actor record.

| Node kind | Actor source |
|---|---|
| `agent` | `pibo.workflow.actor.agent` |
| `code` | `pibo.workflow.actor.code` |
| `workflow` | `pibo.workflow.actor.workflow` |
| `adapter` | `pibo.workflow.actor.adapter` |
| `human` | `pibo.workflow.actor.human` |

Node state metadata includes the Pibo node id, node kind, actor id, description, tags, and UI metadata. Nested workflow actors also carry child workflow id/version metadata.

Actor input is represented as a reference, normally `{ kind: "nodeInput", nodeId }`, rather than by embedding payload data. The runtime kernel resolves the actual input at execution time.

## Edge and transition projection

Each workflow edge becomes an XState transition from `node.<from.nodeId>` to `node.<to.nodeId>`.

Default event mapping:

| Edge kind | Event |
|---|---|
| data/control or unspecified | `WORKFLOW.NODE.DONE` |
| resume edge | `WORKFLOW.RESUME` |
| error edge | `WORKFLOW.FAIL` |
| custom edge event | the edge's explicit `event` value |

Transition metadata preserves Pibo edge semantics:

- edge id and edge kind
- guard registry ref, when present
- adapter registry ref, when present
- join policy, priority, and UI metadata

Every projected edge has a durable transfer action (`kind: "transferEdge"`). The XState action is descriptive; the runtime kernel still validates ports, applies adapters, records edge transfers, and persists cursor/state changes.

## Guards, actions, and delays

Guards are named by registry ref. Edge guards and bounded-loop guards are indexed in the flat `guards` map so UI and diagnostics can show which registered predicate controls a transition.

Projected actions use stable ids and include `durableEffect: true` when the corresponding behavior must be persisted by the workflow kernel. Current action kinds include:

- `transferEdge`
- `enterWait`
- `resumeWait`
- `scheduleRetry`
- `recordFailure`
- `completeNode`
- `cancelWorkflow`

Projected delays are durable wakeup descriptions, not process-local timers. Current delay kinds are:

- `retry`, created for node/workflow retry policy
- `humanTimeout`, created for human wait timeout policy

A runtime implementation must schedule and recover these through workflow wakeup records, not rely on in-memory XState timers alone.

## Human waits

A `human` node projects to a `wait` state. Its state metadata includes:

- `durable: true`
- `resumeEvent: "WORKFLOW.RESUME"`
- available human action refs
- optional timeout duration

Entering the wait state corresponds to a durable wait token. Exiting the wait state corresponds to a validated human action resolving the token. UI should show the projected wait metadata but should execute human actions through the registry-backed human action API, not by sending raw XState events directly.

## Failures, retries, and terminal states

Every node invoke has an `onError` path. Without retry policy, failures target `workflow.failed` and record failure. With retry policy, failures target `node.<id>.retryDelay`, record failure, and schedule retry.

Retry-delay states have durable delay metadata and transition back to the node state after the configured wakeup. Backoff projection stores the first concrete delay value where possible; the kernel remains responsible for attempt counting, bounded retry decisions, and wakeup persistence.

Workflow `final` nodes receive a completion transition on `WORKFLOW.NODE.DONE` to `workflow.completed`. The terminal states are always available in the projection:

- `workflow.completed`
- `workflow.failed`
- `workflow.cancelled`

## UI model semantics

Chat Web and other UI consumers should use `createWorkflowXStateUiModel(...)`, not raw internal projection maps.

The UI model contains:

- a projection summary with workflow id/version, initial state id, snapshot kinds, durable truth, and privacy flag
- optional `current` information derived from a kernel snapshot or explicit active state ids
- sorted `nodes`, including terminal nodes
- projected `edges`, `actors`, `guards`, `actions`, `delays`, and final state ids

When a `WorkflowMachineSnapshot` is provided:

- completed/failed/cancelled statuses activate the matching terminal state
- snapshots with `current.nodeId` activate `node.<current.nodeId>`
- otherwise the projection initial state is active
- active human wait states report `waiting`
- active retry-delay states report `retry_scheduled`

This keeps browser state derived from durable workflow facts and makes reload/restart behavior independent from any in-memory XState actor.

## Inspection events

Workflow inspection events use Pibo-managed event names, not raw XState internals. The type surface includes events for actor creation, event dispatch, transition, snapshot, action, child workflow output, wait entered, and wait resumed.

Use these events for debugging and trace correlation. Persisted workflow run facts remain the recovery source; inspection streams are auxiliary diagnostics.

## Consumer rules

- Do not author workflows by editing projected XState JSON.
- Do not persist projection context as workflow state.
- Do not expose private payloads through normal UI projection fields.
- Do not depend on XState timers for durable waits or retries.
- Do not infer adapter behavior from projection metadata; run adapters through the Workflow Registry and runtime validation.
- Do preserve stable ids and deterministic ordering in projection tests.

For the overall workflow capability contract, see `docs/project/workflows.md`. For registry-backed executable capabilities, see `docs/project/workflow-interface-adapters.md` and the current package exports in `packages/workflows/src/index.ts`.
