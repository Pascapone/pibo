# Spec: Pibo Workflow System V1

**Status:** Draft  
**Created:** 2026-05-10  
**Owner / Source:** User request in Pibo Session `ps_5b632938-aa5c-4968-8b38-f9a4e87a3c67`  
**Related docs:**

- `docs/specs/changes/pibo-workflow-system-v1/proposal.md`
- `docs/specs/changes/pibo-workflow-system-v1/design.md`
- `docs/specs/changes/pibo-workflow-system-v1/references.md`
- `docs/specs/changes/pibo-workflow-system-v1/structured-outputs-json-schema-subset.md`
- `docs/reports/2026-05-10-langgraph-xstate-pibo-workflow-plan.md`

## Why

Pibo Sessions already provide the smallest working agent unit: the Pibo Runtime. Pibo workflows should use that routed runtime as the base unit instead of inventing a separate execution model. Users should be able to define a single-prompt workflow, connect workflows together, or build larger graphs with TypeScript code nodes, Agent nodes, nested workflows, state, and typed interfaces.

The system must keep interfaces explicit. A workflow may consume text or structured JSON. It may emit text or structured JSON. Composition should stay possible even when two connected workflows do not naturally agree on shape, but the adaptation layer must be visible and testable.

## Goal

Build a V1 workflow system where Agent nodes, TypeScript code nodes, and nested workflows can be composed through typed edges with explicit state, input, output, and XState-compatible orchestration metadata.

## Background / Current State

Pibo currently has routed sessions, project-related workflow fields, subagent delegation, yielded run control, and trace events. It does not yet have a general workflow definition format, typed workflow interfaces, reusable workflow composition, or an editable graph/state-machine model.

Existing workflow references such as `simple-chat` are useful seeds, but they do not yet express nodes, edges, nested workflows, schema-bound data flow, or interface adaptation.

## Terminology

- **Workflow:** A versioned TypeScript-defined framework construct with input/output contracts, nodes, edges, state rules, and optional nested workflows.
- **Workflow run:** One persisted execution of a workflow definition.
- **Agent node:** A workflow node backed by Pibo Runtime. It uses normal Pibo agent profiles, tools, skills, context, and session routing.
- **TypeScript code node:** A workflow node that executes bounded TypeScript through a registered handler.
- **Nested workflow node:** A node that invokes another workflow as a nested run.
- **Human node:** A node that creates a durable wait token for approval or structured human input.
- **Port:** A workflow or node input/output contract. V1 supports `text` and OpenAI Structured Outputs / tool-calling JSON Schema subset-backed `json` ports.
- **Adapter:** An explicit layer that maps incompatible source output to target input.

## Scope

### In Scope

- Minimal workflow definitions that wrap one Agent node backed by Pibo Runtime.
- Text and OpenAI Structured Outputs / tool-calling JSON Schema subset input contracts.
- Text and OpenAI Structured Outputs / tool-calling JSON Schema subset output contracts.
- Workflow composition through nodes and edges.
- TypeScript code nodes that execute bounded programmatic logic.
- Agent nodes that run like normal Pibo Sessions, including agent profiles, tools, skills, and session routing.
- Nested workflow nodes.
- Human approval/input nodes with durable wait tokens.
- Fixed prompts and variable prompt builders.
- Global workflow state and local node state.
- Edge-carried data.
- Explicit interface adapters for incompatible connected workflows.
- XState-backed machine projection for visualization, inspection, local orchestration, and later editing.
- TypeScript code-defined workflows registered through a dedicated Workflow Registry in `packages/workflows`.
- Plugin modules can register workflows, handlers, adapters, guards, prompt assets, and human actions with the Workflow Registry.
- Persistent workflow-specific runtime records in a fresh dedicated SQLite database named `pibo-workflows.sqlite`.
- Trace events for workflow starts, node starts, transitions, waits, failures, and completion.

### Out of Scope

- A full visual workflow editor — V1 inspects runs in UI; UI creation/editing comes later.
- Workflow YAML/JSON file import/export as a product feature.
- Unbounded arbitrary code execution outside existing Pibo runtime controls.
- Direct LangGraph runtime integration.
- Marketplace packaging for third-party workflow nodes.
- A full workflow package/discovery marketplace.
- Automatic opaque schema conversion with no saved adapter definition.
- Cross-user sharing and permissions beyond existing Pibo local runtime rules.

