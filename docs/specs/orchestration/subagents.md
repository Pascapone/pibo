---
type: Specification
title: Delegated Agents and Reusable Child Sessions
description: Defines the implemented delegated agents and reusable child sessions contract and its current ownership, security,
  compatibility, and verification boundaries.
tags:
- orchestration
- workflows
status: stable
authority: normative
generated:
  by: openai/codex
  at: '2026-09-05T09:32:09Z'
sources:
- resource: scope:Current implementation and tests at traceability.commit
  title: Committed implementation and test evidence for SPC-ORCH-002
implementation:
  state: current
  baseline_commit: 9fa9b446242dd7fbac7ce49e44434cfca51a209e
  package: WP-04-ORCHESTRATION
  source_evidence: performed
  focused_test_execution: performed in Docker after authoring; see implementation report
  build_and_typecheck_execution: performed in Docker after authoring; see implementation report
traceability:
  commit: 9fa9b446242dd7fbac7ce49e44434cfca51a209e
  requirements:
  - id: ORCH-SUB-001
    status: implemented
    sources:
    - path: src/subagents/tool.ts
      symbol: PIBO_AGENT_TOOL_NAMES
    - path: src/subagents/tool.ts
      symbol: createAgentToolDefinitions
    tests:
    - path: test/subagents.test.mjs
      name: delegated agents expose four stable shared tools and reject duplicate exact names
    - path: test/subagents.test.mjs
      name: run start prepares selected delegated input before admission and persists the prepared arguments
    failures:
    - Direct send invocation fails before child creation; arguments are normalized before admission/persistence.
    confidence: high
  - id: ORCH-SUB-002
    status: implemented
    sources:
    - path: src/subagents/tool.ts
      symbol: PIBO_AGENT_SESSION_NAME_MAX_LENGTH
    - path: src/subagents/tool.ts
      symbol: normalizePiboAgentSessionName
    - path: src/core/session-router.ts
      symbol: DEFAULT_SUBAGENT_MAX_DEPTH
    - path: src/core/session-router.ts
      symbol: MAX_SUBAGENT_THREAD_KEY_BYTES
    - path: src/core/session-router.ts
      symbol: PiboSessionRouter.resolveSubagentSession
      owner: PiboSessionRouter
      member: resolveSubagentSession
    tests:
    - path: test/subagents.test.mjs
      name: agents controller requires bounded Unicode names and updates reused titles
    - path: test/subagents.test.mjs
      name: named sends reuse and upgrade existing legacy child sessions
    - path: test/subagents.test.mjs
      name: router omits subagent tools that have reached their max depth
    failures:
    - Invalid/cancelled requests create no child; only direct children of the controller are reusable or manageable.
    confidence: high
  - id: ORCH-SUB-003
    status: implemented
    sources:
    - path: src/subagents/runtime-selection.ts
      symbol: resolvePiboSubagentRuntimeSelection
    - path: src/subagents/runtime-selection.ts
      symbol: resolvePiboSubagentRuntimeSelections
    - path: src/core/session-router.ts
      symbol: PiboSessionRouter
    - path: src/subagents/observation-query.ts
      symbol: preparePiboAgentObservationQuery
    - path: src/subagents/observation-query.ts
      symbol: selectPiboAgentObservationPage
    - path: src/debug/agents.ts
      symbol: runDebugAgentsCli
    tests:
    - path: test/subagents.test.mjs
      name: subagent runner freezes per-subagent model, thinking, and runtime overrides on new child sessions
    - path: test/codex-native-subagents.test.mjs
      name: Codex native invokes yielded-only Pibo subagents through scoped MCP on a different runtime
    - path: test/codex-native-subagents.test.mjs
      name: a Pi parent yielded subagent request creates and reuses a native Codex child binding
    failures:
    - Unknown targets or unavailable runtime bindings fail before delegated execution; child binding cannot silently inherit
      a different parent adapter.
    confidence: high
  - id: ORCH-SUB-004
    status: implemented
    sources:
    - path: src/subagents/observations.ts
      symbol: PIBO_AGENT_OBSERVATION_DEFAULT_LIMIT
    - path: src/subagents/observations.ts
      symbol: PIBO_AGENT_OBSERVATION_MAX_LIMIT
    - path: src/subagents/observations.ts
      symbol: normalizePiboAgentObservationLimit
    - path: src/core/session-router.ts
      symbol: PiboSessionRouter
    tests:
    - path: test/subagents.test.mjs
      name: agents controller lists, filters observations, kills owned children, and does not reuse killed threads
    - path: test/subagents.test.mjs
      name: cancelling a queued delegated run leaves the active request on the shared thread running
    - path: test/subagents.test.mjs
      name: bounded run waits do not cancel delegated agents and explicit cancellation preserves thread reuse
    - path: test/subagents.test.mjs
      name: agent observation polling is cursor-safe in descending order and reports retention loss
    - path: test/debug-agents.test.mjs
      name: debug delegated-agent CLI exposes and executes the shared observation filters
    failures:
    - Cross-parent child access is rejected; targeted abort rejection/non-settlement is surfaced rather than reported as cancellation.
    confidence: high
  - id: ORCH-SUB-005
    status: implemented
    sources:
    - path: src/subagents/tool.ts
      symbol: PiboAgentObserveInput
    - path: src/subagents/tool.ts
      symbol: createAgentToolDefinitions
    - path: src/subagents/context.ts
      symbol: getDelegatedAgentContextFile
    - path: src/subagents/observation-query.ts
      symbol: preparePiboAgentObservationQuery
    - path: src/subagents/observation-query.ts
      symbol: selectPiboAgentObservationPage
    - path: src/subagents/observation-text-regex.ts
      symbol: preparePiboAgentObservationTextRegex
    - path: src/subagents/observation-text-regex.ts
      symbol: matchPiboAgentObservationTextRegex
    - path: src/debug/agents.ts
      symbol: runDebugAgentsCli
    tests:
    - path: test/subagents.test.mjs
      name: delegated agents expose four stable shared tools and reject duplicate exact names
    - path: test/subagents.test.mjs
      name: profiles can expose subagents as active router tools
    - path: test/subagents.test.mjs
      name: agents controller lists, filters observations, kills owned children, and does not reuse killed threads
    - path: test/subagents.test.mjs
      name: agent observation regex bounds dense and empty matches by the input batch
    - path: test/subagents.test.mjs
      name: agent observation regex treats empty text as one null-data record
    - path: test/subagents.test.mjs
      name: agent observation regex streams sparse fixed batches with stable cursor pagination
    - path: test/subagents.test.mjs
      name: agent observation regex rejects NUL boundaries without leaking process errors
    - path: test/subagents.test.mjs
      name: agent observation regex resolves the optional platform binary only for regex queries
    - path: test/subagents.test.mjs
      name: agent observation regex preserves null-data anchors and inline multiline flags
    - path: test/debug-agents.test.mjs
      name: debug delegated-agent inspection lists owned children and applies exact observation filters
    - path: test/debug-agents.test.mjs
      name: debug delegated-agent CLI exposes and executes the shared observation filters
    failures:
    - Invalid textRegex inputs fail with a deterministic error before observation results are returned.
    - NUL text and literal or escaped NUL patterns are rejected instead of crossing observation boundaries or reaching Node process errors.
    - Regex use fails with an explicit availability error when the optional rg platform binary is absent; non-regex filters remain available.
    confidence: high
