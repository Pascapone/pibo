# Spec: Runtime Observability Telemetry

**Status:** Draft  
**Created:** 2026-05-16  
**Owner / Source:** Observability and Debug Telemetry change set  
**Related docs:** `GLOSSARY.md`, [Debug CLI](./debug-cli.md), [Pibo Data Store and Ingestion](./pibo-data-store-and-ingestion.md), [Pibo Event Contract](./pibo-event-contract.md), [Pibo Session Signals](./pibo-session-signals.md), `../changes/pibo-observability-debug-telemetry/spec.md`, `../../project/observability-telemetry-playbooks.md`, `../../project/observability-telemetry-rollout-verification.md`

## Why

Pibo needs enough runtime evidence to explain a stuck session without dumping raw provider streams, full transcripts, normalized event payloads, or full tool arguments. Operators should be able to start with a Pibo Session id, find the active turn and phase, and drill into provider or tool facts through bounded summaries.

Runtime Observability Telemetry provides that evidence. It records compact, correlated rows for turns, phases, provider requests, provider event metadata, and tool-call progress in the unified `pibo.sqlite` store.

## Goal

Pibo MUST record local-first runtime telemetry that is correlated, bounded, content-safe by default, and readable through progressive debug commands.

## Background / Current State

The existing debug surface can inspect sessions, traces, events, yielded runs, jobs, reliability streams, and live signals. It cannot answer provider- and phase-level questions such as whether a provider request received bytes, which raw event types appeared, whether tool arguments were still growing, or when the last normalized event was emitted.

Telemetry fills that gap without becoming a second transcript store.

## Scope

### In Scope

- Telemetry turns and phase timelines for routed runtime work.
- Provider request lifecycle summaries and provider event metadata or aggregates.
- Tool-call argument progress and tool execution summary links.
- Correlation fields for sessions, rooms, turns, phases, normalized events, payload metadata, provider requests, upstream responses, tool calls, yielded runs, and event streams.
- Retention classes, stats, and dry-run-first pruning.
- Read-only stale-work detection with provider/profile-aware thresholds.
- Preview-disabled behavior by default.
- Best-effort writes that do not break runtime execution.

### Out of Scope

- Automatic timeout recovery, abort, or retry behavior.
- External observability SaaS integration.
- Chat Web telemetry drill-down UI in V1.
- Full raw provider request or response storage.
- Duplicate transcript, normalized event payload, or full tool argument storage.
- High-cardinality per-token analytics.

## Requirements

### Requirement: Telemetry records are explicitly correlated

Telemetry records MUST carry direct ids for the objects they describe instead of relying on timestamp inference.

#### Acceptance

- Turn, phase, provider, event, and tool rows include applicable ids: `piboSessionId`, `rootSessionId`, `roomId`, `turnId`, `phaseId`, normalized event id or row id, payload metadata id, `providerRequestId`, `upstreamResponseId`, `toolCallId`, `toolName`, `runId`, `eventStreamId`, `createdAt`, and `updatedAt`.
- Debug queries can move from session to turn, provider, and tool evidence, then back to session/event/payload evidence.
- Many-to-many join tables are used only where a real many-to-many relation exists.

### Requirement: Runtime phases are first-class

The system MUST record ordered phase rows for each processed turn.

#### Acceptance

- Phase rows cover the V1 minimum set when observable: `queued`, `message_started`, `prompt_build`, `provider_request`, `provider_stream`, `reasoning`, `assistant_text`, `tool_args`, `tool_execution`, `continuation`, `finish`, `abort`, `error`, and `timeout`.
- Open phases keep `startedAt` and `lastProgressAt`; closed phases keep `endedAt`, `durationMs`, and terminal status.
- Missing terminal events remain visible as open or stale phases.

### Requirement: Provider diagnostics summarize streams without payload dumps

Provider telemetry MUST show lifecycle, counters, timings, and safe structural fields without storing full provider bodies by default.

#### Acceptance

- Provider request rows record provider, API, model, transport, service tier when known, start time, response/header status summary, first-byte time, last raw event time, last normalized event time, completion time, upstream response id, terminal status, and safe error category.
- Provider event rows or aggregates record sequence/cursor, timestamp, event type, byte size, parse status, normalized type, item id, tool call id, and allowlisted safe fields.
- Raw provider payload bodies, full headers, and full request bodies are not stored or printed by default.
- Parse errors and unknown event types increment counters and appear in event metadata.

### Requirement: Tool-call progress is separate from tool execution

The system MUST distinguish incomplete tool argument construction from tool execution failures.

#### Acceptance

- Tool-call telemetry records `toolCallId`, tool name, provider request id, turn id, status, argument byte count, first/last delta time, completion time, parse status, safe top-level argument keys, execution start/end, and safe error metadata when available.
- Telemetry does not store full tool arguments, stdout, stderr, or large result bodies by default.
- Interleaved tool calls are correlated by tool call id, provider item id, or output index where available.

