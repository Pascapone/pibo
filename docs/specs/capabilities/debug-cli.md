# Spec: Debug CLI

**Status:** Draft  
**Created:** 2026-05-10  
**Owner / Source:** Scheduled Pibo Source Specs Coverage  
**Related docs:** `GLOSSARY.md`, [Pibo Session Routing](./pibo-session-routing.md), [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Yielded Run Control](./yielded-run-control.md), [Runtime Observability Telemetry](./runtime-observability-telemetry.md)

## Why

Pibo stores operational truth across Pibo Session metadata, Chat Web projections, event streams, durable jobs, and yielded runs. Agents and operators need a compact, safe way to inspect those stores when a session, room, trace, job, or run behaves unexpectedly.

The Debug CLI is that read-oriented diagnostic boundary. It must expose enough information to diagnose local state without requiring ad hoc SQLite commands, accidental writes, or direct knowledge of every table.

## Goal

`pibo debug` MUST provide progressively discoverable, mostly read-only diagnostics for local Pibo stores, sessions, traces, events, jobs, runs, live signal snapshots, and runtime telemetry.

## Background / Current State

Current code routes `pibo debug` from `src/cli.ts` into `src/debug/index.ts`. The debug commands resolve known stores from the Pibo home directory, inspect SQLite databases with bounded output, rebuild Chat Web trace views from stored sessions and events, query reliability events, list and replay dead durable jobs, inspect yielded runs, and fetch live signal snapshots through Chat Web APIs when `PIBO_GATEWAY_URL` or `PIBO_WEB_URL` is set. The telemetry branch described here is the planned extension for runtime observability telemetry.

Automated coverage lives in `test/debug-cli.test.mjs` and asserts progressive help, read-only SQL behavior, Chat URL session parsing, trace rebuilding, event field extraction, reliability stream inspection, job replay, run inspection, and missing-store errors.

## Scope

### In Scope

- `pibo debug` root discovery and subcommand discovery.
- Local store discovery for Pibo-owned SQLite stores.
- Read-only table, schema, and SQL query inspection.
- Pibo Session inspection by id or Chat Web URL.
- Chat Web trace reconstruction and consistency checks.
- Compact event and reliability stream inspection.
- Durable job listing, dead-letter listing, and explicit replay.
- Durable yielded-run listing and inspection.
- Live signal snapshot inspection through configured web gateway URLs.
- Runtime observability telemetry discovery, session/turn/provider/tool drill-down, stale-work listing, stats, and dry-run-first pruning.
- Bounded, machine-readable JSON output where supported.

### Out of Scope

- Replacing the user-facing Chat Web UI.
- General-purpose database administration.
- Arbitrary mutating SQL.
- Remote database discovery without an explicit gateway URL.
- Authenticated browser session debugging beyond visible local store and API state.
- Full data migration or repair workflows, except narrowly scoped debug actions already present in code.

## Requirements

### Requirement: Discovery is progressive

The Debug CLI MUST show only the immediate command surface for the current level and point to useful next commands.

#### Current

`pibo debug --help` lists `db`, `session`, `trace`, `events`, `jobs`, `runs`, `signals`, and, when implemented, `telemetry`. Each branch has its own help text.

#### Acceptance

- `pibo debug --help` does not print database schemas or table names beyond the command surface.
- `pibo debug db --help` lists known store aliases and database commands without printing full schemas.
- Unknown commands fail with a message that names the relevant help command.

#### Scenario: Root help remains compact

- GIVEN an operator does not know the debug surface
- WHEN they run `pibo debug --help`
- THEN the output lists subcommands and next-step examples
- AND it does not dump SQLite schemas or event payloads.

### Requirement: Store discovery uses Pibo home paths

The Debug CLI MUST resolve known debug stores from the configured Pibo home directory and report whether each store exists.

#### Current

`PIBO_DEBUG_STORES` defines `pibo-data`, `sessions`, `chat`, `agents`, `auth`, `bindings`, and `reliability`. `sessions` and `chat` are aliases for `pibo.sqlite`.

#### Acceptance