---
# Spec: Delegated Agents and Reusable Child Sessions


## Why

Delegation needs durable child identity and exact request control. A parent must be able to reuse a child without accidentally cancelling another request or treating telemetry as lifecycle authority.

## Goal

The registered agent tools define yielded-only sends, bounded observation, independent child runtime binding, and exact cancellation/kill ownership.

## Authority and ownership

- **Stable concept:** `SPC-ORCH-002`
- **Target path:** `docs/specs/orchestration/subagents.md`
- **Authority:** Current source and test evidence at `9fa9b446242dd7fbac7ce49e44434cfca51a209e`.
- **Normative owner:** This document owns the public surfaces and behavior listed below. Generic reliability schemas, product/session topology, gateway authorization, runtime adapters, resource policy, and Web rendering remain owned by their linked specifications.
- **Evidence rule:** Source and named-test locators are exact references to regular Git blobs at the committed implementation candidate. They identify evidence; they do not imply that real CLI, process, provider, browser, Windows, host-pressure, restart, or Pibo2 paths were executed.

## Public surfaces

- `pibo_agents_send_message`
- `pibo_agents_list_agents`
- `pibo_agents_observe`
- `pibo_agents_kill`

## Current implemented contract

### Commands Api

send is yielded-only and throws on direct execution; list/observe/kill are direct management tools. A required trimmed sessionName is limited to 40 Unicode code points; threadKey is trimmed, generated when omitted, and limited to 512 UTF-8 bytes.

