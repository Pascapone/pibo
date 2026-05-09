# Implement Agent Orchestration And Model Selection

## Goal

Implement the planned Pibo-owned improvements around:

- child-context hygiene for routed subagents
- optional workflow orchestration above existing subagent and run-control tools
- conservative delegated-run attention signals
- optional worktree-aware delegated execution
- per-agent main-agent and subagent model selection in the Agent Designer and runtime

This plan is intentionally phased. It avoids bundling all behavior into one risky rollout.

## Assumptions

- We continue to use the current routed child-session model.
- We do not modify Pi Coding Agent source.
- Existing `pibo_subagent_*` and `pibo_run_*` tools remain the execution backbone.
- Agent Designer and custom-agent persistence remain the source of truth for user-editable agent policy.

## Non-Goals For The First Implementation

- No broad DAG engine.
- No aggressive watchdog that auto-kills long-running child work.
- No mandatory worktree usage.
- No fully automatic agent-authored workflow compiler in V1.
- No large prompt-only solution where contracts are not backed by product state.

## Recommended Delivery Order

1. Child-context hygiene
2. Per-agent model selection
3. Conservative delegated-run attention signals
4. Worktree-aware delegated execution
5. Saved workflow orchestration
6. Optional agent-composed ad hoc workflow launching

This order keeps early phases narrow and independently valuable.

## Phase 1: Child-Context Hygiene

### Scope

Strengthen delegated child-session prompt/context assembly so children do not inherit parent-only orchestration residue.

### Tasks

- Add a Pibo-owned child-context filtering module in the runtime/session-router path before child runtime creation.
- Define and remove parent-only orchestration artifact classes.
- Add explicit delegated-child framing to the child prompt contract.
- Keep task-relevant prose and normal tool history only where needed.
- Add tests for filtered versus preserved context.

### Verify

- Unit tests prove parent-only orchestration artifacts are removed.
- Integration tests prove ordinary delegated task context still reaches the child.
- Existing subagent tests still pass.

## Phase 2: Per-Agent Model Selection

### Scope

Add product-level agent execution preferences with separate main-agent and subagent model selection.

### Tasks

- Extend custom-agent persistence schema with execution preference fields.
- Extend API payloads and Agent Designer contracts.
- Add runtime model-resolution logic based on session role:
  - top-level selected runtime uses `mainModel`
  - routed child runtime uses `subagentModel`
- Preserve default model fallback behavior when no override is configured.
- Keep implementation narrow: model field only in V1 unless reasoning-level support is already straightforward.

### Verify

- Store migration tests cover old rows and new rows.
- Runtime resolution tests cover default/default, default/override, override/default, and override/override.
- UI/API tests prove both fields round-trip cleanly.

## Phase 3: Delegated-Run Attention Signals

### Scope

Expose better long-running child-run visibility without making the system noisy or punitive.

### Tasks

- Define product-owned delegated attention states and thresholds.
- Add compact snapshots for:
  - active long-running
  - idle/no recent visible activity
  - failed
- Surface signals through run status and UI/read-model plumbing.
- Make thresholds configurable with conservative defaults.
- Avoid automatic cancellation or hard failure in V1.

### Verify

- Unit tests cover threshold transitions.
- Integration tests cover healthy long-running runs versus truly idle runs.
- Chat/read-model tests prove the status is visible without corrupting trace semantics.

## Phase 4: Worktree-Aware Delegated Execution

### Scope

Allow delegated child work to run in the main workspace, a new worktree, or an existing worktree while staying compatible with run-control.

### Tasks

- Define worktree policy contracts for delegated runs and workflow steps.
- Add worktree assignment metadata to child sessions or yielded runs.
- Add validation for reusable existing worktrees.
- Add safe new-worktree creation flow.
- Surface assigned workspace clearly in status and trace/UI metadata.
- Keep worktree use optional.

### Verify

- Temporary-repo integration tests cover:
  - main workspace mode
  - new worktree mode
  - existing worktree reuse mode
- Run-control tests prove yielded delegated work still works with worktree assignment.

## Phase 5: Saved Workflow Orchestration

### Scope

Add reusable workflow definitions for sequential and parallel delegated work above current capabilities.

### Tasks

- Create a Pibo-owned workflow store and schema.
- Support sequential steps and parallel groups only.
- Support bounded variable passing such as `userTask` and `previousSummary`.
- Add a launcher that composes existing routed subagent and run-control behavior.
- Expose workflow inventory to operator/debug surfaces first, then to Agent Designer or Chat Web if needed.

### Verify

- Unit tests cover workflow schema validation and template expansion.
- Integration tests cover sequential and parallel execution through current router/runtime machinery.
- Yielded step tests prove `pibo_run_start` still owns long-running lifecycle.

## Phase 6: Optional Agent-Composed Ad Hoc Workflows

### Scope

Let the agent assemble and launch a bounded ad hoc workflow from existing capabilities without requiring every pattern to be pre-saved.

### Tasks

- Reuse the saved-workflow execution contract.
- Keep the ad hoc contract narrow and inspectable.
- Require explicit launched-step visibility in status and trace.
- Do not silently convert arbitrary prompts into large delegated trees.

### Verify

- Tests prove ad hoc workflows still route through the same execution backbone.
- Status and trace views remain understandable.

## Cross-Cutting Risks

- Child-context hygiene can accidentally strip too much useful context.
- Runtime model selection may require a new Pibo-owned adapter layer if the current runtime creation path does not yet accept per-session model overrides cleanly.
- Attention signaling can become noisy if thresholds are too aggressive.
- Worktree assignment can become dangerous if dirty-worktree and branch-safety rules are weak.
- Workflow orchestration can sprawl if V1 tries to support too many step types or dynamic variables.

## First Technical Spike

Before broad implementation, do one small spike for each uncertain area:

1. Confirm the cleanest Pibo-owned point to filter child-visible messages and prompt sections.
2. Confirm the narrowest runtime adapter point for per-session model override without touching Pi source.
3. Confirm where delegated-run attention snapshots should live so Chat Web and agent-visible status can share them.
4. Confirm how worktree metadata should attach to sessions versus runs.

## Suggested First PR Slice

The first PR should implement only Phase 1.

Why:

- It is clearly valuable.
- It has minimal UI blast radius.
- It strengthens a known weak point in a structurally compatible way.
- It reduces future orchestration confusion before we add more orchestration features.

## Suggested Second PR Slice

The second PR should implement only the persistence and runtime core for Phase 2, with minimal UI.

Why:

- The data contract is simple.
- It unblocks a broader agent-system improvement beyond subagents.
- It avoids coupling model selection to workflow work.
