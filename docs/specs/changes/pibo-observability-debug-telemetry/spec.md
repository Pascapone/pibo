# Spec: Pibo Observability and Debug Telemetry

**Status:** Draft
**Created:** 2026-05-16
**Controller / Source:** User request in Pibo session `ps_d9c7dfdf-3959-4236-ad89-d4ffab3f7066`
**Related docs:** `docs/specs/capabilities/debug-cli.md`, `docs/specs/capabilities/pibo-event-contract.md`, `docs/specs/capabilities/pibo-data-store-and-ingestion.md`, `docs/specs/capabilities/pibo-session-signals.md`, `docs/specs/capabilities/local-gateway-protocol-and-lifecycle.md`, `docs/reports/incident-2026-05-16-stuck-toolcall-stream.md`

## Why

Pibo needs incident diagnosis that works like the existing Debug CLI: start broad, show compact summaries, then drill into one session, turn, provider request, stream, or tool call. Agents must be able to discover what happened without filling their context with raw provider payloads or full transcripts.

The 2026-05-16 stuck-session incident showed the gap. Pibo could show `processing=true`, `streaming=true`, and a partial `tool_call`, but it could not show whether the upstream provider stream was idle, sending unknown events, failing JSON parse, or still producing unnormalized deltas.

## Goal

Pibo MUST provide bounded, progressively discoverable telemetry that lets an agent locate the active or failed phase of runtime work and drill into related provider, tool, queue, stream, session, and event facts without duplicating large payloads.

## Background / Proposal-Time Current State

This change spec preserves the 2026-05-16 proposal baseline. Its `Current` sections describe the state before the observability telemetry implementation, not the current code after implementation. For source-backed current behavior, use the Runtime Observability Telemetry, Debug CLI, and Pibo Session Signals capability specs.

At proposal time, `pibo debug` exposed stores, sessions, traces, events, jobs, runs, and signals. The event log stored normalized Pibo events and compact payload attributes. Signals exposed current live status when a gateway URL was configured. The reliability stream could inspect output event topics.

Missing at proposal time:

- provider request lifecycle records,
- raw provider event-type timelines,
- provider stream last-byte and last-event times,
- tool-call argument progress metadata,
- phase-level active-turn state,
- timeout/staleness diagnostics,
- optional bounded payload previews by selector, if previews are approved for V1,
- debug commands that connect session status to provider/tool/span evidence.

Implementation status as of the 2026-05-17 source audit: V1 telemetry is implemented in current code through `src/data/telemetry.ts`, `src/core/runtime-telemetry.ts`, `src/core/provider-telemetry.ts`, `src/core/telemetry-staleness.ts`, `src/debug/telemetry.ts`, and active signal hints in `src/signals/registry.ts`. `tasks.md` records the implementation tasks as complete; remaining product choices are tracked as open questions rather than current-code gaps.

## Scope

### In Scope

- Telemetry for Pibo Session turns, queue state, routed-session phases, provider requests, provider streams, normalized events, tool-call construction, tool execution, aborts, timeouts, and runtime/gateway status snapshots.
- Progressive `pibo debug telemetry` command surface with compact summaries, selectors, cursors, limits, and JSON output.
- Storage contracts for bounded telemetry rows in the unified `pibo.sqlite` data store.
- Correlation identifiers across session id, room id, turn/event id, normalized event row, provider request id, upstream response id, tool call id, run id, payload metadata, and stream id.
- Payload-size controls and optional preview/redaction controls where previews are implemented.
- Retention policy and pruning behavior.
- Staleness detection signals that point to the next debug command.

### Out of Scope

- Fixing provider hangs or adding automatic timeout behavior — covered by separate runtime hardening work.
- Full distributed tracing with external SaaS dependencies.
- Exporting raw auth tokens, OAuth payloads, API keys, full provider request bodies, full transcripts, normalized event payloads, or full tool arguments by default.
- Replacing Chat Web trace rendering.
- Long-term analytics dashboards.
- High-cardinality per-token storage.

## Requirements

### Requirement: Telemetry discovery is progressive

The Debug CLI MUST expose telemetry through summary-first commands and MUST avoid dumping raw payloads by default.

#### Current

`pibo debug` uses progressive help for sessions, traces, events, jobs, runs, and db commands. No telemetry branch exists.