### State Lifetime

Children are direct owned subagent sessions with independent bindings. Default maximum depth is 1 unless a profile overrides it. Parent turn completion, pibo_run_wait timeout, and stale telemetry do not stop active child work; exact cancellation, parent abort, kill, or disposal does.

### Observation

Observe defaults to the newest 20 completed assistant messages with tools hidden, caps the requested limit at 200, filters at most 50 exact IDs/keys, and bounds text/tool/details to 4 KiB/768 B/32 KiB with cursor and retention-loss reporting. Live router observation and persisted `pibo debug agents ... observe` share one query policy for role, identity, event, kind, time, text, tool-call, tool-visibility/detail, ordering, limits, and cursor-safe page selection. Persisted cursors are durable `streamId` values; live cursors remain router-lifetime `sequence` values, and yielded request IDs remain live-only until event-log provenance exists.

#### Shared observation core

The normalized observation contract and query policy own source-independent filtering, matching, bounding, visibility, ordering, pagination, and truncation semantics. Live and persisted adapters supply normalized observations and translate only source-specific identity, cursor, and lifetime differences instead of reimplementing those semantics.

When shared observation behavior grows, every adapter MUST inherit the new semantics through the common policy wherever its source can represent the required data. Any adapter-specific divergence requires an explicit documented source-lifetime or durability constraint and corresponding acceptance coverage.

The complete optional Observe filter surface is:

```json
{
  "requestIds": ["run_..."],
  "toolCallIds": ["tool_..."],
  "agentIds": ["ps_..."],
  "names": ["worker"],
  "threadKeys": ["implementation"],
  "eventTypes": ["assistant_message"],
  "kinds": ["message"],
  "roles": ["assistant"],
  "since": "2026-09-04T16:00:00.000Z",
  "until": "2026-09-04T17:00:00.000Z",
  "textContains": "complete",
  "textRegex": "(?i)^alpha\\s+complete$",
  "afterSequence": 120,
  "order": "asc",
  "limit": 50,
  "includeTools": false,
  "toolDetail": "summary",
  "includeDetails": false
}
```

Array values use OR semantics within their field; different fields use AND semantics. `textContains` remains a case-insensitive substring match against normalized observation text. `textRegex` matches the same text with the bundled rg default Rust regex engine and is case-sensitive unless the pattern sets an inline flag such as `(?i)`. Rg's normal line-anchor behavior and inline multiline or dot-all flags apply. When callers provide both fields, both must match. Invalid Rust regex syntax fails with a deterministic validation error.

Regex candidates are consumed from the observation source in batches bounded to 128 observations and a 64 KiB target. Each candidate is searched as a separate private record, and rg emits at most one fixed identifier per matching observation, so dense valid patterns do not amplify output by submatch count. Pagination retains at most `limit + 1` matches, stops after that lookahead is found, and preserves sparse scans, source order, cursor behavior, and the existing no-regex fast path. Observation text containing a literal NUL and patterns containing a literal NUL or a Rust NUL escape are rejected deterministically because they cannot preserve the practical rg record contract safely. The optional platform rg binary is resolved only when `textRegex` is present; a missing binary does not affect unfiltered or `textContains` queries and produces a regex-specific availability error when requested. The persisted debug projection exposes the same regex filter as `pibo debug agents ... observe --regex <pattern>`.

### Compatibility

Legacy per-subagent factories remain exported but outside current runtime assembly; legacy subagentRunner calls fail with an explicit migration error.

## Scope

### In scope

- pibo_agents_send_message
- pibo_agents_list_agents
- pibo_agents_observe
- pibo_agents_kill
- The current source-grounded behavior and its explicit limits.
- Cross-owner links needed to use the contract safely.

### Out of scope

- Unimplemented future workflow webhook or Cron triggers.
- A claim that manual traversal and separate dispatch primitives form a universal integrated, restart-resuming graph executor.
- Provider, browser, host, Windows, Pibo2, or real process-path guarantees not established by executed validation.

## Requirements

### Requirement: ORCH-SUB-001

Delegated sends MUST execute only as the pibo_agents_send_message target of pibo_run_start; management list, observe, and kill remain direct tools.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at the committed implementation candidate; execution status is recorded in the implementation report.

#### Current behavior and limits

Direct send invocation fails before child creation; arguments are normalized before admission/persistence.

