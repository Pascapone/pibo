# Proposal: Runtime Portability v4.1

**Status:** Implementing
**Created:** 2026-08-20
**Source:** Runtime portability change request v4.1

## Why

Pibo can bind one product conversation to Pi, native Codex, or OMP, but a runtime change previously created a contextless native session. Agent Designer also lacked truthful controls for runtime-owned context discovery and harness-native subagents. Native Codex compaction, additive OMP context delivery, context deduplication, and deterministic skill-collision handling were incomplete.

These gaps can silently change agent behavior. Runtime switches must preserve model-relevant product history, and UI controls must represent only behavior the selected adapter can enforce.

## What Changes

- Add explicit `contextDiscovery`, `nativeSubagents`, and `historyImport` runtime capabilities.
- Add a profile-level native-subagent override only for adapters that declare it configurable.
- Route native Codex manual compaction through `thread/compact/start`.
- Persist a bounded, redacted, checkpointed Pibo portable-history handoff for runtime rebinding.
- Import that handoff before the target runtime receives its first new prompt.
- Keep `autoContextFiles` as a concrete legacy boolean while capabilities determine whether it is editable or effective.
- Deliver selected Pibo context to OMP through a private session-scoped `--append-system-prompt` file.
- Deduplicate explicit context files that known native discovery will load.
- Reject or override same-name native skills so an explicitly selected Pibo skill has deterministic priority.

## Capabilities

### New capability

- `runtime-portability-and-handoff`: cross-runtime history continuity, runtime-owned context discovery, native-subagent controls, native compaction, deduplication, and skill priority.

### Modified capabilities

- `custom-agents`: runtime-specific feature controls and persistence.
- `pibo-session-routing`: checkpointed cross-runtime rebinding and explicit `startFresh`.
- `pibo-runtime-assembly-and-inspection`: truthful resource delivery, context discovery, and runtime feature inspection.
- `runtime-prompt-and-compaction`: native Codex compaction and additive OMP system context.

## Impact

- **Code:** runtime capability contracts, router rebinding, portable history, Pi/Codex/OMP adapters, resource delivery, Agent Designer, and custom-agent persistence.
- **API:** runtime-binding PATCH accepts `startFresh`; runtime catalogs expose the new capabilities.
- **Data:** runtime-binding metadata records pending/completed handoff audit state; custom agents add nullable `native_subagents`. Existing `auto_context_files` remains the only automatic-context column.
- **Security:** handoffs are bounded and redacted; generated OMP files are private and session-scoped; invalid handoff metadata fails closed.
- **Compatibility:** Pi remains the default, existing `codex` compatibility meaning is unchanged, and profiles without new settings retain prior defaults.
