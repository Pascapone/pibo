---
type: "Specification"
title: "Debug CLI, Web Diagnostics, and PTY Validation"
description: "Defines the implemented debug cli, web diagnostics, and pty validation contract and its current ownership, security, compatibility, and verification boundaries."
tags:
- operator
- tooling
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-01T20:42:35Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:upstream/dev refresh 39090b8850758293e69380a52bb7498d7c955bc2"
    title: "upstream/dev refresh source and named-test evidence"
implementation:
  state: "current"
  baseline_commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  package: "WP-05+09-COMPUTE-OPERATOR"
  source_evidence: "performed"
  focused_test_execution: "performed in owned Docker after authoring; see implementation report"
  build_and_typecheck_execution: "performed in owned Docker after authoring; see implementation report"
traceability:
  commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  requirements:
    - id: "OP-DEBUG-001"
      status: "implemented"
      sources:
        - path: src/debug/index.ts
          symbol: runDebugCli
        - path: src/debug/index.ts
          symbol: printDebugDiscovery
        - path: src/debug/detail-format.ts
          symbol: sliceTextByBytes
        - path: src/debug/next-commands.ts
          symbol: formatNextCommands
      tests:
        - path: test/debug-cli.test.mjs
          name: "pibo debug help stays progressive"
        - path: test/debug-cli.test.mjs
          name: "pibo debug tool, failures, summary, and trace show expose next drill-down commands"
      public:
        - "pibo debug --help"
        - "pibo debug db|session|trace|events|telemetry|web|pty --help"
      failures:
        - "Unknown branches and detail requests fail explicitly; output and next-command hints are byte/row bounded."
      confidence: high
    - id: "OP-DEBUG-002"
      status: "implemented"
      sources:
        - path: src/debug/sql.ts
          symbol: runReadOnlyQuery
        - path: src/debug/session.ts
          symbol: inspectDebugSession
        - path: src/debug/events.ts
          symbol: inspectDebugEvents
        - path: src/debug/telemetry.ts
          symbol: inspectTelemetrySessions
        - path: src/debug/output-integrity.ts
          symbol: inspectOutputIntegrity
        - path: src/debug/output-integrity.ts
          symbol: outputPersistenceDeadLettersFromAudit
        - path: src/debug/output-repair.ts
          symbol: repairOutputTurns
      tests:
        - path: test/debug-cli.test.mjs
          name: "pibo debug db discovers schema and runs limited read-only SQL"
        - path: test/debug-cli.test.mjs
          name: "pibo debug db rejects mutating and multi-statement SQL"
        - path: test/debug-cli.test.mjs
          name: "pibo debug trace prints rebuilt Chat Web trace nodes"
        - path: test/debug-trace-checks.test.mjs
          name: "debug trace check reports duplicate stable keys"
        - path: test/output-integrity-debug.test.mjs
          name: "output integrity audit reports lifecycle, collision, and queue findings without writes"
        - path: test/output-repair-debug.test.mjs
          name: "output repair refuses missing, active, ambiguous, duplicate, complete, and conflicting targets"
        - path: test/output-repair-debug.test.mjs
          name: "scoped output repair is bounded by session and time and remains dry-run by default"
      public:
        - "pibo debug db|session|trace|messages|events|failures|telemetry|resources|runs|signals"
      failures:
        - "Debug reads owner stores/APIs without mutating them; SQL rejects mutation and multiple statements."
      confidence: high
    - id: "OP-DEBUG-003"
      status: "implemented"
      sources:
        - path: src/debug/web.ts
          symbol: runDebugWeb
        - path: src/debug/web-options.ts
          symbol: DEFAULT_WATCH_DURATION_MS
        - path: src/debug/web-render-analysis.ts
          symbol: diffSnapshots
        - path: src/debug/web-streaming-browser-library.ts
          symbol: browserStreamingBenchmarkLibrary
      tests:
        - path: test/debug-cli.test.mjs
          name: "pibo debug web report renders saved streaming benchmark artifacts without CDP"
        - path: test/debug-cli.test.mjs
          name: "pibo debug web streaming benchmark help advertises the deterministic fixture"
        - path: test/debug-web-streaming-cleanup.test.mjs
          name: "SSE stop returns a detached result when read and cancel ignore abort"
        - path: test/debug-web-streaming-cleanup.test.mjs
          name: "render-order capture clears every session buffer observed during navigation"
      public:
        - "pibo debug web targets|attach-chat|snapshot|diff|watch|scenario|report"
        - "POST /api/chat/debug/streaming-fixture"
      failures:
        - "Observers, EventSources, CDP work, and artifacts require deterministic cleanup; headless fixtures are not visual acceptance."
      confidence: high
    - id: "OP-DEBUG-004"
      status: "implemented"
      sources:
        - path: src/debug/pty.ts
          symbol: runDebugPty
        - path: src/debug/pty.ts
          symbol: validateScenario
        - path: src/debug/pty.ts
          symbol: executePtyScenario
      tests:
        - path: test/debug-pty.test.mjs
          name: "pibo debug pty run captures host PTY output and artifacts"
        - path: test/debug-pty.test.mjs
          name: "pibo debug pty scenario types input through an interactive PTY"
        - path: test/debug-pty.test.mjs
          name: "built-in mocked CLI session scenario follows the room and session picker flow"
        - path: test/debug-pty.test.mjs
          name: "pibo debug pty preserves missing event diagnostics with non-zero inner exits"
        - path: test/debug-pty.test.mjs
          name: "pibo debug pty enforces one wall-clock deadline across wait, text, and delay steps"
        - path: test/debug-pty.test.mjs
          name: "pibo debug pty stop patterns terminate a running process group"
      public:
        - "pibo debug pty run|scenario|list-scenarios"
        - "PTY scenario JSON"
      failures:
        - "Malformed scenarios, assertions, timeouts, ignored cancellation, and cleanup failures remain visible in bounded artifacts."
      confidence: high
    - id: "OP-DEBUG-005"
      status: "implemented"
      sources:
        - path: src/debug/index.ts
          symbol: runDebugTelemetry
        - path: src/debug/delta-compaction.ts
          symbol: runDeltaCompaction
        - path: src/debug/pty.ts
          symbol: validateProviderSafety
      tests:
        - path: test/debug-cli.test.mjs
          name: "pibo debug telemetry inspects tool calls, stale work, stats, and dry-run-first prune"
        - path: test/debug-pty.test.mjs
          name: "pibo debug pty real-provider mode requires explicit safety opt-in"
      public:
        - "pibo debug telemetry prune"
        - "pibo debug events prune|compact-deltas"
        - "pibo debug pty --real-provider --max-iterations"
      failures:
        - "Apply, prune, destructive, real-provider, and iteration modes require deliberate safety gates and bounds."
      confidence: high
