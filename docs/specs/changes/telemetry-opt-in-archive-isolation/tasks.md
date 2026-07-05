# Tasks: Telemetry Opt-In Archive Isolation

**Status:** Draft; Phase 0 hot-path overlap shipped in v1.7.0
**Created:** 2026-07-04
**Updated:** 2026-07-05
**Related spec:** `spec.md`
**Related changes:** `../chat-web-trace-v2-fast-path/`, `../gateway-resource-protection-workers/`

## Work Estimate

Estimated implementation size: **large**, likely **3–6 focused engineering weeks** depending on how much Web archive inspection ships in the first release.

Suggested delivery:

- Phase 1 emergency hardening: 1–3 days.
- Phase 2 capture manager and isolated store: 4–7 days.
- Phase 3 archive lifecycle and CLI: 4–7 days.
- Phase 4 Web Settings lifecycle UI: 3–6 days.
- Phase 5 legacy migration/prune tooling: 5–10 days.
- Phase 6 test hardening and docs: 3–6 days.

## Phase 0: Emergency Hot-Path Bounds and Observability

This phase should ship before the full archive/capture system.

**v1.7.0 status:** Shipped for gateway diagnostics and reliability `pibo.output` hot-path payload bounds. The full telemetry capture/archive system remains pending.

### Tasks

- [x] T0.1 Add gateway memory diagnostics: heap, RSS, external, arrayBuffers, event-loop delay.
- [x] T0.2 Add bounded counters for trace cache entries/estimated bytes and transient replay buffer size/estimated bytes.
- [x] T0.3 Add bounded counters for reliability `pibo.output` writes by payload size bucket.
- [x] T0.4 Add a hot-path inline payload limit for reliability events.
- [x] T0.5 Store large `tool_execution_finished` and similar output bodies as payload references plus previews.
- [x] T0.6 Add startup/runtime warning when Node does not satisfy the package engine requirement.
- [x] T0.7 Add a synthetic large-output regression test for multi-MB tool results in the Trace V2 hot path.
- [x] T0.8 Add bounded gateway diagnostics that do not parse full large payloads.
- [x] T0.9 Coordinate payload/ref thresholds with Trace V2 so reliability events and trace rows share the same hot-path payload principle where practical.

### Acceptance

- [x] Repeated multi-MB tool outputs do not grow the default timeline or reliability hot path without bound.
- [x] Reliability event stream inline payloads remain below the configured threshold.
- [x] Operators can see heap/cache/replay/payload pressure before OOM.
- [x] Diagnostics are bounded and safe on stores with hundreds of MB of payloads.

## Phase 1: Stop New Always-On Detailed Telemetry

### Tasks

- [ ] T1.1 Inventory every current detailed telemetry write path.
  - Provider events.
  - Provider requests.
  - Runtime turns/phases.
  - Tool calls.
  - Payload previews.
  - Debug/performance records.
- [ ] T1.2 Classify each write path as operational data or detailed telemetry.
- [ ] T1.3 Add a central telemetry gate that returns disabled by default.
- [ ] T1.4 Route detailed telemetry writes through the gate.
- [ ] T1.5 Keep operational data needed by Chat Web unchanged.
- [ ] T1.6 Disable automatic telemetry retention in gateway request/startup paths.
- [ ] T1.7 Add tests proving detailed telemetry is not written by default.

### Acceptance

- [ ] Fresh install runs a session without live detailed telemetry rows.
- [ ] Chat Web still renders sessions and messages.
- [ ] Gateway startup and `/health` do not perform telemetry retention.

## Phase 2: Capture Manager and Isolated Active Store

### Tasks

- [ ] T2.1 Define telemetry capture run types and IDs.
- [ ] T2.2 Define capture scope model: session, room, global.
- [ ] T2.3 Define detail levels: summary, diagnostic, verbose.
- [ ] T2.4 Define capture limits: duration, max bytes, max raw events, payload capture.
- [ ] T2.5 Implement telemetry capture manager.
- [ ] T2.6 Implement active store path creation under `$PIBO_HOME/telemetry/active/<run-id>`.
- [ ] T2.7 Implement active `telemetry.sqlite` schema.
- [ ] T2.8 Implement manifest write/update.
- [ ] T2.9 Implement scope matching and event routing.
- [ ] T2.10 Implement size/duration limit enforcement.
- [ ] T2.11 Add crash-safe active run recovery metadata.

### Acceptance

- [ ] `pibo telemetry start` or equivalent internal API creates an active run.
- [ ] Matching telemetry writes go to the active store only.
- [ ] Non-matching events are ignored.
- [ ] The live gateway DB does not receive detailed telemetry.

## Phase 3: Archive Finalization

### Tasks

- [ ] T3.1 Implement stop/finalize capture command.
- [ ] T3.2 Move or mark active run as archived.
- [ ] T3.3 Finalize manifest fields: status, stoppedAt, size, row counts.
- [ ] T3.4 Ensure archive DB is closed after finalization.
- [ ] T3.5 Implement archive manifest list without opening SQLite files.
- [ ] T3.6 Implement failed/corrupt archive status handling.
- [ ] T3.7 Add tests proving large archive DB files are inert during startup.

### Acceptance

