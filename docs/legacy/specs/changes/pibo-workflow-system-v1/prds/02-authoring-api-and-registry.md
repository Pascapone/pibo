# PRD: Pibo Workflow System V1 — Authoring API and Workflow Registry

**Status:** Draft  
**Created:** 2026-05-10  
**Related docs:** `../design-authoring-api.md`, `../design-framework-architecture.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: Pibo lacks a developer-facing workflow authoring surface and a registry that can resolve workflow definitions, handlers, adapters, guards, prompt assets, human actions, plugins, and capability metadata.
- **Proposed Solution**: Provide a TypeScript Workflow Framework in `packages/workflows` with object and builder authoring styles, a dedicated Workflow Registry, deterministic IR serialization, and structured validation diagnostics.
- **Success Criteria**:
  - SC-01: A one-node Agent workflow can be authored in builder form in under 15 lines and validates to canonical IR.
  - SC-02: Object and builder definitions for equivalent workflows serialize to equivalent canonical IR in snapshot tests.
  - SC-03: Registry validation rejects unknown workflow ids, handler ids, adapter ids, guard ids, prompt assets, human actions, and statically resolvable profile/tool/skill refs.
  - SC-04: Plugin registration can add at least one workflow, one handler, one adapter, one guard, one prompt asset, and one human action.
  - SC-05: Validation diagnostics are structured and include actionable fix hints for the top V1 authoring failures.

## 2. User Experience & Functionality

- **User Personas**:
  - TypeScript workflow author.
  - Agent modifying workflow object definitions.
  - Plugin developer registering workflow capabilities.
  - QA engineer validating canonical IR and diagnostics.

- **User Stories**:
  - As a developer, I want to define a simple workflow with fluent helpers so that I can start with one prompt.
  - As an agent, I want object definitions so that I can edit workflow code without understanding a fluent builder chain.
  - As a plugin developer, I want registry hooks so that my plugin can publish workflows and implementation refs.
  - As a QA engineer, I want deterministic serialization so that workflow definitions can be snapshot-tested.

- **Acceptance Criteria**:
  - Public API includes `setupWorkflow`, `workflow`, `defineWorkflow`, `provideWorkflow`, `registerWorkflow`, `registerWorkflowHandler`, `registerWorkflowAdapter`, `registerWorkflowGuard`, `registerWorkflowHumanAction`, `registerPluginWorkflows`, `text`, `json`, `template`, `fixedProfile`, `validateWorkflow`, `compileWorkflow`, `serializeWorkflowForDebug`, `projectToXState`, and `resolveWorkflowDefinition`.
  - `setupWorkflow(...)` scopes types, profiles, handlers, guards, adapters, prompt assets, human actions, and capability metadata without storing inline closures in persisted run records.
  - `workflow(id)` builder and `defineWorkflow(id, definition)` object style produce the same normalized IR shape.
  - Registry entries reference implementations by id and resolve them at validation/compile/execution time.
  - Debug serialization is deterministic and explicitly not a V1 workflow file import/export product surface.

- **Non-Goals**:
  - YAML/JSON workflow authoring as a product feature.
  - Arbitrary inline TypeScript code inside persisted workflow definitions.
  - A full UI authoring API in V1.
  - Exposing runtime-kernel internals through the authoring API.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Agent Designer profile lookup for fixed profiles such as `pibo-agent`.
  - Prompt template rendering and prompt asset resolution.
  - Tool/skill/context policy resolution from the selected Agent Designer profile.
  - Structured output/schema validator shared with runtime.

- **Evaluation Strategy**:
  - Snapshot tests for one-node, mixed-node, nested, adapter-edge, human-approval, state-policy, and XState-projection fixtures.
  - Negative tests for missing ids and unsupported definitions.
  - Agent-editability test: object fixture can be changed without builder-specific code and still validates.
  - Diagnostic tests assert code, severity, path/node/edge id, and fix hint.

## 4. Technical Specifications

- **Architecture Overview**:
  - `packages/workflows/src/api` exposes helpers and builders.
  - `src/types` defines Workflow IR, ports, nodes, edges, state, retries, diagnostics, events, and utility types.
  - `src/registry` stores workflow definitions and implementation refs.
  - `src/validation` validates author-facing definitions and registry references.
  - `src/compiler` normalizes definitions into execution plans.
  - `src/graph` provides stable node/edge ids, traversal, predecessor/successor indices, mutation helpers, export/copy/project behavior, and deterministic graph snapshots.
  - `src/fixtures` and `src/testing` support canonical examples and test helpers.
  - Workflow IR metadata includes `useWhen`, `notFor`, `examples`, `tags`, routing hints, prompt asset refs, version, definition hash, and migration metadata when needed.
  - Builder `startAt(...)` and `doneFrom(...)` map to IR `initial` and `final`/output semantics; terminal node output becomes workflow output unless a final mapper is declared.

- **Integration Points**:
  - Pibo plugin system calls `registerPluginWorkflows(pluginId, register)`.
  - Agent profiles, tools, skills, context files, and prompt assets must be resolvable before execution when statically known.
  - `projectToXState` delegates to `src/xstate` but returns a projection, not durable truth.

- **Security & Privacy**:
  - Registry must not execute unknown code while validating definitions; it only resolves registered refs.
  - `provideWorkflow` may override implementations for tests/deployments but must preserve id/version/hash auditability.
  - Prompt assets and templates follow existing trace/privacy behavior when final prompts are recorded.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: object definitions, minimal builder, registry, one-node fixture, deterministic serialization, validation result type.
  - v1.1: plugin registration, prompt assets, utility types, broader diagnostics.
  - v1.2: provide/override support and capability metadata checks.
  - v2.0: UI-backed authoring that edits Pibo IR concepts.

- **Technical Risks**:
  - Builder API hides behavior not present in IR; mitigate by making every builder operation serialize to canonical IR.
  - Registry becomes a global mutable singleton that is hard to test; mitigate with scoped registries and provider overrides.
  - Type complexity grows too fast; mitigate with small utility types tied to ports rather than full XState type exposure.