---
# Debug CLI, Web Diagnostics, and PTY Validation

## Why

Debugging needs bounded evidence capture across stores, Web targets, and PTYs without replacing the systems being diagnosed.

## Scope

This specification describes implemented behavior at the traceability commit. It owns the contracts listed below and does not turn adjacent implementation or future plans into current authority.

### In scope

- Debug CLI projections, bounded formatting/drill-down, Web snapshot/diff/watch/scenario/report evidence, PTY scenario validation/execution/assertions/artifacts, and explicit diagnostic mutation/provider gates.

### Out of scope

- Product data, trace, event, run, telemetry, or signal truth; debug reads owner APIs/stores.
- Browser templates/leases/CDP process ownership owned by SPC-CMP-003; debug consumes an existing target.
- Chat Web renderer behavior and stable anchors owned by SPC-WEB-005.
- Gateway/session lifecycle or provider behavior.

## Current behavior

### Commands

- pibo debug db|session|trace|summary|messages|final|tool|failures|events|agents|jobs|runs|resources|signals|telemetry|persistence|repair|web|pty; Web branches targets|attach-chat|snapshot|diff|watch|scenario|report; PTY branches run|scenario|list-scenarios.

### Apis

- Debug consumes authenticated GET /api/chat/debug/persistence and resource diagnostics plus POST /api/chat/debug/trace-at-sequence and /api/chat/debug/streaming-fixture; route ownership remains Chat Web. Signals consume live gateway APIs.

### State

- Local debug defaults read owner stores read-only; persistence audit reports incomplete lifecycles, identity collisions, queue/dead-letter state, and bounded detail. Repair is dry-run by default and applies only with exact completed Product History, Reliability, or adapter evidence. Optional explicit artifact directories hold Web/PTY evidence.

### Lifecycle