#### Acceptance evidence

- Exact source evidence:
  - `src/subagents/tool.ts:19` — `PIBO_AGENT_TOOL_NAMES` (constant)
  - `src/subagents/tool.ts:257` — `createAgentToolDefinitions` (exported_symbol)
- Exact named tests:
  - `test/subagents.test.mjs:174` — “delegated agents expose four stable shared tools and reject duplicate exact names”
  - `test/subagents.test.mjs:541` — “run start prepares selected delegated input before admission and persists the prepared arguments”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-SUB-002

A send MUST validate bounded name/depth/thread inputs before child creation, create a new child when threadKey is absent, reuse a non-killed owned child for the same stable threadKey, and update the reused child title without changing identity.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at the committed implementation candidate; execution status is recorded in the implementation report.

#### Current behavior and limits

Invalid/cancelled requests create no child; only direct children of the controller are reusable or manageable.

#### Acceptance evidence

- Exact source evidence:
  - `src/subagents/tool.ts:29` — `PIBO_AGENT_SESSION_NAME_MAX_LENGTH` (constant)
  - `src/subagents/tool.ts:180` — `normalizePiboAgentSessionName` (exported_symbol)
  - `src/core/session-router.ts:168` — `DEFAULT_SUBAGENT_MAX_DEPTH` (constant)
  - `src/core/session-router.ts:169` — `MAX_SUBAGENT_THREAD_KEY_BYTES` (constant)
  - `src/core/session-router.ts:2578` — `PiboSessionRouter.resolveSubagentSession` (method)
- Exact named tests:
  - `test/subagents.test.mjs:1075` — “agents controller requires bounded Unicode names and updates reused titles”
  - `test/subagents.test.mjs:1120` — “named sends reuse and upgrade existing legacy child sessions”
  - `test/subagents.test.mjs:768` — “router omits subagent tools that have reached their max depth”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-SUB-003

A newly created child MUST bind to the configured target profile/runtime and freeze its effective model, thinking, fast-mode, and runtime overrides independently of the parent; reuse MUST retain that child binding.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at the committed implementation candidate; execution status is recorded in the implementation report.

#### Current behavior and limits

Unknown targets or unavailable runtime bindings fail before delegated execution; child binding cannot silently inherit a different parent adapter.

#### Acceptance evidence

- Exact source evidence:
  - `src/subagents/runtime-selection.ts:22` — `resolvePiboSubagentRuntimeSelection` (exported_symbol)
  - `src/subagents/runtime-selection.ts:37` — `resolvePiboSubagentRuntimeSelections` (exported_symbol)
  - `src/core/session-router.ts:544` — `PiboSessionRouter` (type_or_class)
- Exact named tests:
  - `test/subagents.test.mjs:925` — “subagent runner freezes per-subagent model, thinking, and runtime overrides on new child sessions”
  - `test/codex-native-subagents.test.mjs:99` — “Codex native invokes yielded-only Pibo subagents through scoped MCP on a different runtime”
  - `test/codex-native-subagents.test.mjs:275` — “a Pi parent yielded subagent request creates and reuses a native Codex child binding”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-SUB-004

Observe and cancellation MUST use exact owned child/request identity; live and persisted observation MUST share the same query policy where durable fields permit it; bounded wait MUST NOT cancel the request; queued-request cancellation MUST NOT abort another active request on a reused child; and kill MUST dispose the owned subtree and prevent reuse.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at the committed implementation candidate; execution status is recorded in the implementation report.

#### Current behavior and limits

Cross-parent child access is rejected; targeted abort rejection/non-settlement is surfaced rather than reported as cancellation.

#### Acceptance evidence

- Exact source evidence:
  - `src/subagents/observations.ts:10` — `PIBO_AGENT_OBSERVATION_DEFAULT_LIMIT` (constant)
  - `src/subagents/observations.ts:11` — `PIBO_AGENT_OBSERVATION_MAX_LIMIT` (constant)
  - `src/subagents/observations.ts:219` — `normalizePiboAgentObservationLimit` (exported_symbol)
  - `src/core/session-router.ts:544` — `PiboSessionRouter` (type_or_class)
- Exact named tests:
  - `test/subagents.test.mjs:1216` — “agents controller lists, filters observations, kills owned children, and does not reuse killed threads”
  - `test/subagents.test.mjs:1818` — “cancelling a queued delegated run leaves the active request on the shared thread running”
  - `test/subagents.test.mjs:2020` — “bounded run waits do not cancel delegated agents and explicit cancellation preserves thread reuse”
  - `test/subagents.test.mjs:1491` — “agent observation polling is cursor-safe in descending order and reports retention loss”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-SUB-005

