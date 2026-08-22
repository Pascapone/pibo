# Capability Spec: Runtime Portability and Handoff

## Scope

This capability makes Pibo-owned conversations portable across configured agent-runtime instances without pretending that different native harnesses share an identical transcript or feature model.

## Requirements

### RP-001: Capability-driven runtime controls

Every runtime adapter MUST advertise:

- `contextDiscovery.supported`, `contextDiscovery.configurable`, and `contextDiscovery.enabledByDefault`;
- optional `contextDiscovery.strategy` plus ordered `knownFileNames`, `knownUserRelativePaths`, `knownCwdRelativePaths`, `knownRelativePaths`, and `knownAncestorRelativePaths` for exact native-discovery deduplication;
- `nativeSubagents.supported`, `nativeSubagents.configurable`, and `nativeSubagents.enabledByDefault`;
- boolean `historyImport` support.

Pibo MUST reject invalid capability combinations during adapter/profile validation. UI and routing behavior MUST derive from these contracts rather than adapter IDs.

#### Scenario: Native subagents are not configurable

- **Given** a runtime reports `nativeSubagents.configurable` as `false`
- **When** Agent Designer renders that runtime
- **Then** it MUST hide the native-subagent control
- **And** stale nullable overrides MUST be removed when the runtime changes.

### RP-002: Legacy automatic-context compatibility

`autoContextFiles` MUST remain a required persisted boolean with default `true`. A nullable API input MUST reset it to `true`; no second nullable database column may replace this legacy field.

The runtime capability determines whether the setting is configurable or effective. Profiles MAY use nullable capability-aware overrides, but persisted custom-agent records MUST continue to expose a concrete boolean.

### RP-003: Native Codex compaction

For native Codex, manual `/compact` MUST call stable Codex App Server v2 method `thread/compact/start` on the bound thread. Pibo MUST emit balanced compaction start/end semantic events and preserve session identity.

If optional custom instructions cannot be represented by the stable method, Pibo MUST disclose that they were ignored instead of claiming support.

### RP-004: Portable cross-runtime history handoff

A runtime change MUST either:

1. create a bounded Pibo portable-history handoff and import it before the target receives its first new prompt; or
2. use an explicit `startFresh` request that intentionally discards prior history.

A normal cross-runtime change MUST fail when the target reports `historyImport: false`.

The handoff MUST:

- derive from Pibo-owned session history rather than native credential or harness files;
- preserve ordered user, assistant, system, tool-call, and tool-result meaning where available;
- redact known credentials and authorization material;
- impose entry, per-entry, and total-byte limits;
- add explicit omission/truncation markers rather than silently dropping content;
- produce deterministic fallbacks for unmatched tool calls/results;
- record source and target runtime IDs, a checkpoint, status, and bounded counts;
- use `pending` and `completed` states so retries do not duplicate a completed import;
- reject malformed or target-mismatched handoff metadata rather than silently continuing.

A cross-runtime request MUST create a new native target session and MUST reject caller-supplied native IDs or locators. Source-runtime model IDs, runtime options, and native feature flags MUST NOT leak into the target runtime namespace.

#### Scenario: Retry after target creation failure

- **Given** a pending handoff whose target import did not complete
- **When** the same binding operation is retried
- **Then** Pibo MUST reuse the same bounded checkpoint semantics
- **And** MUST NOT mark the handoff complete until import succeeds.

#### Scenario: Retry after completed import

- **Given** a completed handoff for the current target binding
- **When** session restoration runs again
- **Then** Pibo MUST NOT import the same entries a second time.

### RP-005: Adapter-native import semantics

- Pi MUST import compatible entries through `SessionManager.appendMessage` without fabricating Pi compaction or branch-summary records.
- Native Codex MUST import through stable App Server v2 method `thread/inject_items`.
- OMP MUST receive a clearly labeled bounded append-only history handoff in a private session prompt file; Pibo MUST NOT fabricate an OMP transcript.

Pibo MUST persist enough binding audit metadata to prove the requested checkpoint was imported by the target adapter.

### RP-006: Context discovery and deduplication

Adapters MUST own inspection of their native context behavior. Pibo MAY remove an explicitly selected context resource only when all of the following are true:

- the adapter advertises the exact source pattern in its `contextDiscovery.known*` path fields;
- native discovery is enabled for the session;
- the selected resource resolves to the same canonical file the runtime will load;
- the runtime discovery scope covers the current working directory.

Deduplication MUST compare canonical paths, not basenames. Explicitly selected files with the same basename at another path MUST remain selected.

Native Codex override precedence and OMP provider-specific discovery scope MUST be represented by adapter-owned inspection. OMP `.agent/.agents` context may be discovered at every ancestor while nearest-only provider files remain nearest-only.

### RP-007: OMP additive selected context

Selected Pibo context for OMP MUST be delivered through a private, disposable, session-scoped file passed with `--append-system-prompt`.

The generated prompt MUST:

- be additive to OMP's native system prompt;
- contain bounded selected Pibo context and portable history sections;
- preserve selected-resource order;
- omit exact native-discovery duplicates;
- be replaced or removed when later turns no longer select the same material;
- never mutate the workspace or global OMP configuration.

### RP-008: Native-subagent policy

When native subagents are disabled for a configurable runtime, the adapter MUST enforce that policy at native startup and tool execution boundaries.

- Native Codex MUST disable both stable multi-agent feature generations and set `agents.enabled=false` so model-catalog hints cannot re-enable native subagents.
- OMP MUST configure all discovered task agents as disabled and deny native task-tool execution.

Portable Pibo tools and Pibo child-session/subagent behavior remain separate capabilities and MUST NOT be disabled as a side effect.

### RP-009: Selected-skill priority and collisions

An explicitly selected Pibo skill MUST take priority over an ambient native skill with the same normalized name.

Adapters MUST either load the selected skill from its intended path with deterministic precedence or fail with a collision error. Name-only discovery MUST NOT be accepted as proof that the selected skill was delivered.

### RP-010: Security and privacy

Runtime homes, generated prompts, handoff records, and resource inspection details MUST remain private to the selected runtime instance and session. Files MUST use owner-only access where supported, persist only when needed for native-session resume, and be replaced or removed when an explicit reset discards that context. Ephemeral process-generation artifacts MUST be removed on adapter disposal.

Logs, events, API errors, and audit metadata MUST redact credentials, cookies, authorization headers, account identifiers, native login state, and credential paths/content. Public APIs MUST expose bounded product-owned metadata only.

### RP-011: Compatibility

- Pi behavior, Pi-backed custom runtime IDs, frozen bindings, and legacy normalization MUST remain compatible.
- Existing runtime identifier `codex` MUST keep its established Pi-backed meaning; native Codex remains `codex-native`.
- Child sessions MUST retain independent frozen bindings.
- Missing native sessions MUST become `missing`; they MUST NOT silently restart.
- Same-runtime repair/rebind behavior MUST not require a portability handoff.

## Acceptance Criteria

1. Capability, profile, store, API, UI, router, resource, and adapter tests pass.
2. Typecheck and production builds pass with the repository-supported heap limit.
3. Full canonical tests pass without changing the project-wide baseline.
4. Native Codex tests prove `thread/inject_items`, `thread/compact/start`, feature disabling, and selected-skill collision rejection.
5. OMP tests prove private additive prompt delivery, stale-file cleanup, context-discovery scope, selected-skill precedence, and native-task suppression.
6. A disposable integrated Pibo2 candidate proves the public Chat Web/API path for rebinding, compaction, context/resource behavior, and runtime controls.
7. Validation records clearly separate deterministic evidence from authenticated production-provider proof and list any external release gates.
