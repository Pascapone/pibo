# Spec: General Loop Module

**Status:** Implemented in PR #324
**Created:** 2026-08-02
**Requester / Source:** User request in Pibo session `ps_924120d4-f1fb-40e2-926c-56b8fdadbd57`
**Related source:** OpenAI Codex commit `5157493c23713ac12034cf250ffb0a8ce0670277`

## Why

Pibo's Ralph capability repeats work by creating a fresh Pibo Session after each run. Modern agents can retain and compact long-running context effectively. Codex `/goal` uses that capability by continuing work in the same persisted thread instead of replacing the context after every turn.

Pibo needs a general loop capability that keeps Ralph's durable jobs, rooms, stop policies, resources, runtime overrides, run history, CLI, API, and Web UI while making same-session goal continuation the default.

## Goal

Replace Ralph as the public capability with a general Loop module whose default `goal` mode continues turns in one Pibo Session, while retaining an explicit legacy `ralph` mode and compatibility aliases for existing callers and data.

## Scope

### In Scope

- Public `Loop` naming in CLI, Chat API, Chat Web navigation, and UI.
- Loop mode `goal | ralph`.
- `goal` as the default for newly created loops.
- Same-session continuation for `goal` mode.
- Fresh-session execution for `ralph` mode.
- Existing rooms, profiles, runtime overrides, stop policies, max iterations, run facts, resources, cleanup, run history, stop, and cancel behavior.
- Compatibility for existing Ralph jobs, IDs, persisted data, CLI commands, API paths, and stop-condition type names.
- Goal prompting adapted from Codex's continuation and completion-audit behavior.
- Codex-compatible native goal tools that can be disabled per Agent Designer profile.
- Persistent goal status, soft token budget with a pre-turn reserve, per-turn usage/overshoot accounting, and distinct active versus wall-clock time accounting.

### Out of Scope

- Exact provider-internal token accounting before a model response reports usage.
- MCP transport for goal lifecycle tools; the tools are native Pibo tools.
- Removing legacy Ralph storage names in the same migration.
- Production deployment.

## Requirements

### REQ-001: General loop mode

Each job MUST expose a mode of `goal` or `ralph`. New jobs created through Loop interfaces MUST default to `goal`. Jobs persisted before the mode field existed MUST load as `ralph`.

### REQ-002: Same-session goal continuation

A `goal` loop MUST create one Pibo Session on its first run and reuse that Pibo Session for later runs. After a completed turn and an unsatisfied stop policy, the scheduler MUST send a continuation turn to that session.

### REQ-003: Legacy Ralph execution

A `ralph` loop MUST retain the existing behavior of creating a fresh Pibo Session for each run.

### REQ-004: Prompt fidelity

Goal continuation prompts MUST preserve the full objective, direct the agent to inspect current authoritative state, prevent scope shrinking, and require requirement-by-requirement completion evidence. Goal prompts MUST direct capable agents to use the native goal-status tool instead of a textual completion marker. Legacy Ralph prompts MUST retain the completion marker contract.

### REQ-004A: Native goal tools

Pibo MUST expose native `get_goal`, `create_goal`, and `update_goal` tools with Codex-compatible lifecycle semantics. `update_goal` MUST allow the agent to mark the current goal `complete` or `blocked`. These tools MUST execute inside Pibo without an MCP server.

### REQ-004B: Agent Designer control

Custom agents MUST expose one Agent Designer capability switch for goal tools. The switch MUST default to enabled for new and migrated custom agents and MUST allow all goal tools to be disabled for that profile.

### REQ-004C: Goal state and token budget

A goal MUST persist status, an optional positive soft token budget, an optional non-negative pre-turn token reserve, consumed uncached model tokens, active agent time, wall-clock elapsed time, and remaining tokens. Cache-read and cache-write tokens MUST NOT consume the Goal token budget. Goal creation through CLI, API, UI, or native tooling MUST accept the budget and reserve. Before each turn Pibo MUST expose and persist remaining budget, MUST refuse to start when remaining tokens do not exceed the reserve, and MUST record per-turn uncached usage and overshoot. CLI and Web surfaces MUST identify the budget as soft because provider usage is available only after a response.