Observe MUST preserve the case-insensitive `textContains` substring filter and MUST accept optional `textRegex` for case-sensitive matching against the same normalized observation text with rg's default Rust regex syntax. If both filters are present, Observe MUST require both to match. Regex matching MUST stream fixed-size source batches, bound output independently of submatch density, retain at most `limit + 1` matches, and stop source consumption after that lookahead is found. Invalid regex syntax, unsupported NUL text or patterns, and an unavailable optional rg platform binary MUST return deterministic regex-specific errors without crashing the router or debug command. Non-regex observation MUST NOT resolve or require the optional binary.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at the committed implementation candidate; focused execution status is recorded in the candidate handoff.

#### Current behavior and limits

Inline Rust regex flags such as `(?i)`, `(?m)`, and `(?s)` change case, line-anchor, and dot/newline behavior. Rust regex rejects unsupported constructs such as backreferences. Live and persisted observation use the same lazy prepared query and bounded batched matcher; callers of the persisted debug projection pass the pattern through `--regex`.

#### Acceptance evidence

- Exact source evidence:
  - `src/subagents/tool.ts:91` — `PiboAgentObserveInput` (type_or_class)
  - `src/subagents/tool.ts:257` — `createAgentToolDefinitions` (exported_symbol)
  - `src/subagents/context.ts:6` — `getDelegatedAgentContextFile` (exported_symbol)
  - `src/subagents/observation-query.ts:44` — `preparePiboAgentObservationQuery` (exported_symbol)
  - `src/subagents/observation-query.ts:125` — `selectPiboAgentObservationPage` (exported_symbol)
  - `src/subagents/observation-text-regex.ts:86` — `preparePiboAgentObservationTextRegex` (exported_symbol)
  - `src/subagents/observation-text-regex.ts:100` — `matchPiboAgentObservationTextRegex` (exported_symbol)
  - `src/debug/agents.ts:64` — `runDebugAgentsCli` (exported_symbol)
- Exact named tests:
  - `test/subagents.test.mjs:182` — “delegated agents expose four stable shared tools and reject duplicate exact names”
  - `test/subagents.test.mjs:228` — “agent observation regex bounds dense and empty matches by the input batch”
  - `test/subagents.test.mjs:249` — “agent observation regex streams sparse fixed batches with stable cursor pagination”
  - `test/subagents.test.mjs:301` — “agent observation regex rejects NUL boundaries without leaking process errors”
  - `test/subagents.test.mjs:324` — “agent observation regex resolves the optional platform binary only for regex queries”
  - `test/subagents.test.mjs:356` — “agent observation regex preserves null-data anchors and inline multiline flags”
  - `test/subagents.test.mjs:782` — “profiles can expose subagents as active router tools”
  - `test/subagents.test.mjs:1386` — “agents controller lists, filters observations, kills owned children, and does not reuse killed threads”
  - `test/debug-agents.test.mjs:89` — “debug delegated-agent inspection lists owned children and applies exact observation filters”
  - `test/debug-agents.test.mjs:191` — “debug delegated-agent CLI exposes and executes the shared observation filters”
- Acceptance must preserve the stated failure behavior and must not promote unexecuted Pibo2 evidence to verified behavior.

## Ownership links

- [`adapter-contract.md`](/specs/runtime/adapter-contract.md)
- [`generation-resources-and-portable-tools.md`](/specs/runtime/generation-resources-and-portable-tools.md)
- [`provider-model-controls.md`](/specs/runtime/provider-model-controls.md)
- [`agents-and-profiles.md`](/specs/resources/agents-and-profiles.md)
- [`native-and-curated-tools.md`](/specs/resources/native-and-curated-tools.md)
- Web workflow rendering is a projection and interaction surface; it does not replace this package's durable facts.

## Verification boundary

- Source/test baseline: `9fa9b446242dd7fbac7ce49e44434cfca51a209e`.
- Focused Docker execution covers the Observe schema, runtime context, live query, persisted query, regex validation, and debug CLI paths; exact commands and results belong in the candidate handoff.
- Pibo2 acceptance of the exact committed candidate remains an independent pre-PR gate.
- This document is stable normative documentation of current behavior, not acceptance of future implementation work.