#### Target

An agent starts with `pibo debug telemetry --help` or `pibo debug telemetry sessions`, then narrows to one session, turn, provider request, or tool call.

#### Acceptance

- `pibo debug telemetry --help` lists immediate subcommands and examples only.
- Summary commands show counts, ids, timestamps, phase labels, stale ages, and next commands.
- Default output is bounded to a small row limit.
- `--json` returns structured data with the same bounded defaults.
- Raw or preview payload access, if V1 supports it at all, requires an explicit payload command or selector.

#### Scenario: Agent starts broad

- GIVEN an agent only knows a Pibo Session id
- WHEN it runs `pibo debug telemetry session <pibo-session-id>`
- THEN output shows recent turns, active phase, queue depth, last telemetry event age, and suggested drill-down commands
- AND does not print provider request bodies or full transcript text.

### Requirement: Every telemetry record is correlated

Telemetry records MUST carry enough correlation fields to connect runtime facts to sessions, turns, providers, tools, and persisted events.

#### Current

Normalized Pibo events carry `piboSessionId`, optional `eventId`, `runId`, and `toolCallId`. Provider request ids and raw stream ids are not persisted as first-class diagnostic records.

#### Target

Telemetry rows can be joined by explicit ids instead of inferred from timestamps. Because telemetry lives in `pibo.sqlite`, debug commands can query session, room, event-log, payload, and telemetry evidence together.

#### Acceptance

Telemetry records include applicable fields:

- `piboSessionId`
- `rootSessionId`
- `roomId`
- `turnId` or message/event id
- `phaseId`
- `providerRequestId`
- `upstreamResponseId`
- `toolCallId`
- `toolName`
- `runId`
- `eventStreamId`
- normalized event row id or event id when available
- payload metadata id when available
- `createdAt`
- `updatedAt`

#### Scenario: Find provider request for a stuck turn

- GIVEN a turn has a partial tool call
- WHEN an agent inspects that turn telemetry
- THEN the output includes the provider request id and upstream response id when known
- AND the next command can inspect that provider request directly.

### Requirement: Runtime phases are explicit

The system MUST record phase transitions for each processed message turn.

#### Current

Operators infer phase from normalized events such as `thinking_started`, `tool_call`, and `tool_execution_started`.

#### Target

Each turn has a compact phase timeline that identifies queueing, prompt build, provider request, provider stream, thinking, assistant text, tool argument construction, tool execution, continuation, completion, abort, and error states.

#### Acceptance

- A turn timeline lists ordered phases with start time, end time, duration, status, and summary.
- Active phases show `lastProgressAt` and `staleForMs`.
- Terminal phases show status `ok`, `error`, `aborted`, or `timeout`.
- Missing terminal events are visible as `open` or `stale`, not silently hidden.

#### Scenario: Partial tool-call phase

- GIVEN the provider emitted `toolcall_start` but no `toolcall_end`
- WHEN an agent runs `pibo debug telemetry turn <turn-id>`
- THEN the phase timeline includes `tool_args` with `status=open`
- AND shows last progress time and current argument byte length if known.

### Requirement: Provider request lifecycle is visible

The system MUST record provider request lifecycle facts without storing full headers or full payload bodies by default.

#### Current

Pibo can infer the model from status and some session errors. It does not persist provider request start, response headers, first byte, last byte, or upstream response id.

#### Target

Provider request diagnostics answer whether a request was sent, accepted, streamed, completed, aborted, timed out, or failed.

#### Acceptance

Provider request records include:

- provider, api, model id, transport, service tier when known,
- request start time,
- response status and compact header/status summary,
- first byte time,
- last raw event time,
- last normalized event time,
- upstream response id when observed,
- terminal status and error category,
- raw event counts by type,
- parse error counts,
- unknown event type counts.

#### Scenario: Provider stream stopped after first tool event

- GIVEN a provider request produced one `response.output_item.added` event and then no terminal event
- WHEN an agent inspects the provider request
- THEN output shows first byte time, last raw event time, last normalized event time, raw event counts, and missing terminal status.

### Requirement: Raw provider events are summarized, not dumped

The system MUST store and display provider-stream metadata, counters, safe structural fields, and links by default. It MUST NOT store or display full raw provider event bodies by default.

