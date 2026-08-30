---
type: "Specification"
title: "Gateway Resource Admission and Restart Safety"
description: "Defines the implemented gateway resource admission and restart safety contract and its current ownership, security, and verification boundaries."
tags: ["security", "trust-boundaries"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T08:51:56Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
    title: "Source and test evidence inspected for SPC-SEC-003"
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
    - id: "SEC-GW-001"
      status: "implemented"
      sources:
        - path: "src/core/gateway-resource-guard.ts"
          symbol: "buildGatewayResourceSnapshot"
        - path: "src/core/gateway-resource-guard.ts"
          symbol: "collectGatewayResourceSnapshot"
        - path: "src/core/gateway-resource-guard.ts"
          symbol: "parseHostProcessResourceList"
        - path: "src/core/gateway-resource-guard.ts"
          symbol: "parseYieldedRunSystemdUnits"
      tests:
        - path: "test/gateway-resource-guard.test.mjs"
          name: "gateway resource guard resolves safe defaults and explicit policy env"
        - path: "test/gateway-resource-guard.test.mjs"
          name: "gateway resources expose active yielded-run systemd cgroups"
        - path: "test/gateway-resource-guard.test.mjs"
          name: "gateway resource process parsing exposes children and known heavy daemons"
      public:
        - "Gateway resource guard and pressure diagnostics"
        - "pibo gateway web/dev status/start/stop/restart lifecycle"
        - "Collects memory/event-loop/process/run pressure, rejects unsafe new work, and blocks production restart with active work."
      failures:
        - "Resource admission and restart checks do not kill unrelated active work; diagnostics remain bounded and redaction is limited to identified sinks."
        - "Admission policy may block, warn, or allow according to resource state; it does not provide a general delay queue or universal fail-closed backpressure guarantee."
      confidence: "high"
    - id: "SEC-GW-002"
      status: "implemented"
      sources:
        - path: "src/core/gateway-resource-guard.ts"
          symbol: "GatewayWorkAdmissionController"
        - path: "src/core/gateway-resource-guard.ts"
          symbol: "assertGatewayResourceAvailableForWork"
        - path: "src/core/session-router.ts"
          symbol: "gatewayWorkAdmission"
        - path: "src/core/session-router.ts"
          symbol: "createRunToolController"
      tests:
        - path: "test/gateway-resource-guard.test.mjs"
          name: "gateway work admission reserves one yielded-run slot until execution settles"
        - path: "test/gateway-resource-guard.test.mjs"
          name: "gateway work admission enforces session concurrency independently"
        - path: "test/gateway-resource-guard.test.mjs"
          name: "gateway work admission rejects a run that would consume the host reserve"
      public:
        - "Gateway resource guard and pressure diagnostics"
        - "pibo gateway web/dev status/start/stop/restart lifecycle"
        - "Collects memory/event-loop/process/run pressure, rejects unsafe new work, and blocks production restart with active work."
      failures:
        - "Resource admission and restart checks do not kill unrelated active work; diagnostics remain bounded and redaction is limited to identified sinks."
        - "Admission policy may block, warn, or allow according to resource state; it does not provide a general delay queue or universal fail-closed backpressure guarantee."
      confidence: "high"
    - id: "SEC-GW-003"
      status: "implemented"
      sources:
        - path: "src/gateway/cli.ts"
          symbol: "runGatewayCli"
        - path: "src/gateway/pidfile.ts"
          symbol: "writeGatewayPid"
        - path: "src/gateway/pidfile.ts"
          symbol: "releaseGatewayPid"
        - path: "src/gateway/pidfile.ts"
          symbol: "writeFallbackGatewayPid"
        - path: "src/gateway/pidfile.ts"
          symbol: "releaseFallbackGatewayPid"
      tests:
        - path: "test/gateway-web-cli.test.mjs"
          name: "gateway:web CLI replaces a stale home-scoped PID file"
        - path: "test/gateway-web-cli.test.mjs"
          name: "gateway:web CLI rejects parallel instances that share PIBO_HOME"
        - path: "test/gateway-web-cli.test.mjs"
          name: "gateway:web CLI accepts parallel instances with distinct PIBO_HOME directories"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "starts a dev gateway that is not reachable yet"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "blocks start when a legacy port-specific PID file has a live gateway owner"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "blocks start when a reachable gateway has the wrong mode"
      public:
        - "Gateway resource guard and pressure diagnostics"
        - "pibo gateway web/dev status/start/stop/restart lifecycle"
        - "Collects memory/event-loop/process/run pressure, rejects unsafe new work, and blocks production restart with active work."
      failures:
        - "Resource admission and restart checks do not kill unrelated active work; diagnostics remain bounded and redaction is limited to identified sinks."
        - "Admission policy may block, warn, or allow according to resource state; it does not provide a general delay queue or universal fail-closed backpressure guarantee."
      confidence: "high"
    - id: "SEC-GW-004"
      status: "implemented"
      sources:
        - path: "src/gateway/cli.ts"
          symbol: "checkActiveWork"
        - path: "src/gateway/cli.ts"
          symbol: "RESTART_CONFIRMATION_TOKEN"
        - path: "src/gateway/cli.ts"
          symbol: "runGatewayCli"
      tests:
        - path: "test/gateway-restart-safety.test.mjs"
          name: "blocks with processing sessions"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "blocks with streaming sessions"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "blocks with queued messages"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "blocks with stale telemetry hints"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "blocks with active yielded runs"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "blocks when status is unavailable"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "allows restart when gateway is idle"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "exports the exact force confirmation token"
      public:
        - "Gateway resource guard and pressure diagnostics"
        - "pibo gateway web/dev status/start/stop/restart lifecycle"
        - "Collects memory/event-loop/process/run pressure, rejects unsafe new work, and blocks production restart with active work."
      failures:
        - "Resource admission and restart checks do not kill unrelated active work; diagnostics remain bounded and redaction is limited to identified sinks."
        - "Admission policy may block, warn, or allow according to resource state; it does not provide a general delay queue or universal fail-closed backpressure guarantee."
      confidence: "high"
verification:
  required_evidence_classes:
    - "source inspection"
    - "focused tests"
    - "build/package checks"
    - "external-provider/Pibo2 acceptance"
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
    claim: "Gateway admission rejects or delays every kind of unsafe new work."
    reason: "The production call site is yielded-run tool admission, and policy blocks or warns/allows; no delay queue is implemented."
  - id: "WP03-STALE-002"
    claim: "Only one gateway lifecycle code path exists."
    reason: "Managed web/dev CLI is normative, while legacy generic commands and programmatic lifecycle paths remain for compatibility."
  - id: "WP03-STALE-003"
    claim: "Gateway transport backpressure is owned by SEC-GW."
    reason: "Backpressure subscription/drop mechanics belong to GW-002; SEC-GW owns resource admission and restart safety."
open_evidence_gaps:
  - id: "WP03-GAP-008"
    specs: ["SPC-SEC-003"]
    gap: "No real-host evidence covers systemd yielded units, pressure thresholds, managed restart with active work, stale PID reuse, or Windows lifecycle behavior."
  - id: "WP03-GAP-009"
    specs: ["SPC-RES-001", "SPC-RES-002", "SPC-RES-003", "SPC-RES-004", "SPC-RES-005", "SPC-SEC-001", "SPC-SEC-002", "SPC-SEC-003"]
    gap: "Canonical synthesis and this read-only brief executed no focused tests, build/package checks, real paths, browser flows, or external/Pibo2 acceptance."
---

# Scope and exclusions

Memory/event-loop/process/run pressure collection, bounded diagnostics, admission/backpressure, PID/lifecycle authority, and production restart blocking with active work.

This specification records current behavior only. It does not authorize unimplemented hardening, duplicate the linked runtime/gateway/data owner, or convert unperformed validation into evidence.

# Current behavior and public surfaces

The implementation state is current at the exact accepted Foundation traceability commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

Implemented behavior:
- "Gateway resource guard and pressure diagnostics"
- "pibo gateway web/dev status/start/stop/restart lifecycle"
- "Collects memory/event-loop/process/run pressure, rejects unsafe new work, and blocks production restart with active work."
- "Gateway resource snapshots apply off/warn/block policy to host available memory, gateway heap/RSS, selected child/known-daemon process rows, and yielded-run systemd units with sanitized bounded argument previews."
- "GatewayWorkAdmissionController reserves yielded-run capacity globally and per session, checks host reserve, and releases idempotently; its only production call site is yielded-run tool admission in PiboSessionRouter."
- "Managed pibo gateway web/dev status/start/restart uses home-scoped PID ownership, stale PID cleanup, target-mode checks, and health polling."
- "Production web restart fails closed for unreachable/ambiguous status, processing/streaming/queued/stale-telemetry sessions, or active runs unless the exact force confirmation is supplied; dev restart is intentionally not active-work-gated."

Public surfaces:
- "Gateway resource guard and pressure diagnostics"
- "pibo gateway web/dev status/start/stop/restart lifecycle"
- "Collects memory/event-loop/process/run pressure, rejects unsafe new work, and blocks production restart with active work."

# State, lifecycle, and invariants

- "Only the Pibo CLI manages gateways; unsafe new work fails closed; production restart with active work requires explicit interruption authority."
- "Gateway lifecycle is CLI-owned; active production sessions require explicit interruption authority."
- "Admission blocks or warns/allows according to policy; it does not queue or delay unsafe work and does not kill active work."
- "Process inventory reports only gateway children and known heavy daemons and sanitizes argument previews; process/systemd probe failure is diagnostic, not a universal fail-closed admission result."
- "The managed web/dev CLI is the normative operator surface, but legacy generic gateway lifecycle commands still exist for compatibility; do not claim no other code path exists."
- "Socket backpressure belongs to GW-002; its test file is non-owned dependency evidence, not SEC-GW admission proof."

Persistence and lifecycle state: PID/status files and live process/resource snapshots.

# Requirements and invariants

## Requirement: SEC-GW-001: Collect bounded gateway host/runtime pressure snapshots, selected process and yielded-unit diagnostics, severity checks, sanitized argument previews, and off/warn/block decisions

Collect bounded gateway host/runtime pressure snapshots, selected process and yielded-unit diagnostics, severity checks, sanitized argument previews, and off/warn/block decisions.

**Implementation state:** `implemented_at_baseline` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/core/gateway-resource-guard.ts` — `buildGatewayResourceSnapshot`
- `src/core/gateway-resource-guard.ts` — `collectGatewayResourceSnapshot`
- `src/core/gateway-resource-guard.ts` — `parseHostProcessResourceList`
- `src/core/gateway-resource-guard.ts` — `parseYieldedRunSystemdUnits`

**Named test traceability:**
- `test/gateway-resource-guard.test.mjs` — `gateway resource guard resolves safe defaults and explicit policy env`
- `test/gateway-resource-guard.test.mjs` — `gateway resources expose active yielded-run systemd cgroups`
- `test/gateway-resource-guard.test.mjs` — `gateway resource process parsing exposes children and known heavy daemons`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: SEC-GW-002: Reserve capacity only for yielded-run tool starts, reject unsafe starts in block mode for critical pressure/global/session/host-reserve limits, warn or allow in other modes, release reservations idempotently, and never kill active work; no delay/queue behavior is claimed

Reserve capacity only for yielded-run tool starts, reject unsafe starts in block mode for critical pressure/global/session/host-reserve limits, warn or allow in other modes, release reservations idempotently, and never kill active work; no delay/queue behavior is claimed.

**Implementation state:** `implemented_at_baseline_with_ORCH_001_boundary` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/core/gateway-resource-guard.ts` — `GatewayWorkAdmissionController`
- `src/core/gateway-resource-guard.ts` — `assertGatewayResourceAvailableForWork`
- `src/core/session-router.ts` — `gatewayWorkAdmission`
- `src/core/session-router.ts` — `createRunToolController`

**Named test traceability:**
- `test/gateway-resource-guard.test.mjs` — `gateway work admission reserves one yielded-run slot until execution settles`
- `test/gateway-resource-guard.test.mjs` — `gateway work admission enforces session concurrency independently`
- `test/gateway-resource-guard.test.mjs` — `gateway work admission rejects a run that would consume the host reserve`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: SEC-GW-003: Use the managed pibo gateway web/dev CLI for normative status/start/restart operations, claiming home-scoped PID ownership exclusively, replacing stale claims safely, refusing parallel same-home owners and target-mode ambiguity, and preserving legacy generic commands as compatibility rather than canonical policy

Use the managed pibo gateway web/dev CLI for normative status/start/restart operations, claiming home-scoped PID ownership exclusively, replacing stale claims safely, refusing parallel same-home owners and target-mode ambiguity, and preserving legacy generic commands as compatibility rather than canonical policy.

**Implementation state:** `implemented_at_baseline_with_legacy_compatibility_surface` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/gateway/cli.ts` — `runGatewayCli`
- `src/gateway/pidfile.ts` — `writeGatewayPid`
- `src/gateway/pidfile.ts` — `releaseGatewayPid`
- `src/gateway/pidfile.ts` — `writeFallbackGatewayPid`
- `src/gateway/pidfile.ts` — `releaseFallbackGatewayPid`

**Named test traceability:**
- `test/gateway-web-cli.test.mjs` — `gateway:web CLI replaces a stale home-scoped PID file`
- `test/gateway-web-cli.test.mjs` — `gateway:web CLI rejects parallel instances that share PIBO_HOME`
- `test/gateway-web-cli.test.mjs` — `gateway:web CLI accepts parallel instances with distinct PIBO_HOME directories`
- `test/gateway-restart-safety.test.mjs` — `starts a dev gateway that is not reachable yet`
- `test/gateway-restart-safety.test.mjs` — `blocks start when a legacy port-specific PID file has a live gateway owner`
- `test/gateway-restart-safety.test.mjs` — `blocks start when a reachable gateway has the wrong mode`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: SEC-GW-004: Fail closed on production restart when status is unavailable/ambiguous or sessions/runs are active, require the exact explicit force confirmation to override, and keep dev restart outside the production active-work gate

Fail closed on production restart when status is unavailable/ambiguous or sessions/runs are active, require the exact explicit force confirmation to override, and keep dev restart outside the production active-work gate.

**Implementation state:** `implemented_at_baseline` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/gateway/cli.ts` — `checkActiveWork`
- `src/gateway/cli.ts` — `RESTART_CONFIRMATION_TOKEN`
- `src/gateway/cli.ts` — `runGatewayCli`

**Named test traceability:**
- `test/gateway-restart-safety.test.mjs` — `blocks with processing sessions`
- `test/gateway-restart-safety.test.mjs` — `blocks with streaming sessions`
- `test/gateway-restart-safety.test.mjs` — `blocks with queued messages`
- `test/gateway-restart-safety.test.mjs` — `blocks with stale telemetry hints`
- `test/gateway-restart-safety.test.mjs` — `blocks with active yielded runs`
- `test/gateway-restart-safety.test.mjs` — `blocks when status is unavailable`
- `test/gateway-restart-safety.test.mjs` — `allows restart when gateway is idle`
- `test/gateway-restart-safety.test.mjs` — `exports the exact force confirmation token`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


# Interfaces and ownership

Capability IDs: "pibo.security.gateway-guard".

Exact source files inspected for this owner:
- "src/core/gateway-resource-guard.ts"
- "src/core/session-router.ts"
- "src/gateway/cli.ts"
- "src/gateway/pidfile.ts"

Related ownership boundaries:
- SPC-ORCH-001: [yielded-run-control.md](/specs/capabilities/yielded-run-control.md) owns the linked contract; this specification does not duplicate it.
- SPC-CMP-001: [docker-compute-workers.md](/specs/capabilities/docker-compute-workers.md) owns the linked contract; this specification does not duplicate it.
- SPC-OP-001: [operator-cli-discovery-and-dispatch.md](/specs/capabilities/operator-cli-discovery-and-dispatch.md) owns the linked contract; this specification does not duplicate it.

The security policy/mechanics split is explicit: this specification defines the resource or security decision, while linked runtime, gateway, data, web, orchestration, compute, and operator owners provide their execution mechanics.

# Failure, security, privacy, and compatibility behavior

- "Resource admission and restart checks do not kill unrelated active work; diagnostics remain bounded and redaction is limited to identified sinks."
- "Admission policy may block, warn, or allow according to resource state; it does not provide a general delay queue or universal fail-closed backpressure guarantee."

Compatibility and privacy limits:
- "Admission blocks or warns/allows according to policy; it does not queue or delay unsafe work and does not kill active work."
- "Process inventory reports only gateway children and known heavy daemons and sanitizes argument previews; process/systemd probe failure is diagnostic, not a universal fail-closed admission result."
- "The managed web/dev CLI is the normative operator surface, but legacy generic gateway lifecycle commands still exist for compatibility; do not claim no other code path exists."
- "Socket backpressure belongs to GW-002; its test file is non-owned dependency evidence, not SEC-GW admission proof."

# Known limits and rejected stale claims

The following over-broad claims are rejected and must not be inferred from this specification:

- **Rejected claim:** Gateway admission rejects or delays every kind of unsafe new work. — The production call site is yielded-run tool admission, and policy blocks or warns/allows; no delay queue is implemented.
- **Rejected claim:** Only one gateway lifecycle code path exists. — Managed web/dev CLI is normative, while legacy generic commands and programmatic lifecycle paths remain for compatibility.
- **Rejected claim:** Gateway transport backpressure is owned by SEC-GW. — Backpressure subscription/drop mechanics belong to GW-002; SEC-GW owns resource admission and restart safety.

Open evidence gaps carried forward:
- `WP03-GAP-008` — No real-host evidence covers systemd yielded units, pressure thresholds, managed restart with active work, stale PID reuse, or Windows lifecycle behavior.
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

- [SPC-ORCH-001](/specs/capabilities/yielded-run-control.md)
- [SPC-CMP-001](/specs/capabilities/docker-compute-workers.md)
- [SPC-OP-001](/specs/capabilities/operator-cli-discovery-and-dispatch.md)
