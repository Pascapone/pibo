# Agent Runtime History and Debug

**Updated:** 2026-08-15

## Product-history ownership

Pibo product history is the normal source for Chat Web and local trace reconstruction. For every Pibo-routed turn, Pibo persists:

- accepted user and terminal assistant messages in `chat_messages`;
- normalized lifecycle, reasoning, tool, execution, compaction, and error events in `event_log`;
- large message and event bodies in `PayloadStore`.

`ChatHistoryQueryService` reads durable messages and hydrates externalized content. `ChatTimelineQueryService` hydrates externalized terminal events. The generic trace engine consumes only `AgentRuntimeHistoryEntry` values and normalized Pibo events; it does not import Pi or Codex packages.

A harness-native transcript or thread remains adapter-owned resume state. It is not the primary mutable product-history store.

## Adapter history provider

A runtime adapter that declares `capabilities.maintenance.history = true` must implement both methods:

- `inspectHistory(input)` returns availability, safe metadata, version, adapter-scoped locator, and diagnostics.
- `readHistory(input)` returns normalized native entries, `hasMore`, and an opaque provider cursor.

The registry rejects a configured instance that declares history without both methods. Product code passes the frozen `RuntimeSessionBinding` and workspace to the selected adapter. It does not infer a transcript path or branch on an adapter id.

Pi implements this contract in `src/agent-runtimes/pi/history.ts`. That module owns JSONL discovery, bounded reads, parsing, pagination, and conversion to normalized history entries.

## Chat Web source selection

Fresh sessions use product history for trace summary, timeline, compatibility trace, trace-at-sequence, and local CLI reconstruction. Normal requests do not inspect or read native history.

Native compatibility history is requested only when:

- the binding was marked by the schema-v5 migration as predating complete product history;
- the session is derived through a native fork/origin path;
- an older timeline page transitions to a runtime-history cursor; or
- an operator explicitly requests native history in debug tooling.

Runtime-history cursors wrap the opaque provider cursor with the Pibo Session id, configured runtime instance id, and adapter id. Chat Web rejects a cursor used against a different session or binding.

If native history is missing, Pibo keeps the Pibo Session and renders any surviving product history/events. The adapter reports a missing-history diagnostic and never creates a replacement native conversation.

## Schema-v5 migration and rollback

Opening an existing database with schema version below 5 adds `nativeHistoryFallback: true` and `historyMigrationSource: "schema-v5"` to each pre-existing runtime binding's metadata. The migration does not change:

- `PiboSession.id`;
- deprecated compatibility `pi_session_id` values;
- native session ids;
- transcript files or paths;
- binding revisions.

Sessions created after schema v5 do not receive the compatibility marker. Reapplying schema v5 is idempotent.

Rollback to a schema-v4 binary leaves additive metadata intact. Older binaries ignore the extra metadata keys. Product messages/events/payloads remain readable, but the older binary resumes its previous Pi-specific trace behavior. Back up `pibo.sqlite` and the payload directory before any operator-directed destructive rollback.

## Debug workflow

Start runtime-neutral:

```text
pibo debug session <ps_...> runtime
pibo debug trace <ps_...> --check
pibo debug messages <ps_...> list
pibo debug events <ps_...> --limit 20
```

Ask the frozen adapter for native history only when needed:

```text
pibo debug trace <ps_...> --native-history --check
```

Session-scoped message, event, tool, failure, trace, summary, and telemetry detail outputs include runtime instance, adapter, native session id where useful, and binding state. `session runtime` reports bounded product-history counts and sanitized binding fields.

Debug output must not expose runtime config, locator values, binding metadata values, bearer credentials, cookies, environment secrets, or raw provider bodies. Externalized payloads are hydrated for explicitly requested full message/event/tool inspection; default text remains byte-bounded.