- `pibo debug db stores` lists store name, resolved path, existence, and description.
- Missing stores fail with the resolved path in the error.
- Unknown store names fail before opening a database.

#### Scenario: Missing session store

- GIVEN the configured Pibo home has no `pibo.sqlite`
- WHEN an operator runs `pibo debug db tables sessions`
- THEN the command fails with a message containing the missing store name and resolved path.

### Requirement: SQL inspection is read-only and bounded

The Debug CLI MUST allow only single-statement read-only SQL and MUST bound returned rows.

#### Current

`runReadOnlyQuery` accepts `SELECT`, `WITH ... SELECT`, and read-only PRAGMA calls for `table_info`, `index_list`, and `index_info`. It rejects mutating keywords and multiple statements, applies a default limit of 50, and clamps limits to 1000.

#### Acceptance

- `pibo debug db tables <store>` lists user tables only.
- `pibo debug db schema <store>` lists tables, columns, and indexes.
- `pibo debug db query <store> <sql>` rejects `INSERT`, `UPDATE`, `DELETE`, `DROP`, `VACUUM`, and similar mutating tokens.
- Query output reports when rows were limited.

#### Scenario: Mutating SQL is rejected

- GIVEN a valid debug store
- WHEN an operator runs `pibo debug db query sessions "insert into sessions(id) values ('x')"`
- THEN the command fails
- AND no database mutation is performed.

### Requirement: Session inspection accepts Pibo Session IDs and Chat URLs

The Debug CLI MUST parse a raw Pibo Session ID or canonical Chat Web session URL and return compact session, room, child, metadata, and optional event summaries.

#### Current

`parseDebugSessionInput` accepts `ps_...`, `/apps/chat/rooms/<roomId>/sessions/<piboSessionId>`, `/apps/chat/sessions/<piboSessionId>`, and full HTTP(S) URLs with those paths.

#### Acceptance

- A valid Chat URL extracts both room id and Pibo Session id.
- A room id mismatch between the URL and stored session room metadata appears as a warning.
- Child sessions are listed with subagent metadata when present.
- `--events` returns compact event summaries, not full payload dumps.
- `--json` emits the same information as structured JSON.

#### Scenario: URL room mismatch is visible

- GIVEN a stored session belongs to `room_a`
- WHEN an operator inspects `/apps/chat/rooms/room_b/sessions/<id>`
- THEN the result includes a room mismatch warning.

### Requirement: Trace inspection reuses Chat Web trace semantics

The Debug CLI MUST rebuild a session trace using the same trace-view behavior as Chat Web and expose optional consistency diagnostics.

#### Current

`inspectDebugTrace` loads session rows and stored events, calls `buildTraceView`, flattens trace nodes, supports `--running-only`, and supports `--check` diagnostics for duplicate ids, missing parents, missing ordering/source/stable keys, and sibling order regressions.

#### Acceptance

- `pibo debug trace <pibo-session-id>` prints compact flattened nodes with status, type, title, id, run id, and linked Pibo Session id.
- `--running-only` returns only running nodes while preserving total-node context in the count.
- `--check` includes consistency status and issue rows.
- Missing session or chat stores fail before returning partial trace results.

#### Scenario: Running tool node is isolated

- GIVEN a stored session has an active tool execution event
- WHEN an operator runs `pibo debug trace <id> --running-only`
- THEN only running trace nodes are printed.

### Requirement: Event inspection is compact by default

The Debug CLI MUST expose event rows and selected payload fields without dumping full event payloads unless the operator explicitly selects fields.

#### Current

`pibo debug events <pibo-session-id>` reads Chat Web `event_log`, filters by type, and extracts dot-path fields from inline payloads or compact attributes.

#### Acceptance

- Event rows include created time, type, event id, and stream id.
- `--type` narrows rows by event type.
- `--fields a,b.c` adds only those payload fields to output.
- `--limit` bounds event rows.

#### Scenario: Inspect one tool result field

- GIVEN a tool execution finished event has an inline result payload
- WHEN an operator runs `pibo debug events <id> --type tool_execution_finished --fields toolName,result.details.status`
- THEN the output contains those fields and omits unrelated payload data.

