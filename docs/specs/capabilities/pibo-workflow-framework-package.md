# Spec: Pibo Workflow Framework Package

**Status:** Draft
**Created:** 2026-05-11
**Updated:** 2026-05-17
**Controller / Source:** Scheduled Pibo Source Specs Coverage; current workspace code
**Related docs:** [Current workflow docs](../../project/workflows.md), [Workflow runtime foundation and manual trigger](../changes/workflow-runtime-foundation-manual-trigger/spec.md), [Legacy Pibo Workflow System V1](../../legacy/specs/changes/pibo-workflow-system-v1/spec.md), [Legacy Workflow Runtime Kernel Design](../../legacy/specs/changes/pibo-workflow-system-v1/design-runtime-kernel.md), [Legacy Workflow Structured Outputs JSON Schema Subset](../../legacy/specs/changes/pibo-workflow-system-v1/structured-outputs-json-schema-subset.md), [Chat Web Workflow Session View](./chat-web-workflow-session-view.md)

## Why

Pibo now contains a dedicated `packages/workflows` framework package. It defines workflow IR types, authoring helpers, validation, runtime dispatch helpers, persistence, fixtures, XState projection, and inspection utilities. The change specs describe the intended Workflow System V1, but the package boundary also needs a source-backed capability contract for the behavior that current code exposes to other Pibo modules and tests.

Without this contract, future agents can confuse workflow definitions with normal Pibo Sessions, persist workflow facts in the wrong store, or treat XState projection as the durable execution engine instead of an inspectable view over kernel facts.

## Goal

Pibo MUST expose a workflow framework package whose public helpers create validated workflow definitions, resolve registered executable references, run node-level workflow behavior through explicit runtime adapters, persist workflow facts in a workflow-managed SQLite store, and project runs for inspection without replacing Pibo Session or Chat Web sources of truth.

## Background / Current State

`packages/workflows/src/index.ts` re-exports the package submodules and helpers: `types`, `api`, `definition-hash`, `validation`, `runtime`, `store`, `registry`, `fixtures`, `xstate`, and `inspection`. The package is TypeScript-first and keeps executable handlers behind registry ids so persisted workflow definitions and run records can remain serializable.

The current runtime code supports dispatch helpers for Pibo agent nodes, TypeScript code nodes, nested workflow nodes, human wait nodes, adapter nodes, edge transfers, retry decisions, and one-node agent workflow execution. The store code owns `pibo-workflows.sqlite` with workflow-specific tables. Inspection and XState modules derive bounded views from workflow records and definitions.

## Scope

### In Scope

- Public package exports from `packages/workflows/src/index.ts`, including definition hashing.
- Authoring helper behavior for ports, adapter refs, prompt-builder refs, profile selection, and selection policies.
- Workflow registry semantics for definitions, UI published-version records, profiles, handlers, adapters, guards, prompt builders, and human actions.
- Validation behavior for ports, JSON Schema subset, registry refs, graph shape, state access, loops, and runtime values.
- Runtime helper behavior for agent, code, nested workflow, human wait, adapter, retry, and edge-transfer paths.
- Workflow-managed SQLite persistence and list/filter behavior.
- Workflow run inspection and XState/UI model projection.
- Test fixture exports used as package-level behavioral examples.

### Out of Scope

- Chat Web product executor integration, manual editor triggers, webhook/cron triggers, and editor run UI — covered by the workflow runtime foundation and manual trigger change spec.
- The embedded Pi Coding Agent runtime internals — workflow agent nodes call Pibo session routing through an adapter.
- Pibo Session Store, Chat Event Log, or Chat Web Read Model stewardship — workflow stores may link to sessions but do not own them.
- Distributed workflow workers or cross-machine scheduling — current package helpers are local library contracts.

## Requirements

### Requirement: Package exports remain explicit and module-bounded

The package MUST expose workflow framework capabilities through the package root without requiring consumers to import private source files.

