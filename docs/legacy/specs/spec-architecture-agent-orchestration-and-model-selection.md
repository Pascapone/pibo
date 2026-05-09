---
title: Pibo Agent Orchestration And Model Selection
version: 1.0
date_created: 2026-05-02
last_updated: 2026-05-02
owner: Pibo maintainers
tags: [architecture, agents, subagents, orchestration, worktrees, models]
---

# Introduction

This specification defines the planned Pibo-owned product architecture for stronger subagent context hygiene, optional workflow orchestration above existing subagent and run-control tools, conservative long-running child-session visibility, optional worktree-aware delegated execution, and per-agent model selection that distinguishes main-agent and subagent use.

This is a planning specification. It defines target behavior and constraints. It does not imply that the behavior is already implemented.

## 1. Purpose & Scope

The purpose of this specification is to extend the existing Pibo session-router and custom-agent model without replacing the current product boundary.

This specification covers:

- Child-session context hygiene for routed subagents.
- A Pibo-owned orchestration layer above existing `pibo_subagent_*` and `pibo_run_*` tools.
- Discovery and utility signals for long-running or stuck child work.
- Optional worktree-aware delegated execution that remains compatible with yielded runs.
- Per-agent model selection for main-agent and subagent use in the Agent Designer and runtime contracts.

This specification does not cover:

- Changes to Pi Coding Agent source.
- A second, non-Pibo delegation runtime.
- Mandatory worktree usage for all delegated work.
- Aggressive auto-interruption or automatic child-session cancellation.
- Automatic conversion of every agent interaction into a saved workflow.

## 2. Definitions