### Requirement: Reliability stream diagnostics are explicit

The Debug CLI MUST inspect reliability event streams, consumer offsets, aggregate event counts, and retention pruning through named subcommands.

#### Current

`pibo debug events stream`, `stats`, `consumers`, `prune`, and `compact-deltas` operate against the reliability store or selected data stores.

#### Acceptance

- Stream inspection can filter by topic and starting stream id.
- Stats can filter by topic, session key, and retention class.
- Consumer inspection lists stored consumer offsets.
- Prune requires topic, retention class, and before timestamp.
- Prune performs the deletion path only when its command-specific destructive option is supplied by code path; otherwise output reports planned or non-destructive behavior as implemented.
- Delta compaction reports dry-run versus applied status and supports session-scoped cleanup.

#### Scenario: Stream after cursor

- GIVEN reliability events exist for `pibo.output`
- WHEN an operator runs `pibo debug events stream --topic pibo.output --after 123`
- THEN only events after stream id `123` are shown.

### Requirement: Durable job diagnostics distinguish live and dead work

The Debug CLI MUST list queued jobs, list dead-letter jobs, and replay a dead job only through an explicit replay command.

#### Current

`pibo debug jobs list`, `dead`, and `replay` use `PiboReliabilityStore` and compact job rows.

#### Acceptance

- `list` can filter by queue and limit.
- `dead` can filter by queue and limit.
- `replay <job-id>` requeues a dead job and removes it from the dead-letter list.
- Missing reliability store fails with a clear store error.

#### Scenario: Replay dead job

- GIVEN a job is in the dead-letter queue
- WHEN an operator runs `pibo debug jobs replay <job-id>`
- THEN the job appears as pending work again
- AND it no longer appears in the dead-letter list.

### Requirement: Durable yielded runs are inspectable by owner session or id

The Debug CLI MUST expose durable yielded-run records without using agent-facing run-control ownership checks.

#### Current

`pibo debug runs list <pibo-session-id>` lists all durable runs for a Pibo Session including consumed and detached records. `inspect <run-id>` returns one durable run record.

#### Acceptance

- List output includes run id, owner Pibo Session id, status, tool name, completion policy, consumed flag, update time, and summary.
- Inspect output can include stored result or error data in JSON.
- Unknown run ids fail clearly.

#### Scenario: Inspect completed yielded run

- GIVEN a completed yielded run exists in the reliability store
- WHEN an operator runs `pibo debug runs inspect <run-id> --json`
- THEN the JSON result includes the run id, owner Pibo Session id, status, and stored terminal result.

### Requirement: Live signals require an explicit gateway URL

The Debug CLI MUST inspect live session signal snapshots only through an explicitly configured Chat Web gateway URL.

#### Current

`pibo debug signals session` and `tree` read `PIBO_GATEWAY_URL` or `PIBO_WEB_URL`, call `/api/chat/signals/...`, and format snapshot counts and session statuses.

#### Acceptance

- Without a configured gateway URL, signal commands fail with setup guidance.
- Non-OK gateway responses surface the returned error text when available.
- Text output includes root id, version, session count, node count, active node count, and error-session count.
- `--json` returns the API payload directly.

#### Scenario: Missing gateway URL

- GIVEN no `PIBO_GATEWAY_URL` or `PIBO_WEB_URL` is set
- WHEN an operator runs `pibo debug signals tree <root-id>`
- THEN the command fails and asks for a gateway URL.

### Requirement: Telemetry diagnostics are summary-first and read-oriented

The Debug CLI MUST expose runtime telemetry through a progressive `pibo debug telemetry` branch that starts broad and drills down by id without dumping raw content.

#### Target

`pibo debug telemetry --help` lists only immediate subcommands and examples. Operators can inspect recent sessions, one session, one turn, one provider request, provider event metadata, one tool call, stale active work, retention stats, and prune plans.

The intended discovery flow is:

