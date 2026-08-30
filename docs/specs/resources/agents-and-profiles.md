---
type: "Specification"
title: "Profiles, Custom Agents, Aliases, and Selection"
description: "Defines the implemented profiles, custom agents, aliases, and selection contract and its current ownership, security, and verification boundaries."
tags: ["resources", "security-boundaries"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T08:51:56Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
    title: "Source and test evidence inspected for SPC-RES-001"
implementation:
  state: "current"
  baseline_commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  package: "WP-03-RESOURCES-SECURITY"
  source_evidence: "performed"
  focused_test_execution: "performed: 383 passed, 2 baseline failures in local-auth.test.mjs"
  build_and_typecheck_execution: "performed: npm run typecheck and npm run build passed"
traceability:
  commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  requirements:
    - id: "RES-AGT-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat/web-app.ts"
          symbol: "requireValidCustomAgentRuntime"
        - path: "src/apps/chat/web-app.ts"
          symbol: "listBrokenNativeTools"
        - path: "src/apps/chat/web-app.ts"
          symbol: "listBrokenContextFiles"
        - path: "src/apps/chat/agent-profiles.ts"
          symbol: "createCustomAgentRuntimeValidationProfile"
        - path: "src/apps/chat/agent-profiles.ts"
          symbol: "createCustomAgentProfileDefinition"
      tests:
        - path: "test/web-channel.test.mjs"
          name: "chat Agent Designer exposes runtime diagnostics and rejects invalid runtime selections"
        - path: "test/web-channel.test.mjs"
          name: "chat web app surfaces broken custom agent context files and allows cleanup"
        - path: "test/agent-profiles.test.mjs"
          name: "custom agent profiles skip unknown context file references"
        - path: "test/agent-profiles.test.mjs"
          name: "custom agent profiles skip unknown skill references"
        - path: "test/chat-custom-agent-profiles.test.mjs"
          name: "stale custom agent tool references do not break the profile catalog"
      public:
        - "Profile and Custom Agent definitions"
        - "chat_agent_folders, chat_agents, chat_agent_profile_aliases, chat_agent_events"
        - "Agent catalog and profile inspection APIs"
        - "Profiles select runtime/model/options/tools/packages/skills/subagents/context/MCP/Pi packages; user-editable agents add folders, aliases, archive, and audit events."
      failures:
        - "Catalogs expose safe metadata and disabled reasons; hard runtime validation errors reject create/update, while stale or unknown skill/context/tool references may be skipped and only some produce diagnostics."
        - "Catalogs expose safe metadata; stale or unknown references may be skipped, with diagnostics for skills/context and a warning for stale tools."
      confidence: "high"
    - id: "RES-AGT-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat/agent-store.ts"
          symbol: "CustomAgentStore"
        - path: "src/apps/chat/agent-store.ts"
          symbol: "createDefaultCustomAgentStore"
        - path: "src/apps/chat/agent-store.ts"
          symbol: "isValidCustomAgentName"
      tests:
        - path: "test/agent-store.test.mjs"
          name: "custom agent store migrates old app-context tables with stable defaults"
        - path: "test/agent-store.test.mjs"
          name: "custom agent store organizes agents in durable renamable folders"
        - path: "test/agent-store.test.mjs"
          name: "custom agent store records agent rename and deletion history"
        - path: "test/agent-store.test.mjs"
          name: "custom agent names are globally unique and lists are app-global across legacy accounts"
      public:
        - "Profile and Custom Agent definitions"
        - "chat_agent_folders, chat_agents, chat_agent_profile_aliases, chat_agent_events"
        - "Agent catalog and profile inspection APIs"
        - "Profiles select runtime/model/options/tools/packages/skills/subagents/context/MCP/Pi packages; user-editable agents add folders, aliases, archive, and audit events."
      failures:
        - "Catalogs expose safe metadata and disabled reasons; hard runtime validation errors reject create/update, while stale or unknown skill/context/tool references may be skipped and only some produce diagnostics."
        - "Catalogs expose safe metadata; stale or unknown references may be skipped, with diagnostics for skills/context and a warning for stale tools."
      confidence: "high"
    - id: "RES-AGT-003"
      status: "implemented"
      sources:
        - path: "src/core/profiles.ts"
          symbol: "InitialSessionContext"
        - path: "src/core/profiles.ts"
          symbol: "InitialSessionContextBuilder"
        - path: "src/core/profiles.ts"
          symbol: "normalizeToolProfile"
        - path: "src/apps/chat/agent-store.ts"
          symbol: "CustomAgentDefinition"
        - path: "src/apps/chat/agent-store.ts"
          symbol: "CreateCustomAgentInput"
        - path: "src/apps/chat/agent-store.ts"
          symbol: "UpdateCustomAgentInput"
      tests:
        - path: "test/agent-profiles.test.mjs"
          name: "custom agent profiles preserve the persisted runtime selection and options"
        - path: "test/agent-profiles.test.mjs"
          name: "custom agent profiles preserve per-subagent execution settings"
        - path: "test/agent-store.test.mjs"
          name: "custom agent store persists ordered main provider fallbacks and legacy subagent model overrides"
        - path: "test/agent-store.test.mjs"
          name: "custom agent store persists thinking, fast, and built-in mode options"
      public:
        - "Profile and Custom Agent definitions"
        - "chat_agent_folders, chat_agents, chat_agent_profile_aliases, chat_agent_events"
        - "Agent catalog and profile inspection APIs"
        - "Profiles select runtime/model/options/tools/packages/skills/subagents/context/MCP/Pi packages; user-editable agents add folders, aliases, archive, and audit events."
      failures:
        - "Catalogs expose safe metadata and disabled reasons; hard runtime validation errors reject create/update, while stale or unknown skill/context/tool references may be skipped and only some produce diagnostics."
        - "Catalogs expose safe metadata; stale or unknown references may be skipped, with diagnostics for skills/context and a warning for stale tools."
      confidence: "medium"
    - id: "RES-AGT-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat/agent-store.ts"
          symbol: "CustomAgentStore"
        - path: "src/apps/chat/web-app.ts"
          symbol: "sessionResourceId"
        - path: "src/apps/chat/web-app.ts"
          symbol: "createSessionUpdate"
        - path: "src/plugins/chat-custom-agents.ts"
          symbol: "createPiboChatCustomAgentProfilesPlugin"
      tests:
        - path: "test/agent-store.test.mjs"
          name: "custom agent profile renames leave old session profile names resolvable"
        - path: "test/web-channel.test.mjs"
          name: "chat web app changes session profiles only before the first trace event"
        - path: "test/web-channel.test.mjs"
          name: "chat web app canonicalizes legacy custom agent session profile aliases"
      public:
        - "Profile and Custom Agent definitions"
        - "chat_agent_folders, chat_agents, chat_agent_profile_aliases, chat_agent_events"
        - "Agent catalog and profile inspection APIs"
        - "Profiles select runtime/model/options/tools/packages/skills/subagents/context/MCP/Pi packages; user-editable agents add folders, aliases, archive, and audit events."
      failures:
        - "Catalogs expose safe metadata and disabled reasons; hard runtime validation errors reject create/update, while stale or unknown skill/context/tool references may be skipped and only some produce diagnostics."
        - "Catalogs expose safe metadata; stale or unknown references may be skipped, with diagnostics for skills/context and a warning for stale tools."
      confidence: "high"
verification:
  required_evidence_classes:
    - "source inspection"
    - "focused tests"
    - "build/package checks"
    - "local real-path/PTY/headful browser validation"
  performed:
    - evidence_class: "source inspection"
      status: "performed"
      detail: "Exact source files, symbols, test files, and test names were reconciled to Foundation commit 38bb6e57f118c1543e7263c68d27e5103d3b1262."
    - evidence_class: "focused tests"
      status: "performed_with_baseline_failures"
      detail: "Exact parent/candidate inventory ran in the same fresh isolated worker: 385 tests, 383 passed, and 2 identical local-auth baseline assertions failed; no source or test files were changed."
    - evidence_class: "build/package checks"
      status: "performed"
      detail: "npm run typecheck and npm run build passed; build emitted existing Vite chunk-size warnings only."
  unperformed:
    - evidence_class: "local real-path/PTY/headful browser validation"
      status: "unperformed"
      reason: "No browser, PTY, or real-path acceptance flow was performed for this package."
    - evidence_class: "external-provider/Pibo2 acceptance"
      status: "unperformed"
      reason: "No real provider, external MCP, package-manager, host lifecycle, or Pibo2 acceptance was performed."
stale_claims_to_reject:
  - id: "WP03-STALE-001"
    claim: "Every invalid custom-agent resource selection fails persistence."
    reason: "Runtime errors fail create/update, but stale skills/context/tools are skipped during profile construction; only some produce structured diagnostics."
open_evidence_gaps:
  - id: "WP03-GAP-009"
    specs: ["SPC-RES-001", "SPC-RES-002", "SPC-RES-003", "SPC-RES-004", "SPC-RES-005", "SPC-SEC-001", "SPC-SEC-002", "SPC-SEC-003"]
    gap: "Canonical synthesis and this read-only brief executed no focused tests, build/package checks, real paths, browser flows, or external/Pibo2 acceptance."
---

# Scope and exclusions

Profile selection fields, custom-agent folders/aliases/archive/audit, runtime/model/options/tools/skills/subagents/context/MCP/Pi-package validation, and frozen-session behavior.

This specification records current behavior only. It does not authorize unimplemented hardening, duplicate the linked runtime/gateway/data owner, or convert unperformed validation into evidence.

# Current behavior and public surfaces

The implementation state is current at the exact accepted Foundation traceability commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

Implemented behavior:
- "Profile and Custom Agent definitions"
- "chat_agent_folders, chat_agents, chat_agent_profile_aliases, chat_agent_events"
- "Agent catalog and profile inspection APIs"
- "Profiles select runtime/model/options/tools/packages/skills/subagents/context/MCP/Pi packages; user-editable agents add folders, aliases, archive, and audit events."
- "InitialSessionContext carries runtime/options, model/fallbacks, thinking/fast settings, tools, skills, subagents, MCP servers, Pi packages, context files, diagnostics, and built-in modes."
- "CustomAgentStore persists app-global agents, durable folders, rename aliases, archive state, and audit history in four SQLite tables."
- "Profile construction skips stale skill/context/tool references rather than breaking catalog load; skills/context produce diagnostics, while stale tools currently produce a warning only."
- "Create/update validates the selected runtime profile and rejects error diagnostics with HTTP 400; existing bound sessions remain frozen and legacy renamed profile aliases remain resolvable."

Public surfaces:
- "Profile and Custom Agent definitions"
- "chat_agent_folders, chat_agents, chat_agent_profile_aliases, chat_agent_events"
- "Agent catalog and profile inspection APIs"
- "Profiles select runtime/model/options/tools/packages/skills/subagents/context/MCP/Pi packages; user-editable agents add folders, aliases, archive, and audit events."

# State, lifecycle, and invariants

- "Saving validates selected runtime capabilities; existing sessions retain frozen profile/runtime choices."
- "Names are app-global and unique; persisted records are not user-tenant partitions."
- "Archive hides a profile from new selection without destroying its record; permanent delete and audit semantics are explicit."
- "A profile rename preserves old session profile-name resolution through an alias."
- "Stale references degrade with observable diagnostics/warnings; do not claim every invalid resource fails persistence."

Persistence and lifecycle state: chat-agents.sqlite plus in-memory plugin profile registrations.

# Requirements and invariants

## Requirement: RES-AGT-001: Validate custom-agent runtime selection on create/update, reject runtime error diagnostics, and preserve diagnosable degradation for stale catalog references during profile construction

Validate custom-agent runtime selection on create/update, reject runtime error diagnostics, and preserve diagnosable degradation for stale catalog references during profile construction.

**Implementation state:** `implemented_at_baseline` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/apps/chat/web-app.ts` — `requireValidCustomAgentRuntime`
- `src/apps/chat/web-app.ts` — `listBrokenNativeTools`
- `src/apps/chat/web-app.ts` — `listBrokenContextFiles`
- `src/apps/chat/agent-profiles.ts` — `createCustomAgentRuntimeValidationProfile`
- `src/apps/chat/agent-profiles.ts` — `createCustomAgentProfileDefinition`

**Named test traceability:**
- `test/web-channel.test.mjs` — `chat Agent Designer exposes runtime diagnostics and rejects invalid runtime selections`
- `test/web-channel.test.mjs` — `chat web app surfaces broken custom agent context files and allows cleanup`
- `test/agent-profiles.test.mjs` — `custom agent profiles skip unknown context file references`
- `test/agent-profiles.test.mjs` — `custom agent profiles skip unknown skill references`
- `test/chat-custom-agent-profiles.test.mjs` — `stale custom agent tool references do not break the profile catalog`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-AGT-002: Persist app-global custom agents, folders, rename aliases, archive state, and audit events with migration-safe defaults and uniqueness

Persist app-global custom agents, folders, rename aliases, archive state, and audit events with migration-safe defaults and uniqueness.

**Implementation state:** `implemented_at_baseline` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/apps/chat/agent-store.ts` — `CustomAgentStore`
- `src/apps/chat/agent-store.ts` — `createDefaultCustomAgentStore`
- `src/apps/chat/agent-store.ts` — `isValidCustomAgentName`

**Named test traceability:**
- `test/agent-store.test.mjs` — `custom agent store migrates old app-context tables with stable defaults`
- `test/agent-store.test.mjs` — `custom agent store organizes agents in durable renamable folders`
- `test/agent-store.test.mjs` — `custom agent store records agent rename and deletion history`
- `test/agent-store.test.mjs` — `custom agent names are globally unique and lists are app-global across legacy accounts`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-AGT-003: Preserve configured runtime, adapter options, model/fallback, thinking/fast, subagent, MCP, Pi-package, tool, skill, and context selections in the profile input and expose runtime validation diagnostics without redefining effective runtime resolution

Preserve configured runtime, adapter options, model/fallback, thinking/fast, subagent, MCP, Pi-package, tool, skill, and context selections in the profile input and expose runtime validation diagnostics without redefining effective runtime resolution.

**Implementation state:** `implemented_at_baseline_with_RUN_008_boundary` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `medium`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/core/profiles.ts` — `InitialSessionContext`
- `src/core/profiles.ts` — `InitialSessionContextBuilder`
- `src/core/profiles.ts` — `normalizeToolProfile`
- `src/apps/chat/agent-store.ts` — `CustomAgentDefinition`
- `src/apps/chat/agent-store.ts` — `CreateCustomAgentInput`
- `src/apps/chat/agent-store.ts` — `UpdateCustomAgentInput`

**Named test traceability:**
- `test/agent-profiles.test.mjs` — `custom agent profiles preserve the persisted runtime selection and options`
- `test/agent-profiles.test.mjs` — `custom agent profiles preserve per-subagent execution settings`
- `test/agent-store.test.mjs` — `custom agent store persists ordered main provider fallbacks and legacy subagent model overrides`
- `test/agent-store.test.mjs` — `custom agent store persists thinking, fast, and built-in mode options`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-AGT-004: Freeze a session's selected profile after its first trace event and keep renamed profile aliases resolvable for existing sessions

Freeze a session's selected profile after its first trace event and keep renamed profile aliases resolvable for existing sessions.

**Implementation state:** `implemented_at_baseline_with_session_state_dependency` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/apps/chat/agent-store.ts` — `CustomAgentStore`
- `src/apps/chat/web-app.ts` — `sessionResourceId`
- `src/apps/chat/web-app.ts` — `createSessionUpdate`
- `src/plugins/chat-custom-agents.ts` — `createPiboChatCustomAgentProfilesPlugin`

**Named test traceability:**
- `test/agent-store.test.mjs` — `custom agent profile renames leave old session profile names resolvable`
- `test/web-channel.test.mjs` — `chat web app changes session profiles only before the first trace event`
- `test/web-channel.test.mjs` — `chat web app canonicalizes legacy custom agent session profile aliases`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


# Interfaces and ownership

Capability IDs: "pibo.resources.agents".

Exact source files inspected for this owner:
- "src/apps/chat/agent-profiles.ts"
- "src/apps/chat/agent-store.ts"
- "src/apps/chat/web-app.ts"
- "src/core/profiles.ts"
- "src/plugins/chat-custom-agents.ts"

Related ownership boundaries:
- SPC-PROD-002: [plugin-profile-catalog.md](/specs/product/plugin-profile-catalog.md) owns the linked contract; this specification does not duplicate it.
- SPC-RUN-008: [provider-model-controls.md](/specs/runtime/provider-model-controls.md) owns the linked contract; this specification does not duplicate it.
- SPC-RUN-003: [generation-resources-and-portable-tools.md](/specs/runtime/generation-resources-and-portable-tools.md) owns the linked contract; this specification does not duplicate it.
- SPC-GW-003: [web-host-and-channel.md](/specs/gateway/web-host-and-channel.md) owns the linked contract; this specification does not duplicate it.

The security policy/mechanics split is explicit: this specification defines the resource or security decision, while linked runtime, gateway, data, web, orchestration, compute, and operator owners provide their execution mechanics.

# Failure, security, privacy, and compatibility behavior

- "Catalogs expose safe metadata and disabled reasons; hard runtime validation errors reject create/update, while stale or unknown skill/context/tool references may be skipped and only some produce diagnostics."
- "Catalogs expose safe metadata; stale or unknown references may be skipped, with diagnostics for skills/context and a warning for stale tools."

Compatibility and privacy limits:
- "Names are app-global and unique; persisted records are not user-tenant partitions."
- "Archive hides a profile from new selection without destroying its record; permanent delete and audit semantics are explicit."
- "A profile rename preserves old session profile-name resolution through an alias."
- "Stale references degrade with observable diagnostics/warnings; do not claim every invalid resource fails persistence."

# Known limits and rejected stale claims

The following over-broad claims are rejected and must not be inferred from this specification:

- **Rejected claim:** Every invalid custom-agent resource selection fails persistence. — Runtime errors fail create/update, but stale skills/context/tools are skipped during profile construction; only some produce structured diagnostics.

Open evidence gaps carried forward:
- `WP03-GAP-009` — Canonical synthesis and this read-only brief executed no focused tests, build/package checks, real paths, browser flows, or external/Pibo2 acceptance.

# Verification and traceability

All requirement traceability records use exact repository-relative regular files at `38bb6e57f118c1543e7263c68d27e5103d3b1262`. The brief and synthesis were generated from a stale baseline, so this package deliberately rebinds operational authority to `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

Performed evidence:
- Source inspection: performed. Exact source paths, symbols, test paths, test names, ownership seams, and the accepted parent commit were checked.

Additional unperformed evidence:
- No browser, real provider, external MCP, real Pi package, Windows ACL/auth-recovery, real-host/systemd/pressure/restart, or Pibo2 evidence is claimed.

Package commands after authoring:
- `npm run typecheck` — passed
- `npm run build` — passed, with existing Vite chunk-size warnings
- Exact focused test inventory from the WP-03 brief — 385 tests: 383 passed and 2 identical local-auth baseline failures in exact parent/candidate runs
- Foundation validator/authoring suite — 82 passed

# Related concepts

- [SPC-PROD-002](/specs/product/plugin-profile-catalog.md)
- [SPC-RUN-008](/specs/runtime/provider-model-controls.md)
- [SPC-RUN-003](/specs/runtime/generation-resources-and-portable-tools.md)
- [SPC-GW-003](/specs/gateway/web-host-and-channel.md)