- **Child-context hygiene**: Pibo-owned filtering and framing that prevents a delegated child agent from inheriting parent-only orchestration artifacts, hidden control messages, or misleading supervisor context.
- **Parent-only orchestration artifact**: Any message, event, prompt section, or tool history that exists only to help the parent coordinate child work and should not be visible to the child as task context.
- **Workflow**: A reusable Pibo-owned orchestration definition that describes one or more delegated steps, step ordering, optional parallel groups, context rules, and result handoff behavior.
- **Workflow step**: One delegated unit that targets one profile or subagent capability.
- **Parallel group**: A workflow step that runs multiple child tasks concurrently.
- **Workflow launcher**: A Pibo-owned surface that starts a workflow through existing routed subagent and run-control machinery.
- **Attention signal**: A compact product event or status summary indicating that a child run is long-running, idle, or likely blocked.
- **Worktree-aware delegated execution**: Delegated execution where Pibo may assign a child run to a new or existing Git worktree instead of the parent workspace.
- **Main-agent model selection**: The model preference used when an agent profile runs as the top-level selected runtime for a user session.
- **Subagent model selection**: The model preference used when the same agent profile runs as a delegated child session.
- **Default model policy**: The existing product behavior where runtime model selection falls back to the normal Pibo default instead of a per-agent override.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: Pibo MUST keep subagent orchestration as a Pibo-owned product concern and MUST continue to use routed child sessions plus generated `pibo_subagent_*` tools as the execution mechanism.
- **REQ-002**: Pibo MUST NOT introduce a second independent child-agent runtime that bypasses the session router, Pibo Sessions, or run-control tools.
- **REQ-003**: Child-session context hygiene MUST remove or hide parent-only orchestration artifacts before the child runtime prompt is assembled.
- **REQ-004**: Child-session context hygiene MUST add explicit child-session framing that states the child is executing a delegated task and is not the parent orchestrator.
- **REQ-005**: Child-session context hygiene MUST preserve task-relevant user and assistant context needed to complete the delegated task.
- **REQ-006**: Pibo MUST NOT rely only on prompt wording to prevent recursive orchestration drift. The filtered child-visible context MUST also remove parent-only orchestration evidence where possible.
- **REQ-007**: Workflow orchestration MUST be implemented as a higher-level Pibo feature above existing `pibo_subagent_*` and `pibo_run_*` capabilities, not as a replacement for them.
- **REQ-008**: Workflow orchestration MUST support sequential steps and parallel groups.
- **REQ-009**: Workflow orchestration MUST support reusable saved workflow definitions.
- **REQ-010**: Workflow orchestration MAY support agent-composed ad hoc workflows assembled at runtime from existing capabilities, provided the execution still runs through Pibo-native routed sessions and run-control.
- **REQ-011**: Workflow definitions MUST support per-step context mode selection sufficient to express at least fresh child context versus continued child thread reuse.
- **REQ-012**: Workflow definitions MUST support bounded result handoff between steps without forcing full raw transcript injection from one child session into another.
- **REQ-013**: Workflow execution MUST remain compatible with `pibo_run_start` so long-running sequential or parallel child work can still be yielded and later inspected.
- **REQ-014**: Pibo MUST expose compact discovery/status for delegated work that is more informative than only `running` or `completed`.
- **REQ-015**: Attention signals MUST be conservative by default. They MUST inform the parent or UI about possible stuck or long-running work, but MUST NOT automatically fail or cancel healthy long-running child runs.
- **REQ-016**: Attention signals MUST distinguish at least these states: active long-running, no recent visible activity, and terminal failure.
- **REQ-017**: Attention thresholds MUST be configurable in product-owned settings or policy, and defaults MUST be tuned to avoid noisy escalation during normal long-running coding tasks.
- **REQ-018**: Pibo SHOULD expose attention signals to both agent-visible runtime status and human-visible UI/read-model surfaces.
- **REQ-019**: Worktree-aware delegated execution MUST be optional per delegated run or workflow step.
- **REQ-020**: Worktree-aware delegated execution MUST allow Pibo to create a new worktree for a child run or select an existing eligible worktree when explicitly requested.
- **REQ-021**: Worktree-aware delegated execution MUST remain compatible with existing run-control lifecycle, child session routing, and trace visibility.
- **REQ-022**: Worktree-aware delegated execution MUST make the assigned workspace explicit in child-session metadata and operator-visible status.
- **REQ-023**: Worktree-aware delegated execution MUST NOT silently force all subagent work into worktrees.
- **REQ-024**: Pibo MUST extend custom-agent persistence and runtime profile contracts so an agent can define separate model-selection preferences for main-agent use and subagent use.
- **REQ-025**: For both main-agent and subagent model-selection fields, Pibo MUST support a default-policy mode that means "use the normal global/default runtime model".
- **REQ-026**: For both main-agent and subagent model-selection fields, Pibo MUST support an explicit model override mode.
- **REQ-027**: The Agent Designer MUST expose the two model-selection scopes distinctly enough that users can intentionally configure different behavior for the same agent as a top-level runtime versus as a delegated child.
- **REQ-028**: If an agent is launched as a top-level session, Pibo MUST use the main-agent model preference.
- **REQ-029**: If an agent is launched as a routed child session through subagent execution, Pibo MUST use the subagent model preference.
- **REQ-030**: If no explicit model override is configured for the relevant scope, Pibo MUST fall back to the existing default model policy.
- **REQ-031**: The model-selection design MUST apply to the general agent system and Agent Designer, not only to subagents.
- **REQ-032**: Pibo SHOULD allow future extension of each model-selection scope with related runtime preferences such as reasoning level, but V1 MUST keep scope-limited fields minimal if the runtime integration is not already trivial.
- **REQ-033**: Runtime integration for model selection MUST be isolated behind Pibo-owned adapters and MUST NOT require changes to Pi Coding Agent source.
- **CON-001**: Existing direct subagent execution and yielded run behavior must remain valid without using workflows, worktrees, or per-agent model overrides.
- **CON-002**: Existing profile-scoped capability selection for tools, skills, context files, MCP servers, Pi packages, and subagents must remain the source of truth for child capabilities.
- **CON-003**: Workflow orchestration MUST NOT become a hidden auto-planner that silently rewrites normal user prompts into large delegated trees without transparent status.
- **CON-004**: Attention signaling MUST prefer compact summaries over raw transcript injection.
- **CON-005**: Worktree-aware execution MUST respect dirty-worktree safety and MUST NOT rely on destructive Git commands.
- **GUD-001**: Prefer explicit product contracts over prompt-only conventions when child safety or agent-role separation matters.
- **GUD-002**: Keep workflow definitions small and composable. Do not require a broad DAG engine for the first implementation.
- **GUD-003**: Default thresholds for attention signals should err toward under-notifying rather than over-notifying.
- **PAT-001**: Reuse routed child sessions, `pibo_subagent_*` tools, and `pibo_run_*` lifecycle tools instead of adding a parallel orchestration substrate.
- **PAT-002**: Treat worktree assignment as a delegated-run execution option, not as a property of the profile itself.
- **PAT-003**: Treat model selection as a product-level agent/profile policy that resolves before runtime creation.