## Requirements

### Requirement: Workflow is a first-class runtime unit

The system MUST support a workflow definition whose smallest executable unit is a normal Pibo Runtime equivalent to a normal Pibo Session.

#### Current

Normal Pibo Sessions run through Pibo Runtime, but workflows do not yet formalize that runtime as a reusable workflow node.

#### Target

A workflow can be defined with only an id, an input contract, an output contract, and one Agent node.

#### Acceptance

A workflow definition with one Agent node can be loaded, validated, started, traced, and completed without requiring graph-specific configuration beyond the minimal definition.

#### Scenario: Single prompt workflow

- GIVEN a workflow definition with one Agent node and a fixed prompt
- WHEN the workflow is started with text input
- THEN Pibo starts a normal routed Pibo Runtime with the configured agent profile, tools, skills, and session routing
- AND the workflow run records the text input, current node/state, trace linkage, and final text output

### Requirement: Workflow interfaces support text and structured JSON

The system MUST allow each workflow to declare text input, structured JSON input validated by the OpenAI Structured Outputs / tool-calling JSON Schema subset, text output, or structured JSON output validated by the same subset.

#### Current

Pibo Sessions accept prompts and emit text/tool traces. They do not expose reusable workflow input and output contracts.

#### Target

Workflow definitions declare `input` and `output` contracts in TypeScript. JSON contracts reference or embed schemas in the OpenAI Structured Outputs / tool-calling JSON Schema subset. Text contracts accept strings.

#### Acceptance

The validator rejects malformed JSON input for schema-bound workflows and rejects structured outputs that do not match the declared output schema.

#### Scenario: JSON input validation

- GIVEN a workflow whose input contract is a JSON Schema requiring `title`
- WHEN a caller starts the workflow with `{ "body": "missing title" }`
- THEN the workflow run is rejected before node execution
- AND the validation error identifies the missing `title` field

### Requirement: Workflows compose through edges

The system MUST allow one workflow's output to become another workflow's input through an edge.

#### Current

Users can manually copy outputs into new sessions. Pibo does not store or validate this as a workflow edge.

#### Target

A workflow can contain multiple workflow nodes connected by edges. Each edge declares source output, target input, and optional mapping behavior.

#### Acceptance

A completed upstream node can pass its output to a downstream node without user copy/paste. The run log records the edge transfer.

#### Scenario: Output feeds next input

- GIVEN workflow `A` emits JSON matching workflow `B`'s input schema
- WHEN node `A` completes
- THEN the edge transfers the JSON object to node `B`
- AND node `B` starts with that object as input

### Requirement: Interface adapters are explicit

The system MUST allow workflows with incompatible interfaces to connect only through an explicit adapter layer.

#### Current

No adapter concept exists.

#### Target

When an upstream output does not match a downstream input, the definition may declare an adapter. V1 adapters are registered TypeScript adapters only. The workflow definition stores an adapter reference; the implementation is resolved through the Workflow Registry.

Supported V1 adapter placements:

- `edgeAdapter`: maps source output plus global/local state into target input.
- `adapter` node: a visible node that runs a registered TypeScript adapter handler.

`sourceOutputAdapter`, `targetInputAdapter`, declarative mapping DSLs, and hidden agent-assisted adapters are deferred.

The saved workflow definition must show which adapter is used. The connection must make the adaptation explicit and testable.

#### Acceptance

The validator rejects an incompatible edge unless the edge defines a compatible adapter. It accepts the edge when the adapter's output contract matches the target input contract.

#### Scenario: Text output to structured input

- GIVEN workflow `A` emits text
- AND workflow `B` requires JSON `{ "summary": string }`
- WHEN an edge connects `A` to `B` without an adapter
- THEN validation fails
- WHEN the edge references registered TypeScript adapter `adapters.textToSummaryJson`
- THEN validation succeeds

### Requirement: Nodes support TypeScript code, Agent nodes, nested workflows, and human waits