- Resolve store/session/target; inspect or capture bounded evidence; redact/format; emit next commands; always terminate PTY/observer/CDP work and write failure artifacts when configured.

### Failure

- Unknown store/session/target, malformed scenario, assertion failure, missing expected events, nonzero child exits, one wall-clock deadline, ignored abort/cancel, and cleanup failure remain explicit. Repair refuses active, ambiguous, duplicate, conflicting, already-complete, or evidence-free targets. Real-provider runs require opt-in, positive iteration bound, timeouts, and stop condition.

### Security

- Read-only query parser rejects mutation and multiple statements; output/artifacts redact secrets and native metadata; cookie/auth inputs are explicit; prune/apply and real-provider flags are deliberate.

### Compatibility

- Debug projections are disposable views, never source authority. Deterministic mocked PTY and streaming fixtures are the default; headful/real-provider evidence is a separate acceptance class.

## Requirements and invariants

### Requirement: OP-DEBUG-001

Expose bounded progressive discovery for all debug branches and drill from summaries to details with stable next-command hints.

#### Current

The upstream/dev refresh implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/debug/index.ts` — `runDebugCli`; `src/debug/index.ts` — `printDebugDiscovery`; `src/debug/detail-format.ts` — `sliceTextByBytes`; `src/debug/next-commands.ts` — `formatNextCommands`
- Tests: `test/debug-cli.test.mjs` — “pibo debug help stays progressive”; `test/debug-cli.test.mjs` — “pibo debug tool, failures, summary, and trace show expose next drill-down commands”
- Failure/security boundary: Unknown branches and detail requests fail explicitly; output and next-command hints are byte/row bounded.
- Confidence: **high**

### Requirement: OP-DEBUG-002

Read and reconstruct owner data for sessions, messages, events, traces, failures, telemetry, resources, runs, and signals without becoming source authority.

#### Current

The upstream/dev refresh implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/debug/sql.ts` — `runReadOnlyQuery`; `src/debug/session.ts` — `inspectDebugSession`; `src/debug/events.ts` — `inspectDebugEvents`; `src/debug/telemetry.ts` — `inspectTelemetrySessions`
- Tests: `test/debug-cli.test.mjs` — “pibo debug db discovers schema and runs limited read-only SQL”; `test/debug-cli.test.mjs` — “pibo debug db rejects mutating and multi-statement SQL”; `test/debug-cli.test.mjs` — “pibo debug trace prints rebuilt Chat Web trace nodes”; `test/debug-trace-checks.test.mjs` — “debug trace check reports duplicate stable keys”
- Failure/security boundary: Debug reads owner stores/APIs without mutating them; SQL rejects mutation and multiple statements.
- Confidence: **high**

### Requirement: OP-DEBUG-003

Capture Web targets, snapshots, diffs, bounded watches, scenarios, streaming benchmarks, and reports while deterministically cleaning observer and EventSource state.

#### Current

The upstream/dev refresh implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/debug/web.ts` — `runDebugWeb`; `src/debug/web-options.ts` — `DEFAULT_WATCH_DURATION_MS`; `src/debug/web-render-analysis.ts` — `diffSnapshots`; `src/debug/web-streaming-browser-library.ts` — `browserStreamingBenchmarkLibrary`
- Tests: `test/debug-cli.test.mjs` — “pibo debug web report renders saved streaming benchmark artifacts without CDP”; `test/debug-cli.test.mjs` — “pibo debug web streaming benchmark help advertises the deterministic fixture”; `test/debug-web-streaming-cleanup.test.mjs` — “SSE stop returns a detached result when read and cancel ignore abort”; `test/debug-web-streaming-cleanup.test.mjs` — “render-order capture clears every session buffer observed during navigation”
- Failure/security boundary: Observers, EventSources, CDP work, and artifacts require deterministic cleanup; headless fixtures are not visual acceptance.
- Confidence: **high**

### Requirement: OP-DEBUG-004

Run host or named-worker PTYs from validated scenarios with bounded terminal geometry/timeouts/input, assertions, deterministic cleanup, and raw/clean evidence artifacts.

#### Current

The upstream/dev refresh implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/debug/pty.ts` — `runDebugPty`; `src/debug/pty.ts` — `validateScenario`; `src/debug/pty.ts` — `executePtyScenario`
- Tests: `test/debug-pty.test.mjs` — “pibo debug pty run captures host PTY output and artifacts”; `test/debug-pty.test.mjs` — “pibo debug pty scenario types input through an interactive PTY”; `test/debug-pty.test.mjs` — “built-in mocked CLI session scenario follows the room and session picker flow”
- Failure/security boundary: Malformed scenarios, assertions, timeouts, ignored cancellation, and cleanup failures remain visible in bounded artifacts.
- Confidence: **high**

