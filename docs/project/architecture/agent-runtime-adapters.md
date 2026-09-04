---
type: "Decision Record"
title: "Agent Runtime Adapter Architecture"
description: "Records supporting architecture decisions for Pibo agent-runtime adapters and portable capability delivery."
tags: ["agent-runtime", "architecture", "runtime-adapters"]
status: "draft"
authority: "supporting"
migration_lineage:
  source_path: "docs/project/architecture/agent-runtime-adapters.md"
  source_commit: "debba32a68137205df6351da9f3ae461004ca0c0"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "615ebce57115f226861c082792641086a7bcefd7"
  source_bytes: 14808
  source_sha256: "d9c54284fbcdd86f3b2b0185b1087fd5c62ec82e9ef439033a27f91d93362d6d"
  source_body_sha256: "d9c54284fbcdd86f3b2b0185b1087fd5c62ec82e9ef439033a27f91d93362d6d"
generated:
  by: "openai/codex"
  at: "2026-09-04T14:26:38Z"
---
# Agent Runtime Adapter Architecture

**Updated:** 2026-09-04

Pibo supports multiple agent harnesses through a Pibo-owned runtime adapter boundary. Pibo remains the product and orchestration layer; Pi Coding Agent and Codex own their native model loops, prompts, tools, and resume state.

This document is the canonical implementation overview. Runtime-history details live in [`../agent-runtime-history-and-debug.md`](../agent-runtime-history-and-debug.md), and the message call flow lives in [`chat-runtime-call-stack.md`](./chat-runtime-call-stack.md). Exact integrated evidence is recorded in [`../../reports/multi-agent-runtime-adapter-integrated-validation-2026-08-16.md`](../../reports/multi-agent-runtime-adapter-integrated-validation-2026-08-16.md) and the focused [`runtime auth validation`](../../reports/runtime-auth-control-plane-validation-2026-08-16.md), with requirement status in the [`final audit`](../../reports/multi-agent-runtime-adapter-final-audit-2026-08-16.md).

## Ownership boundary

| Pibo owns | Runtime adapters own |
|---|---|
| Pibo Sessions, rooms, projects, profiles, Agent Designer, routing, queues, workflows, Cron, Loops, goals, subagents, signals, product history, trace/debug, provider-auth UX/intent/targeting, and durable product data | Native process or SDK lifecycle, native prompt and standard tools, native session/thread identity, native protocol messages, native history/resume state, harness-specific controls, provider login protocol, and credential persistence/isolation |

Generic orchestration does not import Pi or Codex packages and does not branch on an adapter id when capability dispatch is sufficient.

## Runtime concepts

### Adapter descriptor

An `AgentRuntimeAdapterDescriptor` declares a stable adapter id, configuration schema, diagnostics, protocol metadata, and maximum capabilities. A driver validates configured instances and opens live sessions.

### Configured runtime instance

A configured runtime instance is a named adapter configuration registered in `AgentRuntimeAdapterRegistry`. Profiles select an instance id, not an adapter class. The built-in instances are:

- `pi` — embedded Pi Coding Agent; the default.
- `codex-native` — official Codex App Server v2 over stdio JSON-RPC.

The configured-instance registry is separate from live runtime sessions. Multiple instances may use the same adapter with isolated configuration.

### Runtime session binding

`PiboSession.id` is the only product routing identity. `session_runtime_bindings` stores the opaque runtime link:

- configured runtime instance and adapter ids;
- optional native session/thread id;
- `unbound`, `bound`, `missing`, or `error` state;
- protocol and adapter versions;
- adapter-resolved locator and bounded metadata;
- compare-and-set revision.

A profile supplies the default only when a Pibo Session is created. The selected instance is frozen for that session. Parent and child sessions freeze bindings independently, so a Pi parent may create a Codex child and vice versa.

### Runtime session generation

Each live router generation receives a random generation id. Portable-tool credentials, generated resource files, adapter environment, and child process state are scoped to that generation and are revoked or deleted together.

### Runtime provider authentication

Provider authentication is configured-runtime state, not Pibo Session state. `capabilities.auth` declares status support, Pibo-owned method ids and completion modes, cancellation/logout, and whether credentials are `runtime-instance` or `adapter-shared` scoped. Registration rejects a declaration that lacks the matching adapter operation.

