# Lifecycle, Bindings, and Events

Use this reference for native session creation/resume, persisted binding transitions, process ownership, event normalization, approvals, user input, abort, and cleanup.

## Identity model

Keep these identities separate:

- **Pibo Session id** — stable `ps_...` product routing identity.
- **Runtime instance id** — configured adapter instance selected and frozen for the Pibo Session.
- **Adapter id** — harness integration type.
- **Native session/thread id** — optional opaque harness id, unique within the adapter scope.
- **Runtime session generation** — one live router lifecycle used for tool credentials and generated resources.
- **Turn/message/tool ids** — per-operation correlation identities.

Never route product APIs by a native id. Never assume a native id is a filesystem path.

## Binding shape

`RuntimeSessionBinding` contains:

- `piboSessionId`;
- `runtimeInstanceId`;
- `adapterId`;
- optional `nativeSessionId`;
- state `unbound | bound | missing | error`;
- optional protocol, protocol version, adapter version;
- optional adapter-resolved locator and metadata;
- revision and timestamps when persisted.

Locator and metadata values are adapter/internal data. Product inspection should expose only safe fields, locator kind where explicitly needed, and metadata key names.

## Binding states

### `unbound`

The Pibo Session is frozen to a runtime instance, but no durable native conversation is established. Use this for lazy native creation or harnesses without a durable native id.

A live session contract rejects an `unbound` binding that exposes a native id.

### `bound`

A native conversation exists and must use the recorded id. A bound binding requires `nativeSessionId`.

On resume, open that exact native state. Do not silently create a replacement if it is missing.

### `missing`

The binding expects native state, but the adapter cannot find or attach to it. Keep the Pibo Session and product history visible. Return a diagnostic and require explicit repair/rebind decisions.

### `error`

The native binding exists or was being established, but the adapter encountered a persistent binding/protocol error. Preserve diagnostic evidence without leaking secrets.

## Transition and CAS rules

Use the store's revisioned transition helpers:

- initial bindings start at revision 1;
- `unbound -> bound` requires the expected revision;
- changing runtime instance or adapter requires `rebind` mode;
- `missing/error -> bound` requires `repair` or `rebind` mode;
- `bound -> unbound` requires `rebind` mode;
- changing a bound native id requires `rebind` mode;
- `bound` and `missing` require a native id.

The adapter session returns its current binding through `getBinding()`. The router/store owns persistence and conflict handling. Do not let two concurrent native creations overwrite each other.

## Open/resume algorithm

A persistent adapter should follow this shape:

1. Receive the frozen binding and workspace in `openSession()`.
2. Validate binding adapter/instance identity.
3. If `bound`, verify and resume the exact native id.
4. If expected native state is absent, report `missing`; do not create a new native conversation.
5. If `unbound` and lazy binding is supported, create native state at the documented point, usually open or first prompt.
6. Produce the updated binding with protocol/version/locator metadata.
7. Let the router persist it with the expected revision.
8. Subscribe to native events only after correlation and cleanup structures exist.
9. Return a session whose `getBinding()` always reflects current live state.

For an empty native artifact that the harness legitimately deletes, distinguish disposable reservation state from durable conversation history. Do not mark it permanently expected until the harness has meaningful native history.

## Restart behavior

After gateway restart:

- configured instances are recreated from operator config;
- Pibo reloads the persisted binding;
- the adapter resumes the same native id when supported;
- generated tool/resource sessions receive a new live generation;
- old credentials and generated directories are invalid/removed;
- product history remains available even if native state is missing.

Prove restart behavior using the exact installed package and real server path. Queue acceptance or an auth failure is not proof of resumed model behavior.

## Adapter-owned process/client lifecycle

For process-backed adapters:

- spawn one process per adapter or session only when the protocol supports that ownership model;
- keep stdout protocol and stderr diagnostics separate;
- bound startup time and initialize handshake;
- correlate every request/response id;
- serialize or backpressure writes;
- bound message sizes and pending requests;
- reject malformed notifications safely;
- handle process exit and protocol EOF exactly once;
- terminate child processes on failed startup, abort escalation, disposal, and gateway shutdown;
- avoid killing another session's shared process;
- remove listeners/timers and settle pending promises on shutdown.

Do not parse a human TUI stream as a protocol when an official app server exists.

## Semantic event normalization

Map native protocol notifications into `AgentRuntimeSemanticEvent` values:

- turn lifecycle: `turn_started`, `turn_completed`, `turn_failed`;
- adapter lifecycle: `starting`, `ready`, `restarting`, `stopped`, `crashed`;
- assistant: `assistant_delta`, `assistant_message`;
- reasoning: `reasoning_started`, `reasoning_delta`, `reasoning_finished`;
- tools: call, execution start/update/finish;
- usage, plans, diffs;
- compaction start/end;
- approval and structured user-input requests;
- warnings/errors;
- optional redacted `native_event` diagnostics.

Preserve stable turn, content-index, tool-call, request, and native-entry identities. The routed session uses them to avoid duplicate output, nest trace nodes, persist product history, and route responses.

## Event ordering rules

- Emit `turn_started` before turn-scoped assistant/reasoning/tool events.
- Emit one terminal `turn_completed` or `turn_failed` per accepted turn.
- Keep assistant content indexes stable across deltas and final content.
- Keep tool call ids stable across call/start/update/finish.
- Do not emit a successful turn completion after a terminal failure.
- Do not include credentials or unredacted provider bodies in `native_event`.
- Treat duplicate, late, or post-disposal native events deterministically.

Use deterministic protocol fixtures for out-of-order, duplicate, malformed, crash, and partial-stream cases.

## Prompt and steering

`prompt()` accepts `AgentRuntimePromptInput` with text, source, and optional capability scope. Set streaming state before sending the native request and settle it after the terminal event.

Advertise `input.steering` only when the harness can modify an active turn through a supported operation. Implement `steer()` with the same correlation and cancellation rules. Queuing a second normal turn is not steering.

## Approvals and structured user input

When the harness requests approval:

1. emit `approval_requested` with a stable request id and bounded arguments;
2. set `pendingApproval`;
3. expose `respondToApproval()` only when the capability is true;
4. validate decisions against the native protocol;
5. clear pending state exactly once after response/cancellation/failure.

For structured input, preserve question ids, options, multi-select/freeform semantics, and request identity. Do not flatten a structured request into an uncorrelated chat message if the protocol expects a response method.

## Errors

Normalize errors by layer:

- registration/config errors before instance creation;
- availability/profile diagnostics during inspection;
- binding missing/errors during open/resolve;
- protocol/startup errors during live creation;
- turn failures as semantic terminal events;
- capability-unavailable errors for unsupported controls.

Redact tokens, cookies, authorization headers, environment values, generated config contents, local locators, and raw provider request bodies. Preserve safe codes, phase, correlation id, exit status, and bounded stderr summaries.

## Abort and disposal

`abort()` cancels active work without disposing the reusable session when the harness supports it. It should be safe when idle.

`dispose()` ends the live generation:

- unsubscribe native listeners;
- reject/settle pending requests;
- abort active turns as required;
- close native session/client/process according to ownership;
- revoke Pibo tool MCP credentials;
- dispose Pibo runtime resources;
- remove generated files;
- clear timers/maps;
- emit no later product events;
- succeed when called again.

Test abort and dispose separately. Process death may implement abort only if the process is session-owned and the resulting native-session semantics are explicit.
