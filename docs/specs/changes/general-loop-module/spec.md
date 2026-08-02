# Spec: General Loop Module

**Status:** Done
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

### Out of Scope

- Reimplementing Codex's token-accounting subsystem inside Pi Coding Agent.
- Adding a new model-visible `update_goal` native tool.
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

Goal continuation prompts MUST preserve the full objective, direct the agent to inspect current authoritative state, prevent scope shrinking, require requirement-by-requirement completion evidence, and reserve the completion marker for proven completion.

### REQ-005: Operational parity

Rooms, default chat, profiles, model/thinking/fast overrides, stop conditions, max iterations, run facts, resource metadata and cleanup, run timeout, graceful stop, cancel, status, run history, and Web management MUST continue to work for both modes.

### REQ-006: Compatibility

- `pibo ralph` MUST remain available and create or manage legacy `ralph` mode loops.
- `/api/chat/ralph/*` MUST remain available as an alias.
- Existing Ralph rows and IDs MUST remain readable and controllable.
- Existing `pibo.ralph.*` stop-condition types and fact events MUST remain accepted.
- The old `/ralph` Chat route MUST open the Loop area.

### REQ-007: Public naming

New discovery output, the primary API, navigation, and Chat Web UI MUST use `Loop`, not `Ralph`. Legacy surfaces MAY identify themselves as compatibility aliases.

## Acceptance Criteria

- [x] `pibo loop add ...` without a mode creates a `goal` loop.
- [x] Two successful runs of one goal loop reference the same Pibo Session ID.
- [x] Two successful runs of one Ralph loop reference different Pibo Session IDs.
- [x] Existing rows without a mode load as `ralph`.
- [x] Stop policies and max iterations stop either mode.
- [x] `pibo ralph` and `/api/chat/ralph/*` still work.
- [x] Chat Web shows Loops, allows mode selection, and preserves all existing controls.
- [x] Focused tests, typecheck, build, CLI smoke, API smoke, and browser validation pass.

## Constraints

- Keep legacy SQLite file/table names until a separate storage migration removes them safely.
- Do not restart or modify the host production gateway.
- Validate user-visible behavior in the isolated Docker worker.
