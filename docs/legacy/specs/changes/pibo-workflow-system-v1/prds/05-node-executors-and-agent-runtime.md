# PRD: Pibo Workflow System V1 — Node Executors and Agent Runtime Integration

**Status:** Draft  
**Created:** 2026-05-10  
**Related docs:** `../spec.md`, `../design.md`, `../design-runtime-kernel.md`, `../design-authoring-api.md`

## 1. Executive Summary

- **Problem Statement**: Pibo workflows require multiple node kinds, but each kind must execute through clear, bounded, inspectable contracts without bypassing Pibo Runtime or tool policies.
- **Proposed Solution**: Implement executors for Agent, TypeScript code, nested workflow, adapter, and human nodes, with Agent nodes using normal Pibo Runtime and explicit Agent Designer profiles.
- **Success Criteria**:
  - SC-01: Agent nodes create or attach to routed Pibo Sessions and record profile, tools, skills, context, routing metadata, and session ids.
  - SC-02: Code nodes run only registered TypeScript handlers and reject undeclared state writes.
  - SC-03: Nested workflow nodes create child workflow runs with parent/child trace linkage and isolated child state.
  - SC-04: Adapter execution validates source payload and adapter output and persists adapter attempts.
  - SC-05: Fixed prompts and prompt builders both produce recorded final prompts subject to existing trace/privacy rules.

## 2. User Experience & Functionality

- **User Personas**:
  - Workflow author selecting node kinds.
  - Agent profile owner controlling tools/skills/context.
  - Developer implementing code handlers and adapters.
  - Operator inspecting executor output and failures.

- **User Stories**:
  - As a workflow author, I want an Agent node to use `pibo-agent` or another fixed Agent Designer profile so that behavior is predictable.
  - As a developer, I want code nodes to call registered handlers so that logic is testable and not arbitrary hidden code.
  - As a workflow author, I want nested workflows so that reusable workflows compose without sharing internal state by default.
  - As an operator, I want executor failures to include structured diagnostics and node attempt ids.

- **Acceptance Criteria**:
  - Node kinds supported: `agent`, `code`, `workflow`, `adapter`, `human`.
  - Agent node requires `runtime: "pibo"` and a fixed profile selection in V1.
  - Tools, skills, and context inherit from the selected profile unless explicitly narrowed or extended by allowed node policy.
  - Code handler receives scoped context `{ input, global, local, edge, emit, command }` and returns `{ output, globalPatch?, localPatch?, command? }`.
  - Nested workflow parent sees only child output unless explicit state export is configured.
  - Adapter node and edge adapter implementations are registered deterministic TypeScript handlers.
  - Human node behavior is specified in `06-human-actions-cli-project-ui.md`; executor integration creates durable waits through the kernel.

- **Non-Goals**:
  - Multi-runtime node types beyond Pibo Runtime in V1.
  - Arbitrary shell/script nodes as first-class primitives.
  - Inline code in workflow definitions.
  - Hidden agent-assisted adapters.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Pibo Runtime/session routing for Agent nodes.
  - Agent Designer profile, tool, skill, context, session inheritance, and routing policy resolution.
  - Prompt templates, prompt builders, and prompt assets.
  - Structured output support or validation/fallback capability checks for selected runtime/profile.

- **Evaluation Strategy**:
  - Test fixed Agent profile resolution with `pibo-agent` and unknown profile rejection.
  - Test Agent node records effective tools, skills, context, routing, and session ids.
  - Test promptTemplate and promptBuilder paths with input, global state, local state, and edge data.
  - Test code handler undeclared write rejection.
  - Test nested workflow success and failure propagation.
  - Test adapter transform success, validation failure, and missing adapter ref.

## 4. Technical Specifications

- **Architecture Overview**:
  - Runtime kernel leases attempts and calls executor by node kind.
  - Executor validates input, resolves implementation refs, runs work, validates output, returns result/commands/patches, and emits events.
  - Agent executor starts/resumes Pibo Runtime, constructs prompt, collects text or structured output, and records trace/session links.
  - Code executor calls registered handler with scoped readers/writers.
  - Nested executor starts child workflow run and waits for completion/failure.
  - Adapter executor transforms payloads and records adapter attempt ids.

- **Integration Points**:
  - Agent nodes integrate with session routing, Agent Designer profiles, tools, skills, context files, run-control, and trace events.
  - Code and adapter nodes integrate with Workflow Registry handler/adapters.
  - Nested workflows integrate with Workflow Registry, runtime store, parent/child run ids, checkpoint namespaces, and events.
  - Executor commands include `goto`, `update`, `resume`, `requestHumanInput`, `emitArtifact`, `cancel`, `complete`, `fail`, and `handoff`.
  - Commands are persisted before application; `goto`/`handoff` targets must be allowed or explicitly dynamic, `update` obeys state write policy, `requestHumanInput` creates a durable wait, `complete` validates workflow output, and `fail` persists structured diagnostics.

- **Security & Privacy**:
  - Agent nodes must not grant tools/skills beyond profile and node policy.
  - Code/adapter handlers run inside existing trusted Pibo execution boundaries and cannot mutate runtime internals directly.
  - Prompt recording follows existing privacy rules; sensitive prompt assets must not be overexposed in UI/debug output.
  - Environment policy can be `inherit`, `host`, `worktree`, `docker-worker`, or `remote`; default is `inherit`.
  - Capability validation checks profile existence, tool/skill/context availability, structured-output support or fallback, session resume, timeout, budget, isolation policy, environment policy, and known concurrency limits before execution when possible.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Agent executor for one-node workflow, fixed prompts, profile resolution, output validation.
  - v1.1: code executor, prompt builders, adapter executor, commands and state patches.
  - v1.2: nested workflow executor, environment policies, richer capability validation.
  - v2.0: additional runtime providers or explicit shell/script node types if product need is proven.

- **Technical Risks**:
  - Agent nodes diverge from normal sessions; mitigate by routing through normal Pibo Runtime and recording effective metadata.
  - Code handlers become unsafe generic execution; mitigate with registry refs, trusted boundaries, and no inline code.
  - Nested workflow failure is hard to inspect; mitigate with parent/child linkage and event projection tests.