```text
pibo debug telemetry --help
pibo debug telemetry sessions --active
pibo debug telemetry session <pibo-session-id>
pibo debug telemetry turn <turn-id-or-event-id>
pibo debug telemetry provider <provider-request-id>
pibo debug telemetry provider <provider-request-id> events --limit 20
pibo debug telemetry tool <tool-call-id>
```

#### Acceptance

- The telemetry root help lists `sessions`, `session`, `turn`, `provider`, `tool`, `stale`, `stats`, and `prune` with one-line descriptions and compact next examples.
- `sessions`, `session`, `turn`, `provider`, `provider events`, `tool`, `stale`, `stats`, and `prune` support bounded text output and `--json` where they emit rows or drill-down data.
- Session output includes recent turns, active phase, queue depth, stale age, last progress time, provider request id when known, and next-command suggestions.
- Turn output lists ordered phases with status, start/end or open marker, duration, last progress, stale age, provider request id, and tool call id when known.
- Provider output includes lifecycle facts and raw event counts. Provider event output uses cursor or sequence paging and allowlisted safe fields.
- Tool output shows argument progress and execution linkage while omitting full arguments, stdout, stderr, and raw payloads.
- Stale output is read-only. It reports applied threshold, threshold source, stale age, queue depth, and next command. It never aborts, clears, disposes, retries, or prunes sessions.
- Stats reports telemetry counts and byte estimates by retention class.
- Prune defaults to dry-run and deletes telemetry rows only when an explicit apply/destructive option is supplied.
- Default telemetry commands omit raw provider payload bodies, full headers, transcripts, normalized event payloads, and full tool arguments.

#### Scenario: Agent drills down from a stuck session

- GIVEN an agent knows only `ps_example`
- WHEN they run `pibo debug telemetry session ps_example --json`
- THEN the JSON includes the active turn id, active phase, stale state, and next command suggestions
- AND the output omits provider bodies, transcript text, normalized event payloads, and full tool arguments.

#### Scenario: Prune is deliberate

- GIVEN old telemetry rows exist
- WHEN an operator runs `pibo debug telemetry prune --retention diagnostic --before 2026-05-01T00:00:00.000Z`
- THEN the command reports a dry-run plan by default
- AND no rows are deleted until the operator supplies the explicit apply/destructive flag.

## Edge Cases

- Empty or non-positive limits are rejected.
- Query limits above the maximum are clamped.
- Quoted SQL strings and comments do not permit multi-statement or mutating execution.
- Stores may be missing during first-run setup; commands must fail with paths, not stack traces.
- Chat and sessions stores may point to the same database; commands must avoid closing a shared handle twice.
- Some older event rows may lack inline payloads; debug output must fall back to compact attributes when possible.
- Live signal APIs may be unavailable even when local SQLite stores exist.
- Telemetry tables may be missing for older stores; telemetry commands should fail with a clear migration/store message.
- Telemetry may be disabled or unavailable while other debug branches still work.
- Provider event volumes may be high; telemetry event listings must page, aggregate, or truncate instead of dumping all rows.

## Constraints

- **Safety:** Debug SQL is read-only except for explicit debug maintenance actions already implemented, such as job replay, event pruning, and delta compaction apply.
- **Compatibility:** Store aliases must continue to reflect current unified `pibo.sqlite` while allowing older named stores to remain visible when needed.
- **Performance:** Output must be bounded by default and must not dump full event payloads accidentally.
- **Privacy:** JSON and text output may contain local operational data; the CLI must avoid unnecessary payload expansion by default.
- **Telemetry content safety:** Default telemetry commands must not print raw provider payloads, full request or response headers, full transcripts, normalized event payloads, or full tool arguments.
- **CLI design:** Help output must follow Pibo's progressive discovery rule.

## Success Criteria

- [ ] SC-001: `pibo debug --help` and each subcommand help remain compact and branch-specific.
- [ ] SC-002: Debug database queries cannot mutate stores through SQL input.
- [ ] SC-003: Session inspection works from both Pibo Session IDs and canonical Chat Web URLs.
- [ ] SC-004: Trace inspection can identify running nodes and report consistency warnings.
- [ ] SC-005: Event inspection supports type filtering and selected field extraction.
- [ ] SC-006: Reliability streams, consumers, jobs, and yielded runs are inspectable through named debug commands.
- [ ] SC-007: Missing stores and missing gateway URLs fail with actionable errors.
- [ ] SC-008: The `pibo debug telemetry` branch supports summary-first session, turn, provider, tool, stale, stats, and prune workflows with bounded text and JSON output.