Chat Web's product-scoped provider settings API requires an explicit runtime instance for every mutation. Legacy `login.*` actions remain available for Terminal/TUI clients, but they target the active Pibo Session's frozen runtime binding and reject a conflicting explicit target. Public status and flow objects contain only Pibo ids and safe metadata. An active interactive flow may include its bounded authorization URL and one-time code; native login ids, separate OAuth state/verifier fields, tokens, API keys, account identifiers, credential paths, and credential-file content remain adapter-private, and ephemeral flow URLs/codes are not captured in product history or validation evidence.

The settings catalog groups providers by configured runtime, identifies the default runtime, explains credential scope, and aggregates connected, disconnected, pending, partial, unsupported, and failed states. Models are joined to auth for the same runtime instance. Missing status for an auth-requiring runtime is never interpreted as authenticated. A terminal auth mutation recycles cached sessions across the declared credential scope: one instance for `runtime-instance`, or every configured instance of the same adapter for `adapter-shared`.

## Registration and startup flow

1. Plugins register adapter drivers and configured instances.
2. A profile selects a configured instance and adapter-native options.
3. Session creation validates the profile against the selected instance's effective capabilities.
4. Pibo persists an `unbound` binding before opening the harness.
5. The router prepares selected Pibo tools and a `PiboRuntimeResourceSession` using one generation id.
6. The adapter starts or resumes its native session and returns a live capability snapshot.
7. Pibo persists the native id and binding state with compare-and-set semantics.
8. `RoutedSession` accepts product input, invokes the generic runtime session, and maps semantic events into Pibo output events.
9. Terminal paths dispose the adapter, revoke credentials, cancel active child work, and delete generated resources.

Missing native state is visible. The adapter marks the binding `missing`; it never creates a replacement conversation silently.

## Turn and event flow

A runtime session implements generic operations for text prompt, subscription, status, abort, disposal, and capability-gated controls. It emits `AgentRuntimeSemanticEvent` values such as:

- assistant and reasoning deltas/messages;
- tool call/start/update/finish;
- usage and context updates;
- compaction lifecycle;
- approval and structured-input requests;
- warnings, normalized errors, and bounded native events.

`RoutedSession` owns queue state, Pibo event ids, turn correlation, single terminalization, and conversion to the existing product event contract. Product history is persisted before the browser or another channel receives the normalized event.

## Pi adapter

The Pi adapter wraps the existing embedded Pi behavior rather than reimplementing it. It owns:

- Pi service/runtime assembly and `SessionManager` persistence;
- Pi `AuthStorage`, OAuth/device/browser flows, API keys, logout, and model registry integration;
- built-in Pi tools, packages, skills, context, extensions, compaction, and recovery;
- Pi transcript history, fork/clone/tree/session operations;
- Pi event normalization and compatibility projections.

Pibo's Pi base prompt remains Pi-only behavior. Existing Pi session ids and JSONL files are not rewritten. The deprecated `pi_session_id` compatibility field is dual-written for Pi bindings during the compatibility period. Pi's existing provider store is truthfully declared `adapter-shared`; Pibo does not emulate per-instance accounts on top of it.

## Native Codex adapter

`codex-native` uses the official Codex App Server v2 JSONL/JSON-RPC protocol. It does not scrape terminal output and does not reuse Pibo's Pi Codex-compatibility prompt.

The adapter owns:

- exact executable/version diagnostics and a private configured-instance Codex home;
- stable `account/read`, managed device-code/API-key `account/login/start`, completion notification, cancellation, and logout operations in that private home;
- bounded stdio RPC, initialization, correlation, backpressure, retries, stderr, timeout, abort, and shutdown;
- stable thread start/resume/read/list/fork and missing-thread handling;
- turn start/steer/interrupt and native item/event normalization;
- command/file approvals and explicitly opted-in structured user input;
- model catalog, reasoning effort, service tier, usage, and native history;
- selected MCP, skills, and developer/project context through official Codex configuration fields.

Codex's base prompt and standard tools remain native. Pibo adds only explicit product context and selected resources. Stable Codex `0.153.2` does not expose a complete pre-turn native-tool inventory, so inspection is truthfully degraded: selected MCP tools are known immediately, while native names are reported only after stable item notifications prove use. Native-tool yielding remains unsupported.

The existing Pi-backed `codex-compat-openai-web` profile and explicit `codex` alias keep their old meaning. `codex-native` is distinct and has no implicit `codex` alias.

## Portable capabilities

### Pibo tools

Pibo tools use a Pibo-owned JSON-Schema definition and result contract. Pi compiles selected tools to direct in-process Pi definitions. External harnesses receive portable tools through a loopback Streamable HTTP MCP bridge.

The bridge credential is short-lived and bound to one Pibo Session, runtime instance, adapter, generation, and selected tool allowlist. Only its hash is stored. Cross-session, stale, revoked, wrong-instance, and removed-tool access is denied.