#### Current

`packages/workflows/src/index.ts` exports the public submodules, including `definition-hash`, and `packages/workflows/README.md` documents each submodule boundary.

#### Target

Consumers can depend on stable package-level modules while implementation details stay inside the package.

#### Acceptance

- Importing from the package root exposes types, authoring helpers, definition-hash helpers, validation helpers, runtime helpers, store APIs, registry APIs, fixtures, XState projection helpers, and inspection helpers.
- Private implementation files are not required by tests or package consumers.
- New public workflow capability areas are added through a deliberate root export.

#### Scenario: Consumer imports authoring and validation helpers

- GIVEN a package consumer imports `text`, `json`, `fixedProfile`, and `validateWorkflow` from the workflow package root
- WHEN TypeScript resolves the package
- THEN those helpers are available without importing from nested private paths.

### Requirement: Authoring helpers create serializable workflow IR fragments

Authoring helpers MUST return plain data structures that can be embedded in workflow definitions, serialized, validated, and persisted.

#### Current

`text`, `json`, `adapterRef`, `edgeAdapter`, `promptBuilderRef`, `fixedProfile`, and selection-policy helpers return object literals with stable `kind`, `language`, and id fields where relevant.

#### Target

Workflow definitions preserve executable references as ids and never require inline closures inside persisted IR.

#### Acceptance

- Text and JSON port helpers return ports with stable `kind` values.
- Adapter and prompt-builder refs contain the registry id and TypeScript language marker.
- Fixed profile selection records the requested profile id.
- Selection helpers return `inherit`, `only`, `exclude`, or `extend` policies with copied id arrays.
- Helper outputs can be compared or serialized as JSON-compatible workflow definition fragments.

#### Scenario: Adapter edge remains serializable

- GIVEN an author creates `edgeAdapter(adapterRef("normalize.input"), json(schema))`
- WHEN the workflow definition is serialized
- THEN the edge adapter contains only stable reference data and output-port schema, not a handler function.

### Requirement: Registry resolution is deterministic and guarded against accidental overwrite

The workflow registry MUST store executable references and workflow definitions by id, and MUST reject duplicate registrations unless override is explicit.

#### Current

`createWorkflowRegistry` initializes maps for workflows, profiles, handlers, adapters, guards, prompt builders, and human actions. Register helpers throw on duplicates unless `override` is supplied. Definition resolution chooses an exact requested version or the highest lexicographic version when no version is supplied. Published-version registration validates UI source/status, matching id/version, and definition hash before registering the definition.

#### Target

Workflow validation and runtime dispatch can resolve stable ids predictably.

#### Acceptance

- Registering the same handler, adapter, guard, profile, prompt builder, human action, or workflow definition twice without override fails.
- Registering with override replaces the existing entry.
- Resolving a workflow with an explicit version returns only that version.
- Resolving a workflow without a version returns the latest version according to the implemented version ordering.
- Registry entries may carry plugin id, title, description, and tags metadata without changing the registered value.
- Registering a UI published-version record fails unless source/status, id/version, and definition hash are consistent.

#### Scenario: Duplicate handler is rejected

- GIVEN a registry already contains handler `summarize`
- WHEN another handler registers as `summarize` without override
- THEN registration fails and the original handler remains registered.

### Requirement: Validation reports structured diagnostics instead of throwing for invalid definitions

Workflow validation MUST return pass/fail results with diagnostics for invalid schemas, graph links, registry refs, state access, loop policy, and runtime values.

#### Current

`validateWorkflow` delegates to definition validation. Validation helpers return `ValidationResult` or diagnostic arrays with codes, paths, severity, optional node/edge ids, and hints. Value validation checks workflow input, output, global state, node output, and edge adapter output against the supported port contracts.

#### Target

Authors and tests can inspect precise validation failures before runtime dispatch.

#### Acceptance

