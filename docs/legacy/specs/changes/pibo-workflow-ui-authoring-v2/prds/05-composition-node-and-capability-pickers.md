# PRD: Pibo Workflow UI Authoring V2 — Composition, Nodes, and Capability Pickers

**Status:** Draft  
**Created:** 2026-05-11  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `README.md`

## 1. Executive Summary

- **Problem Statement**: Workflow authoring must let users compose useful processes while preventing the UI from becoming an arbitrary code execution surface.
- **Proposed Solution**: Allow visual composition of existing registered capabilities through Agent, code, workflow, adapter, and human nodes; typed edges; compatible adapter selection; guard selection; simple state mapping controls; and nested workflow references.
- **Success Criteria**:
  - SC-01: The builder supports node kinds `agent`, `code`, `workflow`, `adapter`, and `human`.
  - SC-02: Code, adapter, guard, and nested workflow references can only select registered catalog entries.
  - SC-03: Incompatible ports require an explicit registered adapter as an edge adapter or inserted adapter node.
  - SC-04: Guard and adapter parameters are editable only when registry metadata includes `paramsSchema`.
  - SC-05: Nested workflow nodes reference workflow id/version and open the nested workflow separately; V2 does not inline-expand nested internals.

## 2. User Experience & Functionality

- **User Personas**:
  - Workflow author composing registered capabilities.
  - Agent profile owner controlling profile availability.
  - Developer registering handlers, adapters, guards, and human actions.
  - Reviewer verifying no UI path creates executable code.

- **User Stories**:
  - As a workflow author, I want to choose an Agent profile for an agent node so that it runs with known tools, skills, and context.
  - As a workflow author, I want to use registered code handlers and adapters so that non-agent work is reusable and inspectable.
  - As a workflow author, I want a compatible adapter dialog so that I can fix schema mismatches intentionally.
  - As a workflow author, I want to reference nested workflows and open them separately so that parent graphs stay readable.
  - As a reviewer, I want the UI to reject inline TypeScript so that users cannot bypass Pibo execution boundaries.

- **Acceptance Criteria**:
  - Agent nodes select non-archived private, custom, or global Agent Designer profiles and support prompt template editing.
  - Code nodes select registered handlers only.
  - Workflow nodes select a workflow id/version and provide “Open workflow” navigation.
  - Adapter nodes select registered adapters only.
  - Human nodes edit prompt, raw JSON resume schema, registered human action choices, and timeout.
  - Missing or invalid human action refs show diagnostics and block publish/run when they affect executable behavior.
  - Edges support source/target ports, kind, guard refs, adapter refs, and validation diagnostics.
  - Adapter dialog shows from/to port schema, compatible adapters, adapter details, and actions: use as edge adapter or insert adapter node.
  - State mappings support simple global/local/edge reads/writes through dropdowns; complex mappings are raw IR only.

- **Non-Goals**:
  - Creating new handlers, adapters, guards, or arbitrary code from the UI.
  - Hidden LLM coercion between incompatible schemas.
  - Inline TypeScript, JavaScript, shell, or eval nodes.
  - Inline expansion/editing of nested workflow internals in a parent graph.
  - Visual editor for complex state mapping DSLs in V2.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Agent Designer profile picker excluding archived profiles.
  - Workflow Registry picker metadata for handlers, adapters, guards, human actions, workflows, prompt assets, and params schemas.
  - Human action registry metadata for available action kinds, labels, payload requirements, and missing-action diagnostics.
  - Port compatibility checker and adapter compatibility discovery.
  - JSON Schema subset validator for node schemas, adapter/guard params, and human resume payloads.

- **Evaluation Strategy**:
  - Positive tests cover each node kind, profile selection, registered handler/adapter/guard selection, nested workflow selection, and compatible adapter insertion.
  - Negative tests cover archived profile selection, missing refs, incompatible edge without adapter, invalid adapter params, invalid guard params, and inline code attempts.
  - State tests cover visual simple read/write mapping and raw-IR-only complex mapping.

## 4. Technical Specifications

- **Architecture Overview**:
  - Composition UI edits registered refs in Pibo Workflow IR.
  - Registry metadata drives picker choices, descriptions, schemas, and parameter editors.
  - Validation checks refs, port compatibility, adapter compatibility, guard params, state mappings, and node-specific required fields.
  - Runtime behavior remains owned by V1 executors and registered implementation refs.

- **Integration Points**:
  - Workflow Registry for handler, adapter, guard, human action, prompt asset, and workflow metadata.
  - Agent Designer/profile service for non-archived profile selection.
  - Workflow validator for graph, refs, schemas, edges, state, and compatibility diagnostics.
  - Workflow Builder graph and inspector panels.

- **Security & Privacy**:
  - UI composition cannot elevate a profile beyond its registered tools, skills, context, auth, or compute-worker policy.
  - Handler/adapter/guard refs expose names and descriptions but not hidden implementation internals.
  - Params, prompts, schemas, and state paths may expose sensitive data and must follow authenticated UI visibility rules.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Agent/code/workflow node selection, basic edge drawing, and missing-ref diagnostics.
  - v1.1: Adapter dialog, guard selection, params schema editing, and human node configuration.
  - v1.2: Simple state read/write editor, nested workflow navigation, and richer compatibility explanations.

- **Technical Risks**:
  - Registered capability metadata is incomplete; mitigate by showing selectable refs without params when `paramsSchema` is absent and by blocking publish on missing required metadata.
  - Users confuse edge adapters with adapter nodes; mitigate with explicit two-action dialog copy and graph visualization.
  - Nested workflow editing becomes too complex; mitigate by reference-only editing and separate “Open workflow” navigation.
