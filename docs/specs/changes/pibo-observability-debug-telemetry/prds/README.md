# PRD Catalog: Pibo Observability and Debug Telemetry

**Status:** Draft  
**Created:** 2026-05-16  
**Source change:** `docs/specs/changes/pibo-observability-debug-telemetry/`

This directory translates the observability/debug telemetry proposal, spec, design, task list, and incident report into implementation-grade PRDs and Ralph-ready `prd_*.json` files.

## Source Documents

- `../proposal.md`
- `../spec.md`
- `../design.md`
- `../tasks.md`
- `../decisions.md`
- `../../../../reports/incident-2026-05-16-stuck-toolcall-stream.md`
- `../../../capabilities/runtime-observability-telemetry.md`
- `../../../capabilities/debug-cli.md`
- `../../../../project/observability-telemetry-playbooks.md`
- `../../../../project/observability-telemetry-rollout-verification.md`

## PRDs

| PRD | Scope | Primary implementers | Ralph JSON |
|---|---|---|---|
| `01-product-overview.md` | End-to-end product, personas, success criteria, rollout decisions | Product, engineering leads | `prd_01_product_overview.json` |
| `02-telemetry-store-redaction-retention.md` | Telemetry schema, typed store/service, correlation links, volume control, retention, pruning | Storage/runtime engineers | `prd_02_telemetry_store_redaction_retention.json` |
| `03-runtime-provider-tool-capture.md` | Queue/turn/phase capture, provider stream diagnostics, tool-call progress, tool execution | Runtime/provider engineers | `prd_03_runtime_provider_tool_capture.json` |
| `04-debug-telemetry-cli.md` | Progressive `pibo debug telemetry` command surface, bounded output, JSON output | CLI/debug engineers | `prd_04_debug_telemetry_cli.json` |
| `05-signals-staleness-docs-validation.md` | Live hints, stale detection, operational playbooks, validation fixtures, rollout checks | Full-stack/QA/SRE engineers | `prd_05_signals_staleness_docs_validation.json` |

## Global Decisions Inherited by All PRDs

- Telemetry follows the existing `pibo debug` progressive-discovery pattern: broad summaries first, drill-down by id, optional preview fetches only if preview storage is explicitly enabled.
- Default command output must be bounded and must not print or duplicate full provider payloads, headers, transcripts, normalized event payloads, or full tool arguments.
- Raw provider payload storage is not a product goal. V1 stores structured summaries, counters, safe structural fields, and links. Payload previews are disabled/unavailable by default unless a later explicit decision enables bounded preview storage.
- Telemetry records must be explicitly correlated through Pibo Session, room, turn, phase, normalized event, payload metadata, provider request, upstream response, tool call, run, and event-stream identifiers when available.
- Telemetry must link to existing session/event/payload evidence instead of duplicating full transcripts, normalized event payloads, provider payloads, or tool arguments.
- Signals and Chat Web status surfaces may expose compact active-phase/stale hints, but detailed evidence lives in telemetry commands.
- Runtime hardening such as automatic abort/retry on provider inactivity is separate from this telemetry feature.
- External observability SaaS integration is out of scope; V1 is local-first.

## Authoritative V1 Scope Matrix

| Capability | V1 scope | Later / optional |
|---|---|---|
| Storage | Dedicated additive telemetry tables inside unified `pibo.sqlite`; no separate telemetry DB | External observability stores |
| Content policy | Metadata, counters, byte sizes, safe structural fields, and links only by default | Explicit bounded payload previews if approved later |
| Runtime capture | Queue/turn/phase, provider request, provider event metadata/aggregates, tool-arg progress, tool execution | Automatic provider recovery/abort/retry |
| CLI | `pibo debug telemetry` help, sessions, session, turn, provider, provider events, tool, stale, stats, prune; text and `--json` | Chat Web telemetry drill-down UI |
| Staleness | Read-only provider/profile-aware detection with minimal settings/config and threshold source shown in output | Mutating remediation |
| Retention | Retention classes, stats, dry-run-first prune, and `incident` retention class | Incident export/pinning workflows beyond retention class |
| Signals/status | Compact active-phase/stale hints only | Rich UI evidence panel |

## Execution Readiness

Ralph can implement the PRDs without more product clarification if each batch keeps the following boundaries:

- Implement summary-only telemetry first. Treat payload previews as unavailable unless a later explicit user decision enables bounded preview capture.
- Use the unified `pibo.sqlite` store and additive telemetry tables. Do not create another SQLite database.
- Add provider/profile-aware stale threshold plumbing before exposing stale CLI results as complete. Exact thresholds may start with safe defaults and source labels, then tighten during PRD 05 validation.
- Keep all runtime writes best-effort. Telemetry failures must not fail model streaming, tool execution, routing, or debug reads outside the telemetry branch.
- Keep V1 CLI-only for drill-down. Signals/status may show compact hints, but Chat Web does not get a telemetry evidence panel in V1.

