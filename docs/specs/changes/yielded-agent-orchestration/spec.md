# Spec: Yielded Agent Orchestration

**Status:** Implementing
**Created:** 2026-08-24
**Requester / Source:** Product discussion and issue #567
**Related docs:** [Agent Delegation](../../capabilities/subagent-delegation.md), [Yielded Run Control](../../capabilities/yielded-run-control.md)

## Why

Long delegated work must remain alive while the orchestrator wakes periodically to observe it. Foreground waiting, request lifetime, and explicit cancellation are separate concerns.

## Goal

Make Pibo Run the mandatory execution environment for delegated sends while preserving persistent child sessions, full final replies, request-level observation, and recursive Loop accounting.

## Scope

### In Scope

- Yielded-only `pibo_agents_send_message`.
- No default or profile-driven delegated-request lifetime deadline.
- Conditional delegated-agent management context.
- Read-only session runtime resolution manifest in Build Context.
- Request and assistant-role observation filters.
- Complete terminal result plus oversized-output reference behavior.
- Recursive Loop token and cost accounting with WebUI statistics.
- Per-agent model/thinking fields in profile inspection.
- Cancellation settlement from PR #564.

### Out of Scope

- New stop, pause, or drain buttons.
- Concurrency, PR, agent, token, or lifetime budgets.
- New historical peak-concurrency or yielded-run-count telemetry; this change preserves existing active and wall-clock Loop timing and adds the required recursive model usage/cost accounting.
- Automatic reduction of configured thinking levels.
- Automatic reviewer creation during feature implementation.

## Requirements

### Requirement: Merge and release review policy

Normal implementation MAY proceed without an independent reviewer. Before a normal merge to `dev` or a release, an independent review SHOULD be completed. Explicit user instructions and emergency hotfixes MAY override the normal order; an urgent change MAY ship first and receive immediate follow-up review.

### Requirement: Yielded-only dispatch

The runtime MUST NOT expose `pibo_agents_send_message` as a directly callable model tool. When enabled delegated agents exist, Pibo MUST expose it as a `pibo_run_start` target and expose the run-management tools required to control it.

#### Scenario: Dispatch

- GIVEN an enabled delegated agent
- WHEN the model starts `pibo_agents_send_message` through `pibo_run_start`
- THEN Pibo returns a run ID and the child continues independently of bounded waits.

### Requirement: No implicit delegated lifetime

A delegated send MUST remain active until it completes or receives explicit cancellation. A `pibo_run_wait` timeout MUST NOT cancel it. Legacy `SubagentProfile.timeoutMs` values MUST NOT impose a child lifetime.

### Requirement: Conditional management context

A generated management section MUST be loaded only when at least one delegated agent is enabled and depth-eligible. It MUST identify available agents, show the yielded send signature and direct management signatures, and state the dispatch/wait/observe/read/cancel lifecycle.

### Requirement: Runtime resolution manifest

Build Context MUST expose a read-only runtime resolution manifest for the concrete inspected session. It MUST identify the selected profile and runtime, effective model and thinking level, directly callable managed tool names, yielded target names, active tool packages, loaded context and skills, and configured/effective delegated-agent runtime selections. `activeToolNames` MUST contain only real callable tool names; agent descriptions, package labels, and yielded-target labels MUST remain in their dedicated manifest fields or display nodes. The manifest MUST be resolution evidence only: it MUST NOT become a second profile configuration, MUST NOT be injected into the agent prompt, and MUST NOT count toward prompt-context token estimates. When a portable runtime cannot enumerate harness-native tool names, the manifest MUST mark its tool surface as Pibo-managed-only.

### Requirement: Request observation

Every yielded delegated send MUST use its run ID as request ID. Child observations MUST retain that request ID and support exact `requestIds` and `roles` filters.

### Requirement: Complete terminal result

For delegated sends, `pibo_run_read` MUST return the complete final assistant message and structured request, agent, thread, event, and reply identity. Multi-part provider text MUST be assembled in order without a new size cap. For Bash, the terminal result is the Bash tool result: bounded inline output plus the Pi-provided full-output path when truncation occurred. It is not the entire terminal session history.

### Requirement: Recursive Loop accounting

Goal Loop accounting MUST attribute assistant usage from the controller and all recursively delegated descendants to the originating Loop run. Turn-scoped runtime outputs MUST carry the active request provenance across adapter boundaries. Usage normalization MUST preserve input, output, cache-read, cache-write, reasoning, total tokens, and reported cost. Persisted accounting MUST retain those dimensions, assistant-turn count, and contributing session IDs.

### Requirement: WebUI statistics

The Loop view MUST show recursive turns, total tokens, cache reads, cost when available, and navigable contributing session IDs alongside existing active and wall-clock time.

### Requirement: Profile inspection

Profile inspection MUST expose each configured subagent's configured model/thinking overrides and effective model/thinking selection. Effective values MUST use the same target-profile fallback precedence as child runtime creation. A concrete delegated-agent setting MUST remain effective even when the target profile or global subagent fallback differs.

### Requirement: Public agents-controller compatibility

The package-root agents-controller input and result types MUST remain source-compatible with the prior controller shape. New request identity and complete-final-message fields MUST be additive and optional for controller implementations. Tool execution MUST normalize missing `requestId` to the yielded run ID and missing `finalMessage` to `reply.text` before rendering or returning structured details.

## Success Criteria

- [ ] Direct runtime tools omit `pibo_agents_send_message` while `pibo_run_start` accepts it.
- [ ] A delegated request remains running beyond an expired bounded wait.
- [ ] Explicit run cancellation targets the exact child request and waits for bounded confirmed settlement.
- [ ] Context contains the management section only for profiles with available agents.
- [ ] Build Context exposes a concrete read-only runtime manifest without adding prompt tokens.
- [ ] Observe filters assistant messages by request ID.
- [ ] Run read returns the complete child final message.
- [ ] Descendant usage appears in persisted Loop accounting and Chat Web.
- [ ] Profile inspection reports a concrete `xhigh` override even when the profile's subagent-session level is `medium`.
- [ ] A TypeScript controller using the prior input/result shape compiles, and its runtime result normalizes request identity and final text deterministically.