#### Current

Pibo does not persist raw provider stream events. Normalized output events are compacted and stored.

#### Target

Agents can see raw provider event type timelines, counters, timings, and selected safe structural fields. V1 should not require storing full raw provider event bodies.

#### Acceptance

- `pibo debug telemetry provider <provider-request-id> events` lists raw provider event type, sequence or aggregate window, timestamps, byte sizes, parse status, counters, safe structural fields, and normalized event links where available.
- The default command omits raw JSON payloads.
- `--fields` selects allowlisted safe structural fields where available.
- Payload preview commands are optional for V1 and must be explicit, bounded, and clearly marked if implemented.
- Output reports whether event rows are per-event, aggregated, sampled, or truncated.

#### Scenario: Unknown event type appears

- GIVEN a provider emits an unknown SSE event type
- WHEN an agent lists provider events
- THEN the unknown type appears with count and sequence ids
- AND, if bounded samples are enabled, the agent can fetch one bounded sample payload by id.

### Requirement: Tool-call argument progress is visible

The system MUST record tool-call construction progress separately from tool execution.

#### Current

Pibo emits `tool_call` for start/end states with `argsComplete`, but not every provider argument delta. The stored event log may only show `argsComplete=false` before a stall.

#### Target

Agents can tell whether tool args were growing, stalled, malformed, or completed.

#### Acceptance

Tool-call telemetry includes:

- `toolCallId`, tool name, and provider request id,
- argument byte length over time,
- first and last argument delta times,
- parse status: `empty`, `partial`, `valid`, `invalid`, or `complete`,
- safe top-level argument keys when parseable,
- completion status and linked execution start when present.

#### Scenario: Args never complete

- GIVEN a `bash` tool call receives partial command text but no completion event
- WHEN an agent inspects the tool-call telemetry
- THEN output shows `parseStatus=partial`, `argsComplete=false`, no execution start, and last delta age.

### Requirement: Stale active work is discoverable

The telemetry system MUST identify active work whose phase has not progressed within a configured threshold.

#### Current

Gateway status shows `processing`, `streaming`, and queue depth. It does not explain stale age or phase.

#### Target

Agents can list stale sessions or turns and jump to the relevant phase diagnostics.

#### Acceptance

- `pibo debug telemetry stale` lists active sessions/turns whose last progress exceeds the threshold.
- Each row includes session id, turn id, phase, stale duration, queue depth, and next command.
- The threshold is configurable, with a safe default.
- Stale detection does not itself abort work.

#### Scenario: Session remains streaming

- GIVEN a session is `streaming=true` and no telemetry progress has occurred for five minutes
- WHEN an agent runs `pibo debug telemetry stale`
- THEN the session appears with phase `provider_stream` or `tool_args`
- AND the output points to `pibo debug telemetry turn <turn-id>`.

### Requirement: Telemetry preserves context budget

All debug telemetry commands MUST bound output by rows, depth, payload bytes, and summary size.

#### Current

Existing debug commands clamp limits and avoid full payload dumps unless requested.

#### Target

Telemetry commands maintain the same discipline even when provider streams are noisy.

#### Acceptance

- Default list commands limit rows to at most 50.
- Commands with nested output limit depth unless `--depth` is supplied.
- Payload previews default to a small byte limit and can be increased only with an explicit flag up to a hard maximum.
- Output states when rows, fields, or payloads are truncated.

#### Scenario: Noisy provider stream

- GIVEN a provider request has 10,000 raw events
- WHEN an agent runs the default provider event listing
- THEN it prints only the first or latest bounded page with cursor information
- AND does not include raw payload bodies.

### Requirement: Telemetry is bounded and content-safe by default

Telemetry MUST avoid duplicating full content bodies by default and MUST bound any optional preview before persistence or display.

#### Current

Some debug outputs rely on compact payloads. Raw provider capture does not exist.

#### Target

The telemetry layer has a consistent storage-volume and preview model.

#### Acceptance

- Full provider payloads, full transcripts, normalized event payloads, and full tool arguments are not stored in telemetry by default.
- Raw provider payload capture is omitted or disabled by default; if enabled later, it stores only bounded previews.
- Commands display capture/preview mode and truncation status where applicable.
- Operators cannot accidentally dump full raw payloads through a summary command.