No open issue blocks PRD 02 storage work. The remaining TBDs are implementation choices inside later PRDs: exact stale-threshold defaults, exact config shape, and provider event per-row versus aggregate storage once volume tests run.

## Shared QA Conventions

- **Bounded output:** every list command needs a default limit, hard maximum, truncation/cursor metadata, and JSON equivalent. Use existing debug CLI conventions; if none exist, use default `20` rows and hard maximum `200` rows.
- **Bounded storage:** telemetry tables store metadata and links, not full content bodies. Byte counts are allowed; body copies are not.
- **Preview contract:** V1 must handle preview-disabled/unavailable states cleanly. Preview persistence and preview CLI output are optional and must not be implemented as automatic raw capture unless explicitly approved. If enabled later, use default preview size `2048` bytes and hard maximum `16384` bytes unless existing debug conventions already define stricter limits.
- **Stale threshold output:** stale/status JSON should include the applied threshold and its source: provider/profile override or default.
- **Dependency policy:** instrumentation must use Pibo-owned wrappers/seams where possible and must not edit `node_modules`.

## Assumptions / TBD

The source specs intentionally left several choices open. These PRDs use the following implementation assumptions so Ralph can proceed in small loops. Update before execution if the project decides differently.

- **Telemetry storage:** use dedicated telemetry tables inside the unified `pibo.sqlite` data store; keep schema additive and idempotent.
- **Session/event links:** telemetry tables must support bidirectional lookup from sessions/events/payload metadata to telemetry and from telemetry back to session/event evidence.
- **Payload preview mode:** V1 implements summary-only storage and clear preview-unavailable behavior. Bounded preview persistence is a later opt-in unless explicitly approved before execution.
- **Default stale threshold:** provider/profile-aware rather than one universal threshold; expose a minimal Provider Settings config option.
- **Chat Web V1 scope:** no telemetry UI in V1; CLI-only drill-down.
- **Incident pinning:** include a simple `incident` retention class in V1.
- **Runtime enablement:** telemetry should be on by default and write failures must be best-effort/non-fatal.

## Traceability Matrix

| Spec requirement | PRD coverage |
|---|---|
| Progressive telemetry discovery | `01`, `04`, `05` |
| Correlated telemetry records and bidirectional session/event links | `02`, `03`, `04` |
| Explicit runtime phases | `02`, `03`, `04`, `05` |
| Provider request lifecycle | `02`, `03`, `04` |
| Provider event metadata/summaries, not dumps | `02`, `03`, `04` |
| Tool-call argument progress | `02`, `03`, `04` |
| Stale active work discovery | `03`, `04`, `05` |
| Context-budget protection | `01`, `04`, `05` |
| Safe-by-default bounded output and storage | `02`, `03`, `04`, `05` |
| Explicit retention and prune behavior | `02`, `04`, `05` |
| Signal hints with telemetry evidence | `05` |
| Stable JSON output for agents | `04`, `05` |

## Rollout Checklist

Use this checklist before enabling observability telemetry beyond local development. The canonical expanded checklist lives in `docs/project/observability-telemetry-rollout-verification.md`:

- [ ] Run `npm run typecheck` in the Docker compute worker.
- [ ] Run the debug CLI test suite, including telemetry text and JSON output tests.
- [ ] Run storage and output safety tests that seed large provider payloads, headers, normalized event links, transcripts, and tool arguments, then verify default telemetry output remains bounded.
- [ ] Run the synthetic partial-tool-call fixture and verify the drill-down path: `session` → `turn` → `provider`/`tool`.
- [ ] Verify `pibo debug telemetry stats` reports retention classes and byte/count estimates.
- [ ] Verify `pibo debug telemetry prune` reports a dry-run by default and deletes only telemetry rows when apply/destructive mode is explicit.
- [ ] Verify stale output shows the applied threshold and threshold source, including provider/profile override and default cases.
- [ ] Verify preview reads report disabled/unavailable by default and never fall back to raw provider payload reads.
- [ ] Verify existing `pibo debug` branches still pass their compatibility tests.
- [ ] Confirm operators know automatic provider timeout recovery, abort, and retry behavior are out of scope for this telemetry feature.

## Ralph Execution Note

Recommended order:

1. `prd_01_product_overview.json` — documentation/contract guardrails only.
2. `prd_02_telemetry_store_redaction_retention.json` — schema, service, retention, preview-disabled contract.
3. `prd_03_runtime_provider_tool_capture.json` — runtime/provider/tool capture on top of the service.
4. `prd_05_signals_staleness_docs_validation.json` stories for stale settings/detector before CLI stale work.
5. `prd_04_debug_telemetry_cli.json` — CLI commands consuming store/capture/stale services.
6. Remaining `prd_05_*` validation/docs stories.

Each story is intended to fit into one Ralph iteration and includes `Typecheck passes` as a completion gate. If a story depends on another PRD, its JSON `notes` field calls that out.