- Unsupported JSON Schema subset keywords or invalid root schema shape produce error diagnostics.
- Edges that reference missing nodes or incompatible ports produce edge-targeted diagnostics.
- Missing registry refs for handlers, adapters, guards, profiles, prompt builders, or human actions produce diagnostics when registry context is provided.
- Runtime value validation accepts text only for text ports and JSON-compatible values only for JSON ports.
- Validation returns `ok: false` when any error-severity diagnostic exists.

#### Scenario: Missing code handler is diagnosable

- GIVEN a workflow has a TypeScript code node with handler `missing.handler`
- AND the validation registry does not contain that handler
- WHEN validation runs
- THEN the result is not ok
- AND a diagnostic identifies the node and missing handler reference.

### Requirement: Runtime dispatch separates workflow nodes from Pibo Session stewardship

Runtime helpers MUST execute node behavior through explicit adapters and MUST record Pibo Session links as metadata, not as workflow-managed session records.

#### Current

Agent-node runtime helpers accept a `PiboWorkflowSessionRouting` adapter that creates Pibo Sessions, emits message events, subscribes to output events, and can expose runtime status. Code, adapter, nested workflow, human, retry, edge-transfer, and one-node workflow helpers operate on workflow definitions, registry refs, and workflow store interfaces.

#### Target

Workflow runs can orchestrate Pibo-backed agent work without bypassing the Session Router or confusing workflow run ids with Pibo Session ids.

#### Acceptance

- Agent node dispatch resolves a fixed profile before creating or sending to a routed Pibo Session.
- Agent node execution emits a service/actor message through the supplied routing adapter and waits for a matching assistant or error event within the configured timeout.
- Code and adapter node dispatch resolve registered handlers before invoking them.
- Human node dispatch creates a pending wait token instead of fabricating a user decision.
- Nested workflow dispatch records parent run and parent node attempt relationships in the child workflow run input.
- Runtime results include Pibo Session ids only as links or metadata.

#### Scenario: Agent node uses routing adapter

- GIVEN an agent node selects profile `codex`
- AND a routing adapter creates Pibo Sessions
- WHEN the agent node dispatches
- THEN the adapter creates or addresses a Pibo Session
- AND the workflow result records the linked Pibo Session id without writing a Pibo Session record itself.

### Requirement: Retry and edge transfer behavior is explicit and recordable

The workflow runtime MUST make retry decisions, edge data movement, adapter transforms, and transfer records observable through structured results.

#### Current

`decideWorkflowNodeRetry`, `createRetryScheduledNodeAttempt`, `transferWorkflowEdgeData`, `transferWorkflowEdgeAdapterData`, and `recordWorkflowEdgeTransfer` return structured success, failure, retry, exhausted, or none results. Edge-transfer records carry edge id, source/target node ids, payload, status, error, and timestamps.

#### Target

Workflow recovery and inspection can explain why a node retried, why an edge transfer failed, and what payload moved between nodes.

#### Acceptance

- Retry decisions distinguish no policy, non-retryable errors, retry-on mismatch, scheduled retry, and exhausted retries.
- Backoff policies produce deterministic next-attempt availability from the provided current time.
- Direct edge transfer validates target input compatibility and returns failure instead of silently dropping incompatible payloads.
- Adapter edge transfer resolves the adapter, validates adapter output, and returns a structured error on failure.
- Recorded transfers can be saved through the edge-transfer store interface.

#### Scenario: Adapter output is rejected

- GIVEN an edge adapter declares a JSON output port
- WHEN the adapter returns a value that violates that port schema
- THEN edge adapter transfer returns a failure with validation diagnostics
- AND no successful transfer is recorded for that invalid payload.

### Requirement: Workflow persistence uses a workflow-managed SQLite store

Workflow persistence MUST use the workflow package's SQLite schema and MUST keep normal session facts out of workflow fact tables.

#### Current