## 4. Interfaces & Data Contracts

### 4.1 Child Context Hygiene Contract

The product MUST have a Pibo-owned child-context filtering stage before creating a delegated child runtime.

Conceptual contract:

```ts
type PiboChildContextFilterInput = {
  parentPiboSessionId: string;
  childPiboSessionId: string;
  targetProfile: string;
  messages: unknown[];
  systemPrompt: string;
  taskMessage: string;
};

type PiboChildContextFilterOutput = {
  messages: unknown[];
  systemPrompt: string;
  removedArtifactKinds: string[];
};
```

Minimum parent-only artifact classes:

- parent orchestration instructions
- run-control reminder messages
- parent-only subagent launch/result bookkeeping
- synthetic coordination messages that are not part of the delegated task

### 4.2 Workflow Definition Contract

Pibo-owned saved workflow definitions MUST be serializable product state.

```ts
type PiboWorkflowDefinition = {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  steps: PiboWorkflowStep[];
  createdAt: string;
  updatedAt: string;
};

type PiboWorkflowStep =
  | {
      kind: "single";
      targetProfile: string;
      taskTemplate: string;
      contextMode?: "fresh" | "thread";
      yieldMode?: "direct" | "yielded";
      worktree?: PiboDelegatedWorktreePolicy;
    }
  | {
      kind: "parallel";
      tasks: Array<{
        targetProfile: string;
        taskTemplate: string;
        contextMode?: "fresh" | "thread";
        yieldMode?: "direct" | "yielded";
        worktree?: PiboDelegatedWorktreePolicy;
      }>;
    };
```

V1 workflow variable support SHOULD stay narrow. The first useful set is:

```ts
type PiboWorkflowTemplateVariables = {
  userTask: string;
  previousSummary?: string;
  priorRunIds?: string[];
};
```

### 4.3 Delegated Worktree Policy

Delegated execution MAY attach a worktree policy to a step or ad hoc run.

```ts
type PiboDelegatedWorktreePolicy =
  | { mode: "inherit-main-workspace" }
  | { mode: "create-new"; branchNameTemplate?: string }
  | { mode: "reuse-existing"; worktreeId: string }
  | { mode: "agent-decides"; allowCreateNew: boolean; allowReuseExisting: boolean };
```

The assigned workspace MUST be recorded in session or run metadata.

```ts
type PiboDelegatedWorkspaceMetadata = {
  workspaceMode: "main" | "worktree";
  worktreeId?: string;
  worktreePath?: string;
};
```

### 4.4 Attention Signal Contract

Pibo MUST emit compact delegated-run attention summaries without forcing full result consumption.

```ts
type PiboDelegationAttentionState =
  | "running"
  | "active_long_running"
  | "idle_no_recent_activity"
  | "completed"
  | "failed"
  | "cancelled";

type PiboDelegationAttentionSnapshot = {
  ownerPiboSessionId: string;
  childPiboSessionId?: string;
  runId?: string;
  state: PiboDelegationAttentionState;
  summary: string;
  observedAt: string;
  toolName?: string;
  subagentName?: string;
  workspace?: string;
};
```