Active agent time MUST accumulate Goal-run execution time. Wall-clock elapsed time MUST begin at first activation and include waiting and paused periods; a Goal created paused MUST report zero wall-clock elapsed time until first activation. CLI, Web UI, and `get_goal` MUST label both metrics unambiguously.

### REQ-004D: Completion and blocked lifecycle

A successful `update_goal(status=complete)` call MUST persist completion and stop automatic continuation after the current turn. A successful `update_goal(status=blocked)` call MUST persist the blocked state and stop automatic continuation. The prompt MUST use Codex's strict three-consecutive-turn blocked audit. Resuming a blocked goal MUST make it active and begin a fresh blocked audit.

### REQ-005: Operational parity

Rooms, default chat, profiles, model/thinking/fast overrides, stop conditions, max iterations, run facts, resource metadata and cleanup, run timeout, graceful stop, cancel, status, run history, and Web management MUST continue to work for both modes.

Goal-owned browser leases MUST be renewed before and during active turns, retained between non-terminal turns, and released when the Goal stops or becomes terminal. A recoverable expired or dead browser process MUST be reacquired from its persisted managed profile, including after gateway restart. An unrecoverable authenticated-browser failure MUST mark the Goal blocked and persist an operator-facing dirty resource reason.

### REQ-006: Compatibility

- `pibo ralph` MUST remain available and create or manage legacy `ralph` mode loops.
- `/api/chat/ralph/*` MUST remain available as an alias.
- Existing Ralph rows and IDs MUST remain readable and controllable.
- Existing `pibo.ralph.*` stop-condition types and fact events MUST remain accepted.
- The old `/ralph` Chat route MUST open the Loop area.

### REQ-007: Public naming

New discovery output, the primary API, navigation, and Chat Web UI MUST use `Loop`, not `Ralph`. Legacy surfaces MAY identify themselves as compatibility aliases.

### REQ-008: Agent discovery

Pibo MUST provide a built-in `loop` skill and `pibo tools guide loop loop` discovery path for Goal-first workflows. The `ralph-loop` skill and Ralph guide MUST remain available but identify Ralph as the legacy fresh-session mode.

## Acceptance Criteria

- [x] `pibo loop add ...` without a mode creates a `goal` loop.
- [x] Two successful runs of one goal loop reference the same Pibo Session ID.
- [x] Two successful runs of one Ralph loop reference different Pibo Session IDs.
- [x] Existing rows without a mode load as `ralph`.
- [x] Stop policies and max iterations stop either mode.
- [x] `pibo ralph` and `/api/chat/ralph/*` still work.
- [x] Chat Web shows Loops, allows mode selection, and preserves all existing controls.
- [x] Focused tests, typecheck, build, CLI smoke, API smoke, and browser validation pass.
- [x] Goal tools are visible to enabled profiles and absent when disabled in Agent Designer.
- [x] `create_goal`, `get_goal`, and `update_goal` persist and return Codex-compatible goal lifecycle data.
- [x] Goal completion and blocked status stop continuation without requiring the XML marker.
- [x] Token budgets are configurable through CLI, API, Web UI, and native tool creation.
- [x] Reported model usage accumulates across goal turns and budget exhaustion stops the goal.
- [x] Ralph marker compatibility remains unchanged.
- [x] `pibo tools guide loop loop` and the built-in `loop` skill teach Goal-first operation while Ralph discovery remains available.

## Constraints

- Keep legacy SQLite file/table names until a separate storage migration removes them safely.
- Do not restart or modify the host production gateway.
- Validate user-visible behavior in the isolated Docker worker.