The store module defines `pibo-workflows.sqlite`, schema version `3`, workflow-specific tables for definition snapshots, workflow identities, drafts, published versions, archive states, delete tombstones, runs, events, attempts, transfers, checkpoints, wakeups, wait tokens, and human actions, list filters, `SqliteWorkflowRunStore`, and `isNormalSessionFactStorageName` to identify names that belong to normal session storage instead of workflow storage.

#### Target

Workflow definitions, catalog/editor records, runs, events, attempts, transfers, checkpoints, wakeups, wait tokens, and human actions persist in a focused store that can link to Pibo Sessions without replacing the Pibo Session Store.

#### Acceptance

- `createWorkflowSqlitePath(baseDirectory)` resolves to `<baseDirectory>/pibo-workflows.sqlite`.
- Store initialization creates the documented workflow tables, including workflow catalog/editor lifecycle tables and runtime fact tables.
- Save/get methods round-trip workflow catalog records, definitions, runs, and related facts through JSON columns where needed.
- List methods honor supported filters and limits.
- Storage names containing normal session fact keywords are identified as non-workflow fact storage names.

#### Scenario: Workflow run round trip

- GIVEN a workflow run with app partition, workflow id/version, input, state, and status
- WHEN the SQLite workflow store saves and reads that run
- THEN the returned run preserves the workflow fields
- AND any linked Pibo Session id remains a link, not a session-store replacement.

### Requirement: Inspection and XState projection are derived views

Inspection and XState helpers MUST derive bounded read models from workflow definitions and persisted run facts, and MUST NOT become the durable execution source of truth.

#### Current

`inspectWorkflowRun` reads a run and optional fact lists with a normalized limit capped at 1000, then returns a summary and included facts. `formatWorkflowRunInspection` emits compact line-oriented diagnostics. XState helpers project workflow nodes, edges, terminal states, actors, actions, delays, context shape, and UI model metadata with schema version constants.

#### Target

Operators and Chat Web can inspect workflow state and render workflow progress while durable truth remains in workflow run records and node/edge facts.

#### Acceptance

- Inspecting a missing run returns `undefined`.
- Inspection limit defaults to 1000 and rejects non-positive limits.
- Inspection summaries count attempts, failed/completed/waiting attempts, pending wait tokens, edge transfers, and events.
- XState projection records `durableTruth: "kernel"` in context shape.
- XState UI models expose node/edge/status information without exposing private payloads by default.

#### Scenario: Failed workflow is explainable

- GIVEN a workflow run failed after a node attempt failed
- WHEN inspection runs for that run
- THEN the summary reports failed node id, failed attempt id, error code/message, counts, and updated timestamp.

### Requirement: Fixtures remain executable behavioral examples

Workflow fixtures MUST exercise the supported V1 workflow shapes and registry references used by tests.

#### Current

The fixtures module exports minimal one-node agent, adapter, human wait, nested workflow, mixed-node, debug serialization, bounded review loop, fixture registry refs, providers, and setup options.

#### Target

Future changes can validate core workflow behavior without inventing ad hoc definitions in every test.

#### Acceptance

- Required fixtures cover agent, adapter, human wait, nested workflow, mixed-node, serialization, and bounded loop examples.
- Fixture registry refs match fixture provider entries.
- Validation tests can validate every required fixture without missing registry references.
- Runtime tests can use fixtures to exercise one-node agent, code, human, nested workflow, retry, state, and edge transfer behavior.

#### Scenario: Required fixtures validate

- GIVEN the fixture provider registry is registered
- WHEN each required workflow fixture is validated
- THEN validation succeeds without missing handler, adapter, profile, prompt-builder, guard, or human-action refs.

## Edge Cases

- Workflow version ordering is currently string-based; authors SHOULD choose sortable version strings when relying on implicit latest-version resolution.
- Runtime helper timeouts and missing output events MUST fail workflow dispatch explicitly rather than hang indefinitely.
- Store list limits constrain returned rows but do not authorize access; callers remain responsible for app-space checks at product boundaries.
- Human wait actions can be submitted after a token has already been resolved; runtime helpers MUST reject stale or non-pending wait tokens.
- XState projection is inspectable metadata. It MUST NOT be used to replay private payloads or infer data that the workflow kernel did not record.