## Assumptions and Open Questions

### Assumptions

- The Debug CLI is an operator and agent diagnostic tool, not an end-user product surface.
- Local Pibo home stores remain the source for offline debug commands.
- Explicit maintenance actions under `pibo debug` are acceptable when named and narrow.

### Open Questions

- Should destructive debug maintenance actions require a consistent `--destructive` or `--apply` confirmation model across all branches?
- Should debug commands eventually support owner-scope filtering for safer multi-user local installations?
- Should live signal inspection use the authenticated same-origin web session or remain a local gateway diagnostic endpoint?

## Traceability

| Requirement | Scenario / Story | Code Basis | Status |
|---|---|---|---|
| REQ-001 Discovery is progressive | Root help remains compact | `src/debug/index.ts`, `test/debug-cli.test.mjs` | Draft |
| REQ-002 Store discovery uses Pibo home paths | Missing session store | `src/debug/stores.ts`, `src/debug/sql.ts` | Draft |
| REQ-003 SQL inspection is read-only and bounded | Mutating SQL is rejected | `src/debug/sql.ts` | Draft |
| REQ-004 Session inspection accepts IDs and URLs | URL room mismatch is visible | `src/debug/session.ts` | Draft |
| REQ-005 Trace inspection reuses Chat Web trace semantics | Running tool node is isolated | `src/debug/trace.ts`, `src/apps/chat/trace.ts` | Draft |
| REQ-006 Event inspection is compact by default | Inspect one tool result field | `src/debug/events.ts` | Draft |
| REQ-007 Reliability stream diagnostics are explicit | Stream after cursor | `src/debug/index.ts`, `src/reliability/store.ts`, `src/debug/delta-compaction.ts` | Draft |
| REQ-008 Durable job diagnostics distinguish live and dead work | Replay dead job | `src/debug/index.ts`, `src/reliability/store.ts` | Draft |
| REQ-009 Durable yielded runs are inspectable | Inspect completed yielded run | `src/debug/index.ts`, `src/reliability/store.ts` | Draft |
| REQ-010 Live signals require explicit gateway URL | Missing gateway URL | `src/debug/index.ts` | Draft |
| REQ-011 Telemetry diagnostics are summary-first and read-oriented | Agent drills down from a stuck session; prune is deliberate | `src/debug/*`, future telemetry service | Draft |

## Operational Examples

Telemetry playbooks live in `docs/project/observability-telemetry-playbooks.md`. Start with bounded summary commands:

```text
pibo debug telemetry session <pibo-session-id> --json
pibo debug telemetry turn <turn-id> --json
pibo debug telemetry provider <provider-request-id> events --limit 20 --json
pibo debug telemetry tool <tool-call-id> --json
```

For retention work, inspect stats first and run prune without `--apply` before any destructive cleanup:

```text
pibo debug telemetry stats
pibo debug telemetry prune --retention provider_event --before <iso-date>
```

The final rollout checklist lives in `docs/project/observability-telemetry-rollout-verification.md`.

## Verification Basis

- `npm test -- --test-name-pattern "debug"` or the project-equivalent filtered test command for `test/debug-cli.test.mjs`.
- Manual CLI checks against a fixture Pibo home: `pibo debug db stores`, `pibo debug session <id> --json`, `pibo debug trace <id> --check`, and `pibo debug events stream --topic pibo.output`.
- Telemetry CLI fixture checks: `pibo debug telemetry session <id> --json`, `pibo debug telemetry turn <turn-id>`, `pibo debug telemetry provider <provider-request-id> events --limit 20`, `pibo debug telemetry tool <tool-call-id> --json`, `pibo debug telemetry stats`, and `pibo debug telemetry prune --retention diagnostic --before <iso-date> --dry-run`.