The system MUST support five node kinds: `code`, `agent`, `workflow`, `adapter`, and `human`. A `code` node executes TypeScript. An `agent` node executes a Pibo Runtime. An `adapter` node runs a registered TypeScript adapter. A `human` node creates a durable wait token for approval or structured input.

#### Current

Pibo supports routed runtime sessions and tool execution, but not generic workflow nodes.

#### Target

A workflow graph can mix TypeScript code nodes, Agent nodes, nested workflow nodes, and human approval/input nodes.

#### Acceptance

The validator accepts definitions using all five node kinds. The runtime dispatches each node through the correct executor.

#### Scenario: Mixed workflow

- GIVEN a workflow with a TypeScript code node that normalizes input, an Agent node that performs work, a human approval node, and a nested workflow that reviews the output
- WHEN the workflow runs
- THEN each node receives the declared input shape
- AND each node emits the declared output shape
- AND the run records each node's status

### Requirement: Agent nodes select profiles, tools, skills, and routing like normal sessions

Agent nodes MUST select an explicit Agent Designer profile per node, such as `pibo-agent`, and run that profile through normal Pibo session routing.

#### Current

Normal sessions can run with selected agents/profiles. Workflow nodes do not yet expose that contract.

#### Target

An `agent` node specifies a fixed Agent Designer profile. Tools, skills, and context come from that selected profile unless the node explicitly overrides allowed policy fields.

#### Acceptance

A workflow run records which agent profile, tools, skills, context files, and routing metadata each Agent node used.

#### Scenario: Fixed Agent node

- GIVEN an Agent node configured with a specific agent profile
- WHEN the workflow starts that node
- THEN the created Pibo Runtime uses that agent profile and its configured tools and skills
- AND the node run metadata records the selected agent profile

### Requirement: Prompts can be fixed or built at runtime

Agent nodes MUST support fixed prompts and variable prompts built from workflow input, global state, local state, and edge data.

#### Current

Normal sessions receive user prompts. Workflow-specific prompt generation is not defined.

#### Target

A node can declare either `promptTemplate` or `promptBuilder`. The builder has a declared input and output contract.

#### Acceptance

The runtime records the final prompt sent to the Pibo Runtime, subject to existing trace privacy rules.

#### Scenario: Variable prompt

- GIVEN a node with a prompt builder using `state.projectGoal` and edge input
- WHEN the node starts
- THEN the builder creates the final prompt
- AND the Pibo Runtime receives that prompt

### Requirement: State and data flow are explicit

The system MUST distinguish global workflow state, local node state, edge data, input, and output.

#### Current

Pibo trace events contain execution history, but workflow state is not formalized.

#### Target

Each run has a global state object. Each node run may have local state. Edges carry data from a source to a target. Nodes may read and write only the state scopes allowed by their definition.

#### Acceptance

A workflow run can be resumed from persisted run state and current node state without replaying all trace events.

#### Scenario: Local state does not leak by default

- GIVEN node `A` writes `local.debugNotes`
- WHEN node `B` starts
- THEN node `B` cannot read `A`'s local state unless an edge or state mapping explicitly exposes it

### Requirement: Workflow Registry resolves code-defined workflows and handlers

The system MUST provide a dedicated Workflow Registry in `packages/workflows` for TypeScript-defined workflows, code handlers, registered TypeScript adapter handlers, guard handlers, prompt builders, prompt assets, human actions, and capability metadata. Pibo plugins MUST be able to register entries with this registry.

#### Current

Pibo has plugin and profile registries, but no workflow-specific registry that owns workflow definitions and handler resolution or exposes plugin hooks for workflow registration.

#### Target

Workflow code and plugins register definitions and implementations at startup or module load. Workflow runs start from a registry-resolved workflow id and version.

#### Acceptance

The validator rejects workflows that reference unknown handlers, adapters, guards, nested workflows, profiles, tools, skills, or prompt assets when those references are statically resolvable.

#### Scenario: Missing handler

- GIVEN a workflow with a code node referencing handler `project.normalizePlan`
- AND no such handler is registered
- WHEN the workflow is validated
- THEN validation fails before execution
- AND the diagnostic names the missing handler id