#### Scenario: Large provider payload exists

- GIVEN a provider event contains a large JSON payload or tool argument fragment
- WHEN telemetry stores or displays request/event metadata
- THEN telemetry stores only metadata, counters, safe structural fields, and links by default
- AND no summary command prints the full payload or full tool arguments.

### Requirement: Telemetry retention is explicit

The system MUST assign retention classes and provide pruning commands for telemetry.

#### Current

Event streams already have retention classes and pruning helpers. Telemetry does not exist as a separate retention domain.

#### Target

Telemetry supports local operations without unbounded disk growth.

#### Acceptance

- Telemetry records have retention classes such as `live`, `diagnostic`, `incident`, and `payload_preview`.
- Raw or preview payload records have shorter default retention than summary records.
- `pibo debug telemetry stats` reports record counts, byte sizes, and retention classes.
- `pibo debug telemetry prune` requires explicit retention and cutoff inputs and supports dry-run by default.

#### Scenario: Prune payload previews

- GIVEN payload previews older than the configured cutoff exist
- WHEN an operator runs prune in dry-run mode
- THEN output reports rows and bytes that would be removed
- AND no rows are deleted until an explicit apply/destructive flag is supplied.

### Requirement: Signals show hints, telemetry stores evidence

Live session signals MUST expose compact active-phase hints, while detailed evidence remains in telemetry commands.

#### Current

Signals report session activity state and active nodes, but not full provider diagnostics.

#### Target

Chat Web and gateway status can show “stale provider stream” hints without carrying raw event data.

#### Acceptance

- Signal snapshots can include active phase, stale age, and last progress time.
- Signal snapshots do not include raw provider payloads.
- Debug commands remain the source for detailed provider/tool telemetry.

#### Scenario: UI shows stale hint

- GIVEN a session has an active stale provider phase
- WHEN Chat Web renders the session status
- THEN it can show a compact stale hint
- AND the detailed evidence remains available through debug telemetry commands.

### Requirement: JSON output is stable enough for agents

Telemetry commands MUST support machine-readable JSON for automation and agent-driven drill-down.

#### Current

Many debug commands support `--json`.

#### Target

Agents can parse telemetry command results and choose the next command without brittle text parsing.

#### Acceptance

- Every telemetry command that prints rows supports `--json`.
- JSON includes `next` suggestions or cursor fields where applicable.
- JSON distinguishes truncated data from complete data.
- Error JSON includes command, input, and safe diagnostic reason.

#### Scenario: Agent drill-down loop

- GIVEN an agent runs `pibo debug telemetry session <id> --json`
- WHEN the result contains an active stale turn
- THEN the JSON contains the turn id and provider request id needed for the next command.

## CLI Surface

The exact names may change during implementation, but the command surface MUST preserve this discovery shape:

```text
pibo debug telemetry --help
pibo debug telemetry sessions [--active] [--stale] [--limit n] [--json]
pibo debug telemetry session <pibo-session-id> [--limit n] [--json]
pibo debug telemetry turn <turn-id-or-event-id> [--events] [--depth n] [--json]
pibo debug telemetry provider <provider-request-id> [--json]
pibo debug telemetry provider <provider-request-id> events [--after seq] [--limit n] [--fields a,b.c] [--json]
pibo debug telemetry provider <provider-request-id> payload <preview-or-event-summary-id> [--max-bytes n] [--json]
pibo debug telemetry tool <tool-call-id> [--json]
pibo debug telemetry stale [--threshold-ms n] [--json]
pibo debug telemetry stats [--retention class] [--json]
pibo debug telemetry prune --retention class --before iso-date [--dry-run|--apply] [--json]
```

## Edge Cases

- Gateway is down but durable telemetry exists.
- Gateway is up but live runtime has no durable telemetry for older sessions.
- Provider emits malformed JSON lines.
- Provider emits unknown event types.
- Provider stream sends bytes but no meaningful normalized events.
- Tool-call deltas interleave across multiple function calls.
- Provider event volume is high enough that per-event storage would grow too quickly.
- A turn is aborted while a provider request is active.
- A tool execution starts but the process exits before finish event.
- Telemetry store is missing, corrupt, or still migrating.
- Payload preview is unavailable because capture was disabled.
- Preview/truncation policy removes too much detail to diagnose a parser issue.
- Multiple cloned sessions share similar Pi session ancestry but different Pibo Session ids.