## Constraints

- **Serialization:** Workflow definitions and persisted run facts must remain JSON-compatible except for registered executable ids.
- **Data stewardship:** Workflow stores may link to Pibo Sessions and projects but must not own normal session transcripts, trace rows, or chat room events.
- **Security / Privacy:** Inspection and XState UI models must stay bounded and avoid exposing private payloads by default.
- **Compatibility:** Public exports should change only with matching spec and test updates because other Pibo modules can import the package root.
- **Testability:** Each requirement maps to existing or expected package tests under `packages/workflows/src/testing/`.

## Success Criteria

- [x] SC-001: Package root imports cover all documented public submodules in current package tests.
- [x] SC-002: Authoring helper outputs serialize as workflow IR fragments with stable refs.
- [x] SC-003: Registry tests cover duplicate rejection, override, ref validation, published-version validation, and workflow/profile resolution behavior.
- [x] SC-004: Validation tests cover schema subset, graph links, registry refs, loops, state access, and runtime value validation.
- [x] SC-005: Runtime tests cover agent, code, adapter, human wait, nested workflow, retry, edge transfer, and one-node workflow behavior.
- [x] SC-006: SQLite store tests round-trip workflow catalog/runtime fact tables and prove normal session facts remain out of workflow tables.
- [x] SC-007: Inspection and XState tests prove bounded derived views and `durableTruth: "kernel"` projection semantics.
- [x] SC-008: Fixture tests validate all required fixtures against fixture providers.

## Verification Coverage

This section maps the package contract to current package-level tests so future changes can distinguish implemented behavior from source-inspected expectations.

### Directly Tested

- Root exports are exercised by tests that import authoring, runtime, store, inspection, and XState helpers from `packages/workflows/src/index.ts` through `../index.js`.
- Authoring helpers are covered by `packages/workflows/src/testing/ports.test.ts`.
- Registry registration, duplicate rejection, override, refs, published-version registration, and profile/workflow resolution are covered by `packages/workflows/src/testing/registry.test.ts` and `packages/workflows/src/testing/workflow-published-versions.test.ts`.
- Interface and definition validation are covered by `packages/workflows/src/testing/interface-values.test.ts` and `packages/workflows/src/testing/validation.test.ts`.
- Runtime dispatch is covered by `runtime-agent-node.test.ts`, `runtime-code-node.test.ts`, `runtime-human-node.test.ts`, `runtime-nested-workflow-node.test.ts`, `runtime-edge-transfer.test.ts`, `runtime-retry-policy.test.ts`, `runtime-one-node-agent.test.ts`, `runtime-mixed-node-workflow.test.ts`, `runtime-prompt-workflows.test.ts`, and `runtime-state-loop-integration.test.ts`.
- Workflow persistence is covered by `workflow-sqlite-schema.test.ts`, `workflow-store-facts.test.ts`, `node-attempt-persistence.test.ts`, `workflow-persistence-validation.test.ts`, `workflow-published-versions.test.ts`, and `workflow-catalog-entities.test.ts`.
- Inspection and XState projection are covered by `workflow-run-inspection.test.ts`, `xstate-shape.test.ts`, `xstate-ui-model.test.ts`, and `xstate-projection-snapshots.test.ts`.
- Fixture validation is covered by `validation.test.ts` through the required workflow fixtures.

### Package Test Inventory

The following package-local test files are part of this spec's direct verification basis. They are listed with exact source paths so coverage checks can trace workflow package behavior without treating test artifacts as independent product capabilities.