### 4.5 Agent Model Selection Contract

Custom-agent persistence and runtime profile assembly MUST expose separate main-agent and subagent model preferences.

```ts
type PiboAgentModelPreference =
  | { mode: "default" }
  | { mode: "override"; model: string };

type PiboAgentExecutionPreferences = {
  mainModel: PiboAgentModelPreference;
  subagentModel: PiboAgentModelPreference;
};
```

Custom-agent persistence target:

```ts
type CustomAgentDefinition = {
  // existing fields omitted
  executionPreferences: PiboAgentExecutionPreferences;
};
```

Resolved runtime contract:

```ts
type PiboResolvedRuntimeModel = {
  model?: string;
  source: "default" | "agent-main" | "agent-subagent";
};
```

The resolver MUST receive whether the profile is running as a top-level session or as a child session.

### 4.6 Agent Designer Contract

The Agent Designer and agent APIs MUST expose the execution preference fields explicitly.

```ts
type ChatWebCustomAgentPayload = {
  // existing fields omitted
  executionPreferences?: {
    mainModel?: PiboAgentModelPreference;
    subagentModel?: PiboAgentModelPreference;
  };
};
```

## 5. Acceptance Criteria

- **AC-001**: Given a delegated child session is created, When the child prompt context is built, Then parent-only orchestration artifacts are removed before the child run starts.
- **AC-002**: Given a delegated child session is created, When the child system prompt is assembled, Then it explicitly frames the child as a delegated worker and not as the parent orchestrator.
- **AC-003**: Given a saved workflow contains sequential and parallel steps, When it is launched, Then execution still routes through generated subagent tools and existing run-control behavior.
- **AC-004**: Given a workflow step yields child work, When the run is started, Then the owning session can inspect it later through the existing `pibo_run_*` lifecycle.
- **AC-005**: Given a child run remains healthy but long-running, When the configured threshold is crossed, Then Pibo emits a conservative attention snapshot without auto-failing the run.
- **AC-006**: Given a child run shows no recent visible activity beyond the configured threshold, When status is inspected, Then the run surfaces as possible attention-needed instead of only generic `running`.
- **AC-007**: Given a delegated run uses a worktree policy that creates a new worktree, When the child run starts, Then the assigned worktree path is visible in status or metadata.
- **AC-008**: Given a delegated run uses a worktree reuse policy, When the child run starts, Then Pibo validates the selected worktree and exposes the assigned workspace in metadata.
- **AC-009**: Given an agent profile is configured with default main-agent model and explicit subagent model override, When it runs as the selected top-level session, Then it uses the default model policy.
- **AC-010**: Given the same agent profile is invoked as a routed child session, When runtime creation resolves the model, Then it uses the configured subagent model override.
- **AC-011**: Given both model scopes are configured as default, When the agent runs in either role, Then Pibo falls back to the normal default model behavior.
- **AC-012**: Given the Agent Designer loads an editable custom agent, When execution preferences are returned, Then main-agent and subagent model settings are visible as separate fields.

## 6. Test Automation Strategy

- **Test Levels**: Unit, integration, end-to-end where workflow launch and Agent Designer UI become available.
- **Frameworks**: Existing Node test suite and current Chat Web test stack.
- **Test Data Management**: Use in-memory or temporary stores for custom-agent persistence, runtime resolution, and session-router behavior. Use temporary Git repositories or temporary worktrees for worktree-aware execution tests.
- **CI/CD Integration**: New tests should run in the normal repository test workflow and avoid dependence on external provider access.
- **Coverage Requirements**:
  - child-context filtering unit tests
  - runtime model-resolution unit tests
  - session-router integration tests for child-session role detection
  - run-control integration tests for yielded workflow steps
  - worktree policy validation tests
- **Performance Testing**: No dedicated load target in V1. Avoid designs that require replaying full child transcripts into parent turns for ordinary status checks.

## 7. Rationale & Context