### Requirement: OP-DEBUG-005

Default diagnostics to bounded/read-only/mock behavior and require explicit apply, destructive, real-provider, and iteration controls for state-changing or external paths.

#### Current

The upstream/dev refresh implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/debug/index.ts` — `runDebugTelemetry`; `src/debug/delta-compaction.ts` — `runDeltaCompaction`; `src/debug/pty.ts` — `validateProviderSafety`
- Tests: `test/debug-cli.test.mjs` — “pibo debug telemetry inspects tool calls, stale work, stats, and dry-run-first prune”; `test/debug-pty.test.mjs` — “pibo debug pty real-provider mode requires explicit safety opt-in”
- Failure/security boundary: Apply, prune, destructive, real-provider, and iteration modes require deliberate safety gates and bounds.
- Confidence: **high**

## Interfaces and ownership

**Capability IDs:** pibo.operator.debug

**Public surfaces:**

- pibo debug --help
- pibo debug db|session|trace|events|telemetry|web|pty --help
- pibo debug db|session|trace|messages|events|failures|telemetry|resources|runs|signals
- pibo debug web targets|attach-chat|snapshot|diff|watch|scenario|report
- POST /api/chat/debug/streaming-fixture
- pibo debug pty run|scenario|list-scenarios
- PTY scenario JSON
- pibo debug telemetry prune
- pibo debug events prune|compact-deltas
- pibo debug pty --real-provider --max-iterations

Debug output is a disposable projection. The data, signal, telemetry, browser, and Web specifications remain authoritative for the values it reads.

Related concepts:

- [/specs/data/product-store-history-and-read-models.md](/specs/data/product-store-history-and-read-models.md)
- [/specs/data/telemetry.md](/specs/data/telemetry.md)
- [/specs/data/signals.md](/specs/data/signals.md)
- [/specs/compute/browser-pools-and-leases.md](/specs/compute/browser-pools-and-leases.md)
- [/specs/operator/terminal-ui.md](/specs/operator/terminal-ui.md)

## Failure and security behavior

- Unknown store/session/target, malformed scenario, assertion failure, timeout, ignored abort/cancel, and cleanup failure remain explicit. Real-provider runs require opt-in, positive iteration bound, timeouts, and stop condition.
- Read-only query parser rejects mutation and multiple statements; output/artifacts redact secrets and native metadata; cookie/auth inputs are explicit; prune/apply and real-provider flags are deliberate.

## Known limits

- The synthesis source list src/debug omits Chat Web route-owner symbols for the cited debug APIs; the spec must mark those APIs as consumed surfaces and depend on their owners.
- No real PTY, authenticated gateway signal path, or headed browser validation was performed.
- The PTY scenario TypeScript shape is internal; the CLI JSON validation behavior, not an exported type, is the compatibility contract.

## Reconciled stale claims

- Reject debug projections as product truth or persistence owners.
- Reject real-provider PTY as the default; deterministic mocked mode is default.
- Reject fixture/headless evidence as sufficient visual acceptance.
- Reject debug ownership of browser leases, product renderer behavior, signal semantics, or gateway lifecycle.
- Reject pibo debug signals as a local store snapshot; it reads a live authenticated API.

## Verification and traceability

All source and named-test references are bound to upstream/dev refresh commit `39090b8850758293e69380a52bb7498d7c955bc2`. The traceability commit is evidence authority; it does not imply that a test, build, package, Docker, deployment-pool, browser/CDP, headful, PTY, gateway-restart, real-host/provider, Windows, or Pibo2 path passed. Focused execution and build/typecheck/package results are recorded in the implementation report.

Later validation commands:

- node --test test/debug-cli.test.mjs test/debug-trace-checks.test.mjs test/debug-pty.test.mjs test/debug-web-streaming-cleanup.test.mjs
- npm run build
- pibo debug --help && pibo debug web --help && pibo debug pty --help
- pibo debug pty scenario --builtin cli-session-ui-mocked-e2e --artifact