### Requirement: Storage volume stays bounded

Telemetry MUST preserve context and disk budget.

#### Acceptance

- Default persistence stores metadata, counters, byte sizes, ids, timings, statuses, and links.
- List queries apply default limits and hard maximum limits.
- Provider event listings use cursor or sequence paging.
- Output reports truncation, aggregation, or unavailable previews where applicable.
- Payload preview capture is disabled or unavailable by default. If a later release enables previews, previews must be explicit, byte-limited, short-lived, and marked with `truncated`, `byteSize`, `contentType`, and retention metadata.

### Requirement: Retention and pruning are explicit

Telemetry MUST expose retention classes and safe pruning operations.

#### Acceptance

- Retention classes include `live`, `diagnostic`, `provider_event`, `payload_preview`, and `incident` where applicable.
- Stats report counts and byte estimates by retention class.
- Prune defaults to dry-run and requires an explicit apply/destructive flag to delete telemetry rows.
- Prune affects telemetry rows only; it does not delete sessions, transcripts, normalized events, or unrelated stores.

### Requirement: Stale detection is read-only and threshold-aware

Stale detection MUST identify active work whose phase has not progressed without mutating sessions.

#### Acceptance

- Stale results include Pibo Session id, turn id, phase, stale duration, last progress time, queue depth when known, applied threshold, threshold source, and next-command metadata.
- Thresholds can come from provider/profile settings or safe defaults.
- Stale detection never aborts, clears, disposes, retries, or prunes work.

### Requirement: Signals show hints while telemetry stores evidence

Live status and signal projections MAY expose compact active telemetry hints, but detailed evidence remains in telemetry commands.

#### Acceptance

- Hints include active phase, active turn id, last progress timestamp, stale age, and queue depth when available.
- Hints omit raw provider events, payload previews, headers, transcripts, normalized event payloads, and full tool arguments.
- Telemetry-unavailable status remains backward-compatible.

## CLI Contract

The Debug CLI exposes telemetry through `pibo debug telemetry ...`. It starts with compact help and broad lists, then narrows by id:

```text
pibo debug telemetry --help
pibo debug telemetry sessions --active
pibo debug telemetry session <pibo-session-id>
pibo debug telemetry turn <turn-id-or-event-id>
pibo debug telemetry provider <provider-request-id>
pibo debug telemetry provider <provider-request-id> events --limit 20
pibo debug telemetry tool <tool-call-id>
pibo debug telemetry stale
pibo debug telemetry stats
pibo debug telemetry prune --retention diagnostic --before <iso-date> --dry-run
```

Every list/detail command supports JSON where agents need drill-down ids. Summary commands omit raw provider payloads, full transcripts, normalized event payloads, and full tool arguments.

## Retention Defaults

- Turn summaries: 30 days.
- Phase summaries: 30 days.
- Provider request summaries: 14 days.
- Provider event summaries: 7 days when stored per event or aggregate.
- Payload previews: 24 hours if explicitly enabled later.
- Incident retention class: kept until explicit prune.

Use `pibo debug telemetry stats` to inspect counts and byte estimates. Use `pibo debug telemetry prune --retention <class> --before <iso-date>` for a dry-run cleanup plan, then add `--apply` only after reviewing the plan. See `docs/project/observability-telemetry-playbooks.md` for retention cleanup examples.

## Constraints

- **Safety:** Telemetry writes are best-effort and non-fatal.
- **Compatibility:** Existing debug commands keep their current behavior unless explicitly versioned.
- **Storage:** Telemetry lives in unified `pibo.sqlite`; Pibo does not create a separate telemetry database for V1.
- **Privacy:** Default telemetry never stores or prints full provider payloads, headers, transcripts, normalized event payloads, or full tool arguments.
- **CLI design:** The telemetry branch follows progressive discovery and bounded output rules.

## Traceability

| Requirement | Source change coverage | Status |
|---|---|---|
| Correlated telemetry records | PRD 02, PRD 03, PRD 04 | Draft |
| Runtime phase timelines | PRD 02, PRD 03, PRD 04 | Draft |
| Provider diagnostics without payload dumps | PRD 02, PRD 03, PRD 04 | Draft |
| Tool-call progress | PRD 02, PRD 03, PRD 04 | Draft |
| Bounded storage and output | PRD 01, PRD 02, PRD 04, PRD 05 | Draft |
| Retention and pruning | PRD 02, PRD 04, PRD 05 | Draft |
| Read-only stale detection | PRD 04, PRD 05 | Draft |
| Signal/status hints | PRD 05 | Draft |

## Verification Basis

- `npm run typecheck`.
- Telemetry store and migration tests.
- Debug telemetry CLI tests for text and JSON output.
- Synthetic partial-tool-call drill-down fixture.
- Bounded-output and no-raw-content tests.
- Retention stats and prune dry-run tests.