Pibo already has the hard parts needed for child-agent execution: routed sessions, explicit parent-child session identity, generated subagent tools, yielded runs, trace projection, and a Custom Agent system. The missing pieces are mostly product contracts above that base.

The main architectural decision in this specification is to keep orchestration Pibo-native. The goal is not to clone another runtime's monolithic subagent tool. The goal is to strengthen the product boundary:

- cleaner child context
- better delegated-work visibility
- optional reusable workflows
- optional worktree-aware isolation
- agent-scoped model policy

The model-selection requirement is intentionally broader than subagents because it belongs to the agent system itself. The main-versus-subagent split reflects a real product need: the same agent identity may be desirable as a top-level assistant with one model but as a delegated worker with another.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Git worktree support in the local repository for worktree-aware delegated execution.

### Third-Party Services

- **SVC-001**: Model providers already supported through Pi Coding Agent; per-agent overrides must resolve through existing provider/model handling and must not require a new provider integration path.

### Infrastructure Dependencies

- **INF-001**: Existing Pibo session router and Pibo Session store.
- **INF-002**: Existing Pibo run registry and `pibo_run_*` tool lifecycle.
- **INF-003**: Existing Chat Web custom-agent persistence and Agent Designer APIs.

### Data Dependencies

- **DAT-001**: Custom-agent SQLite store for persisted execution preferences.
- **DAT-002**: Session metadata or run metadata for delegated workspace assignment and attention snapshots.

### Technology Platform Dependencies

- **PLT-001**: Public `@mariozechner/pi-coding-agent` runtime APIs used by Pibo today.
- **PLT-002**: Existing Pibo plugin/profile builder and runtime assembly path.

### Compliance Dependencies

- **COM-001**: No additional compliance dependencies are introduced by this specification.

## 9. Examples & Edge Cases

```ts
const executionPreferences = {
  mainModel: { mode: "default" },
  subagentModel: { mode: "override", model: "openai/gpt-5.4-mini" },
};

const workflow = {
  id: "wf_review_loop",
  name: "review loop",
  steps: [
    { kind: "single", targetProfile: "planner", taskTemplate: "{userTask}", contextMode: "fresh" },
    {
      kind: "parallel",
      tasks: [
        { targetProfile: "reviewer", taskTemplate: "{previousSummary}", contextMode: "fresh" },
        { targetProfile: "tester", taskTemplate: "{previousSummary}", contextMode: "fresh", yieldMode: "yielded" },
      ],
    },
  ],
};
```

Edge cases:

- A child run is legitimately long-running because it is coding or reading a large codebase. This should produce a gentle attention state, not an automatic failure.
- A workflow parallel group launches multiple writers. Some steps may request `agent-decides` worktree mode; the execution surface must still make the final assigned workspaces explicit.
- A top-level agent and a child agent reference the same profile name. Model resolution must use role context, not profile-name heuristics alone.
- Child-context hygiene must not strip user task details that happened to be discussed in a parent planning exchange.

## 10. Validation Criteria

- The design must preserve the current routed child-session architecture.
- The design must preserve compatibility with existing `pibo_subagent_*` and `pibo_run_*` behavior.
- The design must add separate persisted model preferences for top-level and delegated agent use.
- The design must keep worktree use optional and visible.
- The design must keep delegated-run attention signaling conservative and configurable.
- The design must define a child-context filtering contract that is stronger than prompt wording alone.

## 11. Related Specifications / Further Reading

- [spec/spec-architecture-pibo-session-model.md](<HOME>/code/pibo/spec/spec-architecture-pibo-session-model.md:1)
- [spec/spec-infrastructure-web-auth-chat.md](<HOME>/code/pibo/spec/spec-infrastructure-web-auth-chat.md:1)
- [spec/spec-architecture-codex-compat-plugin.md](<HOME>/code/pibo/spec/spec-architecture-codex-compat-plugin.md:1)
- [docs/architecture.md](<HOME>/code/pibo/docs/architecture.md:89)
- [docs/agent-run-yield-spec.md](<HOME>/code/pibo/docs/agent-run-yield-spec.md:1)
