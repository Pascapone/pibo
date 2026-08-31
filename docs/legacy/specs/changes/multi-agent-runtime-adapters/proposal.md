---
type: "Historical Record"
title: "Proposal: Multi-Agent Runtime Adapters"
description: "Historical copy of a completed Pibo change-packet document."
tags: ["multi-agent-runtime-adapters", "change-packet", "history"]
status: "deprecated"
authority: "historical"
generated:
  by: "process:pibo-okf-b02-completed-history"
  at: "2026-08-30T18:25:11Z"
---
# Proposal: Multi-Agent Runtime Adapters

**Status:** Ready for review
**Created:** 2026-08-14
**Requester / Source:** Active Pibo Loop goal
**Related docs:** `spec.md`, `design.md`, `tasks.md`, `docs/reports/multi-agent-runtime-adapter-architecture-investigation-2026-08-14.md`

## Why

Pibo currently expresses its product boundary through concrete Pi Coding Agent types. Pi owns the model loop and transcript as intended, but Pi-specific runtime construction, events, controls, persistence identifiers, tools, model/auth discovery, and history parsing also leak into product orchestration. That prevents Pibo from adding a genuinely different harness without duplicating or weakening the product layer.

Pibo needs a Pibo-owned runtime adapter SPI. Pibo Sessions, rooms, profiles, Agent Designer, jobs, loops, workflows, goals, subagents, signals, reliability, debug tooling, Chat Web, and product data remain authoritative. Each harness owns its native prompt, native tools, model loop, native session, transcript, and harness-specific behavior.

## What Changes

- Add a runtime driver/adapter contract with stable adapter identity, configured instance identity, JSON-Schema configuration, diagnostics, and explicit capabilities.
- Add a registry for configured adapter instances. Keep live runtime-session handles scoped to routed Pibo Sessions and out of the configured-instance registry.
- Refactor routed execution to use a generic runtime session interface and normalized semantic events.
- Extract all current Pi runtime behavior into the default `pi` adapter while retaining compatibility APIs and exact persisted Pi identifiers.
- Add additive runtime-session binding persistence and backfill existing sessions to `pi` bindings without rewriting transcripts.
- Make profiles and Agent Designer select a runtime adapter/instance and validate portable capabilities before save/start.
- Replace Pi-owned plugin tool definitions with a Pibo-owned JSON-Schema tool contract, compiled directly for Pi or exposed through a session-scoped MCP bridge for external harnesses.
- Make skills, context files, external MCP servers, Pibo subagents, trace/history, debug, auth/model catalogs, and runtime controls adapter-aware.
- Add a built-in `pibo-agent-runtime-adapter` authoring skill with contract and eval coverage.
- Add a distinct `codex-native` profile backed by the official Codex App Server protocol. Preserve any persisted/custom Pi-backed `codex-compat-openai-web` or `codex` references and do not let native Codex claim the retired built-in alias.

## Capabilities

### New Capabilities

- `agent-runtime-adapters`: registered harness drivers, configured runtime instances, live runtime sessions, capability negotiation, diagnostics, and lifecycle isolation.
- `runtime-session-bindings`: opaque persisted links between Pibo Sessions and native harness sessions.
- `portable-pibo-capabilities`: cross-runtime Pibo tools, skills, context files, MCP servers, subagents, and product controls with inspectable delivery fidelity.
- `native-codex-runtime`: native Codex App Server threads, turns, events, approvals, user input, models, reasoning, history, and restart/resume.
- `runtime-adapter-authoring`: built-in instructions and tests for adding full or explicitly partial adapters.

### Modified Capabilities

- `pibo-session-routing`: resolve a stored configured runtime instance instead of assuming Pi.
- `pibo-runtime-assembly-and-inspection`: become adapter-aware while preserving Pi compatibility entry points.
- `plugin-registry-and-capability-catalog`: register runtime adapters and expose availability/capability metadata.
- `pibo-session-store`: persist runtime bindings while retaining deprecated `piSessionId` fields.
- `custom-agents`: select and validate runtime instance, adapter-native options, and portable capability delivery.
- `pibo-event-contract`: accept normalized runtime semantic events and deprecated raw Pi compatibility events.
- `chat-web-trace-and-terminal-view`: use runtime-neutral product history for new turns and adapter history providers for legacy/import/debug paths.
- `debug-cli`: report runtime binding, adapter diagnostics, native history status, and adapter-specific drill-down without secrets.

## Impact

- **Code:** New `src/agent-runtime/` contracts and registry; isolated `src/agent-runtimes/pi/` and `src/agent-runtimes/codex/`; changes across router, profiles, plugins, stores, tools, history, debug, Chat Web, and Agent Designer.
- **APIs / CLI:** Additive runtime metadata and capability inspection. Existing Pi-oriented fields/actions remain available during compatibility. New runtime-specific commands follow progressive CLI disclosure.
- **Data:** Additive runtime binding table with Pi backfill and dual-read/dual-write compatibility. No Pi session id or transcript rewrite.
- **Auth / Security:** Session-scoped MCP credentials are short-lived, hashed at rest/in memory where applicable, limited to one Pibo Session and selected tool set, and revoked on runtime disposal.
- **Compatibility:** `pi` remains the default. Existing custom agents default to Pi. Persisted/custom `codex` references remain Pi compatibility behavior; the August 14, 2026 `upstream/dev` baseline has no default built-in `codex` profile to reinterpret. Existing Pi sessions reopen unchanged.
- **Docs:** Update glossary, capability specs, architecture/call flows, migration/rollback, adapter docs, authoring skill, and validation reports.