| Test file | Behavior covered |
|---|---|
| `packages/workflows/src/testing/runtime-agent-node.test.ts` | Agent-node routing adapter dispatch, session links, and correlated output handling. |
| `packages/workflows/src/testing/runtime-code-node.test.ts` | TypeScript code-node handler resolution, output validation, and error reporting. |
| `packages/workflows/src/testing/runtime-edge-transfer.test.ts` | Direct and adapter-backed edge transfer validation and transfer result recording. |
| `packages/workflows/src/testing/runtime-human-node.test.ts` | Human wait token creation, pending state, and submitted action handling. |
| `packages/workflows/src/testing/runtime-mixed-node-workflow.test.ts` | Multi-node workflow execution across supported V1 node shapes. |
| `packages/workflows/src/testing/runtime-nested-workflow-node.test.ts` | Nested workflow dispatch and parent run/node-attempt linkage. |
| `packages/workflows/src/testing/runtime-one-node-agent.test.ts` | Minimal one-node agent workflow execution and result shaping. |
| `packages/workflows/src/testing/runtime-prompt-workflows.test.ts` | Fixed and registry-backed prompt construction behavior. |
| `packages/workflows/src/testing/runtime-retry-policy.test.ts` | Retry eligibility, backoff, exhaustion, and non-retryable failure decisions. |
| `packages/workflows/src/testing/runtime-state-loop-integration.test.ts` | State updates, bounded loop behavior, and repeated node execution safeguards. |
| `packages/workflows/src/testing/node-attempt-persistence.test.ts` | Node-attempt persistence and retrieval semantics. |
| `packages/workflows/src/testing/workflow-persistence-validation.test.ts` | Persisted workflow fact validation across run-related tables. |
| `packages/workflows/src/testing/workflow-published-versions.test.ts` | UI published-version registration, definition hash checks, and immutable published record behavior. |
| `packages/workflows/src/testing/workflow-catalog-entities.test.ts` | Workflow catalog entity shapes shared with Chat Web workflow catalog surfaces. |
| `packages/workflows/src/testing/workflow-run-inspection.test.ts` | Inspection summaries, bounded fact inclusion, and failure explanation output. |
| `packages/workflows/src/testing/workflow-sqlite-schema.test.ts` | SQLite schema initialization, schema version, catalog/runtime tables, and workflow table stewardship. |
| `packages/workflows/src/testing/workflow-store-facts.test.ts` | Workflow run, event, attempt, transfer, checkpoint, wakeup, wait-token, and human-action fact round trips. |
| `packages/workflows/src/testing/xstate-projection-snapshots.test.ts` | XState projection snapshot stability, backed by `packages/workflows/src/testing/__snapshots__/xstate-projection.snap.json`. |
| `packages/workflows/src/testing/xstate-shape.test.ts` | XState-compatible machine shape and kernel-durable-truth metadata. |
| `packages/workflows/src/testing/xstate-ui-model.test.ts` | UI model node, edge, status, and private-payload projection behavior. |

### Source-Inspected Only

- The README module-boundary descriptions are source-inspected as package documentation, not asserted as a rendered documentation test.
- The implicit latest workflow-version ordering is implemented in registry source and partially covered through registry behavior; the exact ordering policy remains a documented edge case rather than a separate version-ordering test.

### Test Gaps

- Add a focused root-export contract test if public exports begin to change frequently.
- Add a named version-ordering test before relying on non-lexicographic version labels in user-authored workflows.

## Assumptions and Open Questions

### Assumptions

- `packages/workflows` is the durable package boundary for Workflow System V1 behavior that has landed in the current workspace.
- The legacy change specs under `docs/legacy/specs/changes/pibo-workflow-system-v1/` remain historical design references. The current product execution expansion is tracked in `docs/specs/changes/workflow-runtime-foundation-manual-trigger/`. This spec records the current package capability contract.
- Product-level controller access checks will be applied by the APIs or UIs that call the workflow package.

### Open Questions