### Requirement: Backtracking is explicit and bounded

The system MUST allow a workflow to return to a prior step only through an explicit back-edge or retry policy with max attempts.

#### Current

Pibo has no workflow graph execution model, so review/fix loops are not formalized.

#### Target

A workflow can model review loops such as `review -> implement` with a guard and max attempts. Free or unbounded cycles are rejected by validation.

#### Acceptance

The validator accepts a guarded back-edge with max attempts and rejects an unbounded cycle. The runtime records each attempt and fails with a clear diagnostic when max attempts are exceeded.

#### Scenario: Review sends work back

- GIVEN a workflow with `implement -> review`
- AND a guarded back-edge `review -> implement` with `maxAttempts: 3`
- WHEN review returns `needsFixes`
- THEN the workflow returns to `implement`
- AND after three failed review cycles the workflow fails with a retry-exhausted diagnostic

### Requirement: XState-backed orchestration projection

The system MUST represent workflow orchestration as an XState-backed machine projection.

#### Current

No machine representation exists for workflow visualization or editing.

#### Target

Each workflow definition can be projected into XState states, transitions, guards, actions, invokes, and final states suitable for visualization, inspection, local orchestration support, and future UI editing.

#### Acceptance

A workflow definition can produce deterministic XState machine configuration. The projection includes node states, edge transitions, waiting states, failure states, and completion states.

#### Scenario: Machine projection

- GIVEN a workflow with three nodes and two edges
- WHEN the system projects the workflow machine
- THEN the export contains one state per executable node
- AND transitions match the workflow edges
- AND terminal success and failure states are present

### Requirement: Workflow runs persist and trace execution

The system MUST persist workflow runs and emit workflow trace events.

#### Current

Pibo has session and trace foundations. Workflow run persistence is not complete for graph execution.

#### Target

Each workflow run records definition id, version, definition hash, status, current node/state, global state, node attempt statuses, edge transfers, workflow events, wait tokens, created time, updated time, and related Pibo Session ids in the workflow-specific store.

#### Acceptance

After process restart, a persisted run can be listed and inspected. Completed runs show final output. Failed runs show failed node and error summary.

#### Scenario: Restart inspection

- GIVEN a workflow run fails during node `implement`
- WHEN the gateway restarts
- THEN the workflow run remains inspectable
- AND the run shows status `failed`, current node `implement`, and the error summary

## Edge Cases

- A workflow receives text input but declares JSON input.
- A workflow emits invalid JSON for a schema-bound output.
- An edge creates a cycle with no wait, guard, or max-iteration rule.
- A nested workflow fails while the parent workflow is running.
- A code node throws an error.
- A prompt builder returns an empty prompt.
- Two parallel branches write the same global state path.
- A workflow definition references a missing agent profile.
- A workflow definition references an unknown nested workflow id.
- A workflow back-edge exceeds its max attempts.
- A persisted run references an old workflow definition version.

## Constraints

- **Compatibility:** Normal Pibo Sessions must continue to work without workflow configuration.
- **Security / Privacy:** TypeScript code nodes and Agent nodes must obey existing Pibo tool, compute-worker, and auth boundaries.
- **Persistence:** Workflow-specific runtime data lives in a dedicated workflow DB/store. Normal session traces, tool calls, spans, transcripts, and session records stay in existing session stores.
- **Performance:** V1 should validate definitions and schemas before execution. Long-running nodes should yield through existing run-control primitives when appropriate.
- **Dependencies:** V1 uses XState as a dependency for projection/local orchestration support, but Pibo's workflow contract and durable runtime records remain Pibo-owned.
- **Simplicity:** A one-node workflow must remain easy to define and inspect.

## Success Criteria