- [ ] Stopping a run creates `$PIBO_HOME/telemetry/archives/<run-id>/manifest.json`.
- [ ] Gateway startup does not open archive `telemetry.sqlite` files.
- [ ] Archive list reads manifests only.

## Phase 4: CLI and Web Controls

### CLI Tasks

- [ ] T4.1 Add `pibo telemetry status`.
- [ ] T4.2 Add `pibo telemetry start`.
- [ ] T4.3 Add `pibo telemetry stop`.
- [ ] T4.4 Add `pibo telemetry archives list`.
- [ ] T4.5 Add `pibo telemetry archive show`.
- [ ] T4.6 Add `pibo telemetry archive stats` with bounded reads.
- [ ] T4.7 Add `pibo telemetry archive export`.
- [ ] T4.8 Add `pibo telemetry archive delete` as a job or external maintenance operation.

### Web Tasks

- [ ] T4.9 Add Settings → Telemetry state panel.
- [ ] T4.10 Add explicit start capture flow with scope, duration, detail level, and warning.
- [ ] T4.11 Add active run status and stop action.
- [ ] T4.12 Add archive list from manifests.
- [ ] T4.13 Add archive delete/export actions as jobs, not blocking requests.
- [ ] T4.14 Add UI tests for telemetry off/start/stop/list.

### Acceptance

- [ ] Operators can start and stop telemetry from CLI.
- [ ] Chat Web Settings shows telemetry off by default.
- [ ] Long archive operations do not block HTTP requests.

## Phase 5: Legacy Live Telemetry Handling

### Tasks

- [ ] T5.1 Detect legacy telemetry tables without full-table scans.
- [ ] T5.2 Add `pibo telemetry legacy status`.
- [ ] T5.3 Mark legacy telemetry inactive in settings/metadata.
- [ ] T5.4 Ensure no runtime path reads legacy telemetry tables by default.
- [ ] T5.5 Implement batch archive-copy tool for legacy telemetry.
- [ ] T5.6 Implement batch prune tool for legacy telemetry.
- [ ] T5.7 Add progress output, cancellation, and resume strategy.
- [ ] T5.8 Add WAL/checkpoint guidance and safe vacuum docs.
- [ ] T5.9 Test against synthetic large legacy datasets.

### Acceptance

- [ ] Upgrading with legacy telemetry does not block gateway startup.
- [ ] Operators can see legacy telemetry status.
- [ ] Batch prune/archive tools can process large tables outside the gateway.

## Phase 6: Remove or Deprecate Old Retention Path

### Tasks

- [ ] T6.1 Remove request-path telemetry retention against live telemetry tables.
- [ ] T6.2 Replace Web retention endpoint with job-creation endpoint if still needed.
- [ ] T6.3 Update Settings copy to explain archive deletion instead of live retention.
- [ ] T6.4 Keep old endpoint compatibility only if it returns a safe error or creates a job.
- [ ] T6.5 Add regression test: endpoint must not perform synchronous delete.

### Acceptance

- [ ] No Web API request performs a large telemetry delete synchronously.
- [ ] Archive maintenance uses worker/job execution.

## Phase 7: Documentation and Operations

### Tasks

- [ ] T7.1 Update operator docs for telemetry capture workflow.
- [ ] T7.2 Add incident playbook: enable capture, reproduce, stop, export, delete.
- [ ] T7.3 Add upgrade notes for legacy live telemetry.
- [ ] T7.4 Add privacy warning documentation.
- [ ] T7.5 Add troubleshooting commands.

### Acceptance

- [ ] An operator can follow docs to capture telemetry for a single session and delete it afterward.
- [ ] Docs warn that verbose telemetry may contain sensitive data.

## Verification Plan

- [ ] Unit tests for gate, scopes, detail levels, manifest lifecycle.
- [ ] Integration tests for isolated active store and archive inertness.
- [ ] Chat Web tests for Settings flows.
- [ ] CLI tests for telemetry lifecycle commands.
- [ ] Synthetic large archive startup test.
- [ ] Synthetic large legacy telemetry upgrade test.
- [ ] Regression test for no synchronous retention in gateway request path.

## Implementation Notes

- Prioritize disabling always-on detailed telemetry before building rich inspection UI.
- Do not attempt to shrink existing large SQLite files during automatic upgrade.
- Treat legacy cleanup as an explicit operator action.
- Use small, resumable batches for legacy archive/prune.
- Keep archive manifests small and readable without SQLite.
- Ensure archive inspection is opt-in and bounded.

## Dependencies

- The resource-protected worker model should handle long archive delete/prune jobs once available.
- Before that model lands, CLI-only maintenance is acceptable if it never runs inside the gateway process.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Operators forget to enable telemetry before incidents | Keep minimal operational breadcrumbs and make capture easy to start. |
| Verbose telemetry captures sensitive data | Require explicit confirmation and provide easy delete/export controls. |
| Legacy telemetry remains large | Stop new growth first; provide offline cleanup tools. |
| Archive inspection accidentally enters hot path | Add tests that fail when archives are opened during startup/health/bootstrap. |
| Batch prune corrupts or blocks DB | Use transactions, backup guidance, dry-run mode, and cancellation. |