Codex receives `default_tools_approval_mode = "approve"` only on the generated, credential-allowlisted Pibo MCP server. External MCP servers retain their native approval policy.

### External MCP

Only selected external HTTP or stdio definitions are materialized. Secret values are rebound through generation-scoped environment variables; generated config stores references, not resolved secrets. Pibo connects to each selected server and verifies identity and inventory before claiming delivery.

### Skills and context

`SKILL.md` remains canonical. Pibo copies only selected skill roots into a private generation tree and rejects symlink escapes, cycles, and configured limits. Selected context contributions retain order, intent, source, delivery mode, and fidelity.

Pi uses its native loaders. Codex receives selected skills through isolated extra roots, explicit Pibo context through bounded developer instructions, and project instructions through native project discovery. Pibo never replaces the harness base prompt.

### Subagents, workflows, and jobs

Pibo-managed delegated agents remain Pibo capabilities. `pibo_agents_send_message` is dispatched only through `pibo_run_start`; list, observe, and kill remain direct management tools. Every send requires a nonblank `sessionName` of at most 40 Unicode code points; Pibo trims it and rejects invalid nested target arguments before creating a run. A send creates or reuses a child Pibo Session with its own frozen target-profile binding and uses the normalized name as its title. Stable thread keys are bounded, and parent interruption cancels active child work recursively while preserving reusable child identity. Normal parent-turn completion, bounded `pibo_run_wait` expiry, and stale telemetry do not cancel the child request.

Cron, Loop, and workflow execution create normal Pibo Sessions through the same router. Their runtime is selected by profile and requires no harness-specific product fork.

## History, trace, and debug

Pibo product history is primary for new routed turns. Adapter-native history is used for resume, migration compatibility, repair, explicit native-history inspection, and debugging. Opaque native-history cursors are scoped to the Pibo Session and frozen binding.

Runtime-neutral debug starts with:

```text
pibo debug session <ps_...>
pibo debug trace <ps_...> --check
pibo debug messages <ps_...> list
pibo debug events <ps_...> --limit 20
pibo debug failures <ps_...>
```

Default output includes safe runtime identity and binding state. It does not expose credentials, raw environment, runtime config, locator values, or binding metadata values.

## Security and cleanup invariants

- Runtime homes and generation directories are private and selected-only.
- Runtime credentials and resolved external MCP secrets exist only in adapter-owned stores/process state/environment.
- Native Codex account state persists only in the selected configured instance's private `CODEX_HOME`; Pi and separate Codex instances are never credential-copy sources.
- Pending provider-login processes are bounded and closed on completion, cancellation, timeout, failure, or adapter disposal.
- Pibo MCP credentials are scoped, short-lived, renewed only for active work, and revoked on every terminal path.
- Pending requests are bounded, redacted, turn/thread scoped, resolved at most once, and cleared on interruption, crash, disposal, or restart.
- Adapters bound message, pending-request, stderr, native-event, history, retry, and shutdown resources.
- Global Pi or Codex configuration is not mutated to start a session.
- Official target-managed authentication is required for native Codex; copying local credentials or using unsupported token shortcuts is not an integration path.

## Migration and rollback boundary

Schema v4 added the binding table and backfilled existing sessions as bound Pi without changing Pibo ids, Pi ids, or transcript paths. Schema v5 added product-history compatibility metadata without changing binding revisions or native identities.

An old Pi-only binary can ignore the additive binding table and continue operating Pi rows. It cannot run native Codex sessions. After non-Pi sessions exist, rollback therefore means either retaining a runtime-aware binary or accepting that those sessions are unavailable; automatic conversion to Pi is forbidden. Back up `pibo.sqlite` and payload storage before any destructive operator rollback.

## Extension checklist

A new adapter must prove, not infer:

1. driver identity, config validation, diagnostics, and process isolation;
2. binding lifecycle, resume, missing-state behavior, and cleanup;
3. capability declarations matched by implemented methods;
4. semantic event and error normalization with one terminal result;
5. native prompt/tool preservation;
6. Designer save validation and disabled explanations;
7. Pibo tools, selected MCP, skills, context, and subagent delivery where claimed;
8. product history, native history, trace, and debug integration;
9. auth capability/operation consistency, explicit target routing, credential scope/isolation, timeout/cancel/restart/redaction evidence;
10. deterministic contract coverage and exact-binary integrated validation.

The built-in `pibo-agent-runtime-adapter` skill contains the detailed authoring procedure and evidence checklist.