- [ ] SC-001: A single-prompt workflow can run through a normal Pibo Runtime.
- [ ] SC-002: A JSON-input workflow rejects invalid input before execution.
- [ ] SC-003: A JSON-output workflow validates final output before marking the run complete.
- [ ] SC-004: Two workflows can be connected when output and input contracts match.
- [ ] SC-005: Two workflows with mismatched contracts can be connected only with an explicit adapter.
- [ ] SC-006: A workflow can contain TypeScript code nodes, Agent nodes backed by Pibo Runtime, nested workflow nodes, adapter nodes, and human nodes.
- [ ] SC-007: A workflow run persists current node/state, node statuses, edge transfers, wait tokens, events, and final output in the workflow-specific store.
- [ ] SC-008: A workflow can execute a bounded review/fix back-edge and fails clearly when max attempts are exceeded.
- [ ] SC-009: A workflow definition projects to deterministic XState machine configuration.
- [ ] SC-010: Chat Web Project UI and CLI/debug commands can inspect the current workflow state for a run and handle human actions.

## Assumptions and Implementation Defaults

### Assumptions

- The OpenAI Structured Outputs / tool-calling JSON Schema subset is the V1 schema language for structured input and output, including its strict object requirements such as `additionalProperties: false` and required object fields.
- Text contracts are represented as strings, not arbitrary message arrays.
- Workflow definitions are TypeScript code using the Pibo Workflow Framework syntax.
- Workflow definitions and handlers are registered through a dedicated Workflow Registry.
- Plugins can register workflow definitions and implementations through the Workflow Registry.
- Interface adapters are registered TypeScript adapters saved by reference in workflow definitions and are not invisible runtime magic.
- XState is a V1 dependency for projection/local orchestration support, but not the durable source of truth.
- Workflow TypeScript code nodes run inside existing trusted Pibo execution boundaries, not as user-uploaded arbitrary remote code.

### Implementation Defaults

- Internal submodules under `packages/workflows/src`: `api`, `registry`, `types`, `validation`, `graph`, `compiler`, `runtime`, `store`, `xstate`, `fixtures`, and `testing`.
- First implementation fixture: a minimal one-node Agent workflow using Agent Designer profile `pibo-agent`.
- Second fixture after the minimal path: `plan -> approve(human) -> implement(agent) -> review(code) -> back-edge to implement with max attempts`.

### Finalized Decisions

- Workflow package: `packages/workflows`.
- Workflow runtime DB: fresh dedicated SQLite database named `pibo-workflows.sqlite`.
- Plugin integration: Pibo plugins can register workflows, handlers, adapters, guards, prompt assets, and human actions.
- V1 adapters: registered TypeScript adapters only.
- Agent nodes: each Agent node explicitly selects an Agent Designer profile.
- Loops/backtracking: allowed only through explicit back-edges or retry policies with max attempts.
- Human actions: shown in the Projects tab and registered through the Workflow Registry with an extensible action interface.
- CLI: workflow list/validate/run/inspect/approve/reject/resume/cancel; no XState CLI command.
- XState UI: workflow visualization gets its own Web UI tab.
- Internal submodules: `api`, `registry`, `types`, `validation`, `graph`, `compiler`, `runtime`, `store`, `xstate`, `fixtures`, `testing`.

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| Workflow is a first-class runtime unit | Single prompt workflow | `tasks.md` 1, 3 | Pending |
| Workflow interfaces support text and structured JSON | JSON input validation | `tasks.md` 2 | Pending |
| Workflows compose through edges | Output feeds next input | `tasks.md` 4 | Pending |
| Interface adapters are explicit | Text output to structured input | `tasks.md` 5 | Pending |
| Nodes support TypeScript code, Agent nodes, nested workflows, adapter nodes, and human waits | Mixed workflow | `tasks.md` 6 | Pending |
| Agent nodes select profiles, tools, skills, and routing like normal sessions | Fixed Agent node | `tasks.md` 7 | Pending |
| Prompts can be fixed or built at runtime | Variable prompt | `tasks.md` 8 | Pending |
| State and data flow are explicit | Local state does not leak by default | `tasks.md` 9 | Pending |
| Workflow Registry resolves code-defined workflows and handlers | Missing handler | `tasks.md` 1, 6 | Pending |
| Backtracking is explicit and bounded | Review sends work back | `tasks.md` 9, 14 | Pending |
| XState-backed orchestration projection | Machine projection | `tasks.md` 10 | Pending |
| Workflow runs persist and trace execution | Restart inspection | `tasks.md` 11 | Pending |
