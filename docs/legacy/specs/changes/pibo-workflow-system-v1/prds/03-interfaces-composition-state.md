# PRD: Pibo Workflow System V1 — Interfaces, Composition, Adapters, and State

**Status:** Draft  
**Created:** 2026-05-10  
**Related docs:** `../spec.md`, `../design.md`, `../design-authoring-api.md`, `../design-framework-architecture.md`

## 1. Executive Summary

- **Problem Statement**: Pibo sessions do not expose reusable typed contracts or inspectable data flow, making composition unsafe and dependent on manual copy/paste.
- **Proposed Solution**: Define workflow and node ports, typed edges, explicit registered adapters, guards, joins, state scopes, merge policies, and bounded backtracking rules that the validator and runtime enforce.
- **Success Criteria**:
  - SC-01: Text and JSON ports validate input, node output, adapter output, and workflow output before downstream use or completion.
  - SC-02: Direct edges pass validation only when source and target ports are compatible.
  - SC-03: Incompatible edges fail unless an explicit registered `edgeAdapter` or visible `adapter` node bridges the contracts.
  - SC-04: Local node state is invisible to other nodes unless explicitly mapped to edge payload or global state.
  - SC-05: Free cycles are rejected; guarded back-edges/retry policies with `maxAttempts` pass and fail clearly when exhausted.

## 2. User Experience & Functionality

- **User Personas**:
  - Workflow author designing reusable workflow contracts.
  - Developer writing deterministic adapters and guards.
  - Operator inspecting edge payloads, state, and loop attempts.
  - QA engineer testing schema and graph failures.

- **User Stories**:
  - As a workflow author, I want text and JSON ports so that workflow contracts are explicit.
  - As a developer, I want adapter refs for mismatched interfaces so that transformations are testable.
  - As an operator, I want edge transfers to be inspectable so that I can debug data movement.
  - As a workflow author, I want bounded review/fix loops so that agent work can iterate without unbounded execution.

- **Acceptance Criteria**:
  - `WorkflowPort` supports `{ kind: "text" }` and `{ kind: "json", schema }`.
  - V1 JSON schemas enforce the Structured Outputs/tool-calling subset: supported primitive/container types, object roots for structured outputs, no root `anyOf`, all object fields listed in `required`, and `additionalProperties: false` on objects.
  - Edges identify source and target node/port refs and may include kind, event, guard/condition, join policy, map, state mapping, UI metadata, and adapter.
  - Edge kinds include `data`, `control`, `error`, and `resume`, with explicit tests for payload transfer, recovery routing, and durable resume routing.
  - V1 join policies include `all_success`, `one_success`, `none_failed_min_one_success`, and `all_done`; default ambiguous fan-in is `all_success`.
  - Multiple matching outgoing guarded edges require explicit priority/order or fail validation.
  - Merge policies include `replace`, `append`, `shallowMerge`, and `custom` registered handler; default is `replace`.
  - Concurrent writes to the same global path fail unless a merge policy exists.

- **Non-Goals**:
  - Automatic LLM coercion between incompatible schemas.
  - Declarative mapping DSLs, `sourceOutputAdapter`, or `targetInputAdapter` in V1.
  - Arbitrary reducers beyond the small merge policy set.
  - Advanced Pregel/superstep semantics or unbounded cyclic graphs.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - JSON Schema subset validator.
  - Registry-resolved adapter and guard handlers.
  - Prompt builders and Agent nodes that can consume input, global state, local state, and edge data only as declared.
  - Workflow event/store access for edge transfers and state snapshots.

- **Evaluation Strategy**:
  - Positive tests: text-to-text edge, compatible JSON edge, edge adapter text-to-JSON, visible adapter node, guarded back-edge with max attempts.
  - Negative tests: text input to JSON port, invalid JSON output, incompatible edge without adapter, missing adapter ref, unbounded cycle, undeclared state write, ambiguous concurrent state write.
  - State isolation tests verify that node B cannot read node A local state without explicit exposure.

## 4. Technical Specifications

- **Architecture Overview**:
  - Port validation runs at workflow start, node boundary, adapter boundary, edge transfer, and workflow completion.
  - Graph validation checks node ids, edge refs, direct compatibility, adapter output compatibility, guards, joins, cycles, and loop policies.
  - Runtime treats edge payloads as immutable transfer records and state patches as explicit changes.
  - Backtracking uses explicit back-edges or retry policies that record attempt counts and exhaustion diagnostics.

- **Integration Points**:
  - `src/validation` owns schema subset checks, compatibility checks, cycle checks, adapter checks, and state-policy checks.
  - `src/graph` provides successors, predecessors, in/out edges, traversal, topsort, cycle detection, project/copy/export.
  - `src/runtime` applies state patches and creates edge transfers.
  - `src/store` persists state snapshots and edge payload refs.

- **Security & Privacy**:
  - Adapters must be deterministic registered TypeScript handlers, not hidden agents.
  - Edge payloads and state may contain user/project data and must follow existing storage/privacy rules.
  - State read/write declarations prevent handlers from accessing or mutating undeclared scopes.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: text/json ports, validation, direct edge compatibility, edge transfer records.
  - v1.1: registered edge adapters, visible adapter nodes, guard refs, join policies.
  - v1.2: state read/write declarations, merge policies, bounded loops/back-edges.
  - v2.0: visual editing support, richer mapping DSLs if needed, advanced parallel/cyclic semantics.

- **Technical Risks**:
  - JSON compatibility is too strict and rejects useful workflows; mitigate by allowing explicit adapters when compatibility cannot be proven.
  - State model grows complex; mitigate by enforcing global/local/edge separation and default private local state.
  - Adapters become hidden workflows; mitigate by recommending visible adapter nodes for complex/retryable/reusable mappings.