- Should implicit latest-version resolution move from lexicographic ordering to semantic-version ordering before workflows become user-authored?
- Should workflow inspection include an app-space filter at the helper level, or remain a low-level store/read utility?
- Should XState projection snapshots be persisted by the workflow store, or generated on demand from definitions and run facts only?

## Traceability

| Requirement | Scenario / Story | Source Basis | Verification | Status |
|---|---|---|---|---|
| REQ-001 Package exports remain explicit and module-bounded | Consumer imports authoring and validation helpers | `packages/workflows/src/index.ts`, `packages/workflows/README.md` | Imports from `../index.js` across `packages/workflows/src/testing/*.test.ts` | Package-tested |
| REQ-002 Authoring helpers create serializable workflow IR fragments | Adapter edge remains serializable | `packages/workflows/src/api/index.ts`, `packages/workflows/src/types/index.ts` | `packages/workflows/src/testing/ports.test.ts` | Package-tested |
| REQ-003 Registry resolution is deterministic and guarded against accidental overwrite | Duplicate handler is rejected | `packages/workflows/src/registry/index.ts`, `packages/workflows/src/definition-hash.ts` | `packages/workflows/src/testing/registry.test.ts`, `packages/workflows/src/testing/workflow-published-versions.test.ts` | Package-tested |
| REQ-004 Validation reports structured diagnostics instead of throwing for invalid definitions | Missing code handler is diagnosable | `packages/workflows/src/validation/index.ts` | `packages/workflows/src/testing/interface-values.test.ts`, `packages/workflows/src/testing/validation.test.ts` | Package-tested |
| REQ-005 Runtime dispatch separates workflow nodes from Pibo Session stewardship | Agent node uses routing adapter | `packages/workflows/src/runtime/index.ts` | `runtime-agent-node.test.ts`, `runtime-one-node-agent.test.ts`, `runtime-mixed-node-workflow.test.ts` | Package-tested |
| REQ-006 Retry and edge transfer behavior is explicit and recordable | Adapter output is rejected | `packages/workflows/src/runtime/index.ts`, `packages/workflows/src/store/index.ts` | `runtime-edge-transfer.test.ts`, `runtime-retry-policy.test.ts`, `runtime-state-loop-integration.test.ts` | Package-tested |
| REQ-007 Workflow persistence uses a workflow-managed SQLite store | Workflow run round trip | `packages/workflows/src/store/index.ts` | `workflow-sqlite-schema.test.ts`, `workflow-store-facts.test.ts`, `node-attempt-persistence.test.ts`, `workflow-persistence-validation.test.ts` | Package-tested |
| REQ-008 Inspection and XState projection are derived views | Failed workflow is explainable | `packages/workflows/src/inspection/index.ts`, `packages/workflows/src/xstate/index.ts` | `workflow-run-inspection.test.ts`, `xstate-shape.test.ts`, `xstate-ui-model.test.ts`, `xstate-projection-snapshots.test.ts` | Package-tested |
| REQ-009 Fixtures remain executable behavioral examples | Required fixtures validate | `packages/workflows/src/fixtures/index.ts`, `packages/workflows/src/testing/*` | `packages/workflows/src/testing/validation.test.ts` | Package-tested |

## Verification Basis

This spec was derived from current source code in `packages/workflows/README.md`, `packages/workflows/src/index.ts`, `packages/workflows/src/types/index.ts`, `packages/workflows/src/api/index.ts`, `packages/workflows/src/definition-hash.ts`, `packages/workflows/src/registry/index.ts`, `packages/workflows/src/validation/index.ts`, `packages/workflows/src/runtime/index.ts`, `packages/workflows/src/store/index.ts`, `packages/workflows/src/inspection/index.ts`, `packages/workflows/src/xstate/index.ts`, `packages/workflows/src/fixtures/index.ts`, and `packages/workflows/src/testing/*`. Existing specs under `docs/specs/` were inspected first; this file avoids replacing the Workflow System V1 change specs and instead records the source-backed package capability contract now present in the workspace.