## Constraints

- **Compatibility:** Existing `pibo debug` commands must keep their current output contracts unless explicitly versioned.
- **Security / Privacy:** Raw payloads, full headers, cookies, tokens, OAuth fields, API keys, full transcripts, normalized event payloads, and full tool arguments must not appear in default output.
- **Performance:** Telemetry writes must not block token streaming or tool output paths beyond small bounded work.
- **Storage:** Telemetry must not duplicate full sessions, transcripts, normalized event payloads, provider payloads, or tool arguments. Provider event storage must be bounded or aggregated when needed.
- **Context Budget:** Debug output must remain compact by default and report truncation.
- **Local First:** Telemetry must work without external observability services.

## Success Criteria

- [ ] SC-001: An agent can diagnose a stuck session by running at most four bounded telemetry commands from session id to likely stalled phase.
- [ ] SC-002: A partial tool-call stream shows provider request id, raw event counts, last progress time, argument progress state, and missing completion.
- [ ] SC-003: No default telemetry command prints or duplicates full provider payloads, full headers, transcripts, normalized event payloads, or full tool arguments.
- [ ] SC-004: All telemetry list commands support bounded text and `--json` output.
- [ ] SC-005: Telemetry stats and prune commands expose retention and disk usage.
- [ ] SC-006: Existing debug CLI tests continue to pass after adding telemetry commands.

## Assumptions and Open Questions

### Assumptions

- Telemetry will be stored in the unified `pibo.sqlite` data store with dedicated telemetry tables.
- Provider raw payload previews are disabled/unavailable by default in V1 and are not required for useful diagnosis.
- Existing event-log payload metadata and storage helpers can be linked/reused where appropriate instead of duplicating payload content.
- Metadata telemetry capture is independent of raw Pi event forwarding settings unless telemetry itself is explicitly disabled.

### Open Questions

- What provider- and phase-aware stale thresholds should production use?
- What exact Provider Settings config shape should expose stale thresholds?
- Should bounded provider event previews be enabled later for unusual/error events?
- How much provider event detail should be stored before aggregation, sampling, or pruning to avoid redundant/high-volume storage?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| Progressive discovery | Agent starts broad | tasks.md 1, 5; `src/debug/index.ts`; `test/debug-cli.test.mjs` | Implemented |
| Correlation | Find provider request for stuck turn | tasks.md 2; `src/data/telemetry.ts`; `test/telemetry-store.test.mjs` | Implemented |
| Runtime phases | Partial tool-call phase | tasks.md 2, 3; `src/core/runtime-telemetry.ts`; `test/runtime-telemetry.test.mjs` | Implemented |
| Provider lifecycle | Provider stream stopped | tasks.md 3; `src/core/provider-telemetry.ts`; `test/runtime-telemetry.test.mjs` | Implemented |
| Raw summaries | Unknown event type appears | tasks.md 3, 5; `src/core/runtime-telemetry.ts`; `src/debug/telemetry.ts` | Implemented |
| Tool-call progress | Args never complete | tasks.md 3; `src/core/runtime-telemetry.ts`; `test/telemetry-stuck-tool-call-fixture.test.mjs` | Implemented |
| Stale active work | Session remains streaming | tasks.md 4, 5; `src/core/telemetry-staleness.ts`; `test/telemetry-staleness.test.mjs` | Implemented |
| Context budget | Noisy provider stream | tasks.md 5; `src/debug/telemetry.ts`; `test/debug-cli.test.mjs` | Implemented |
| Bounded/content-safe storage | Large provider payload exists | tasks.md 2, 3, 5; `src/data/telemetry.ts`; `test/runtime-telemetry.test.mjs` | Implemented |
| Retention | Stats/prune retention classes and preview-unavailable behavior | tasks.md 2, 5; `src/data/telemetry.ts`; `test/telemetry-store.test.mjs` | Implemented |
| Signal hints | UI shows stale hint | tasks.md 4; `src/signals/registry.ts`; `test/signal-registry.test.mjs` | Implemented |
| JSON output | Agent drill-down loop | tasks.md 5; `src/debug/telemetry.ts`; `test/debug-cli.test.mjs` | Implemented |
