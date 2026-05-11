# Tasks: Pibo Workflow System V1

**Status:** Draft  
**Created:** 2026-05-10  
**Related spec:** `docs/specs/changes/pibo-workflow-system-v1/spec.md`

## 1. Foundation

- [x] 1.1 Create `packages/workflows` with `src/api`, `src/registry`, `src/types`, `src/validation`, `src/graph`, `src/compiler`, `src/runtime`, `src/store`, `src/xstate`, `src/fixtures`, and `src/testing`.
- [x] 1.2 Add TypeScript types for workflow definitions, ports, nodes, edges, registered adapters, run state, human actions, and XState projection.
- [x] 1.3 Add schema validation for workflow definitions using the OpenAI Structured Outputs / tool-calling JSON Schema subset.
- [x] 1.4 Add fixtures for minimal one-node `pibo-agent`, mixed-node, adapter, human-wait, registry, debug-serialization, nested workflow, and bounded back-edge/review-loop definitions.
- [x] 1.5 Add tests that reject malformed definitions.

## 2. Requirement: Workflow interfaces support text and JSON

- [x] 2.1 Add `text` and `json` port support.
- [x] 2.2 Document the OpenAI Structured Outputs / tool-calling JSON Schema subset supported in V1.
- [x] 2.3 Validate workflow input before execution.
- [x] 2.4 Validate node output and workflow output before downstream use or completion.
- [x] 2.5 Test valid and invalid text/JSON inputs and outputs.

## 3. Requirement: Workflow is a first-class runtime unit

- [x] 3.1 Implement a one-node `agent` workflow path.
- [x] 3.2 Ensure the node launches through normal Pibo session routing.
- [x] 3.3 Persist workflow run id, workflow id, version, status, current node, input, and output.
- [x] 3.4 Emit workflow start, node start, node complete, and workflow complete trace events.
- [x] 3.5 Test a single-prompt workflow from start to completion.

## 4. Requirement: Workflows compose through edges

- [x] 4.1 Add edge validation for source and target node existence.
- [x] 4.2 Add direct compatibility checks between source output port and target input port.
- [x] 4.3 Implement edge data transfer.
- [x] 4.4 Record edge transfer events in the workflow run.
- [x] 4.5 Test a two-node workflow where node A output feeds node B input.

## 5. Requirement: Interface adapters are explicit

- [x] 5.1 Add registered TypeScript adapter refs for `edgeAdapter` and visible `adapter` nodes.
- [x] 5.2 Reject incompatible edges without registered adapter refs.
- [x] 5.3 Implement adapter resolution through the Workflow Registry.
- [x] 5.4 Validate adapter output before target node execution.
- [x] 5.5 Test text-to-JSON and JSON-to-text registered adapter cases.

## 6. Requirement: Nodes support TypeScript code, Agent nodes, nested workflows, and human waits

- [x] 6.1 Implement `code` node dispatch using registered TypeScript handlers.
- [x] 6.2 Implement `agent` node dispatch through Pibo Runtime.
- [x] 6.3 Implement `workflow` node dispatch for nested workflows.
- [x] 6.4 Implement `human` node dispatch with durable wait tokens.
- [x] 6.5 Persist node run status for each node kind.
- [x] 6.6 Test a mixed workflow with all five node kinds.

## 7. Requirement: Agent nodes select profiles, tools, skills, and routing like normal sessions

- [x] 7.1 Define Pibo Runtime selection policy with required fixed Agent Designer profile per Agent node.
- [x] 7.2 Resolve the Agent Designer profile before runtime creation.
- [x] 7.3 Record selected agent profile, tools, skills, context, and routing metadata in node run metadata.
- [x] 7.4 Reject workflow definitions that reference unknown fixed agent profiles.
- [x] 7.5 Test fixed Agent Designer profile selection, e.g. `pibo-agent`.

## 8. Requirement: Prompts can be fixed or built at runtime

- [x] 8.1 Implement `promptTemplate` rendering from input and state.
- [x] 8.2 Define `promptBuilder` contract.
- [x] 8.3 Implement prompt builders through registered handlers or TypeScript code nodes.
- [x] 8.4 Record final prompt according to existing trace privacy rules.
- [x] 8.5 Test fixed and variable prompt workflows.

## 9. Requirement: State, data flow, and bounded backtracking are explicit

- [x] 9.1 Add persisted global workflow state.
- [x] 9.2 Add persisted local node state.
- [x] 9.3 Add read/write path declarations for nodes.
- [x] 9.4 Enforce local state isolation by default.
- [x] 9.5 Reject ambiguous concurrent global state writes unless a merge strategy is declared.
- [x] 9.6 Add explicit back-edge/retry policy support with max attempts.
- [x] 9.7 Reject free or unbounded cycles.
- [x] 9.8 Test state read/write isolation, edge data transfer, and bounded review/fix loops.

## 10. Requirement: XState-backed orchestration projection

- [x] 10.1 Add `xstate` as a dependency.
- [x] 10.2 Define the XState machine projection shape.
- [x] 10.3 Map nodes to states.
- [x] 10.4 Map edges to transitions.
- [x] 10.5 Map guards, waits, failures, and final states.
- [x] 10.6 Add deterministic snapshot tests for machine projection.
- [x] 10.7 Expose machine projection to the Web UI Workflow/XState tab and internal tests; do not add an XState CLI command.

## 11. Requirement: Workflow runs persist and trace execution

- [x] 11.1 Design the fresh workflow-specific runtime SQLite schema/store named `pibo-workflows.sqlite`.
- [x] 11.2 Persist workflow runs, workflow events, node attempts, edge transfers, checkpoints, wakeups, wait tokens, and state snapshots.
- [x] 11.3 Keep normal session traces/tool calls/spans/transcripts in the existing session stores.
- [x] 11.4 Link workflow runs to Pibo Sessions and Project Sessions.
- [x] 11.5 Add run inspection through debug CLI or internal API.
- [x] 11.6 Test inspection of completed and failed runs after restart.

## 12. UI / Inspection V1

- [x] 12.1 Add Project UI surface for workflow-backed sessions/runs.
- [x] 12.2 Add dedicated Web UI Workflow/XState tab for visualization.
- [x] 12.3 Show current workflow id and state for workflow-backed sessions.
- [x] 12.4 Show node status list for a workflow run.
- [x] 12.5 Show final output and validation errors.
- [x] 12.6 Add registry-backed extensible human action interface for approve/reject/resume/cancel and future actions.
- [x] 12.7 Defer full workflow creation/editing UI.

## 13. Documentation

- [x] 13.1 Add canonical workflow capability docs after implementation decisions are confirmed.
- [x] 13.2 Document minimal workflow definition examples.
- [x] 13.3 Document interface adapters with examples.
- [x] 13.4 Document XState-backed projection semantics.
- [x] 13.5 Document Workflow Registry, plugin registration, registered TypeScript adapters, prompt assets, routing hints, human actions, and debug serialization.

## 14. Validation

- [x] 14.1 Run `npm run typecheck`.
- [x] 14.2 Run workflow unit tests.
- [x] 14.3 Run persistence tests for completed, failed, waiting, and resumed workflow runs.
- [x] 14.4 Run a manual one-node `pibo-agent` workflow.
- [x] 14.5 Run a manual two-workflow composition with an explicit registered TypeScript adapter.
- [x] 14.6 Run a manual bounded review/fix loop with max attempts.
