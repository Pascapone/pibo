# Codex App Server stdio Client Validation — 2026-08-15

**Status:** Pass — task 9.2 complete

**Branch:** `feature/agent-runtime-codex-client`

**Implementation commit:** `30509335`

**Stacked on:** protocol checkpoint PR #489 at `51005210`

**Protocol:** official Codex App Server `0.147.0`, stable stdio JSONL, supported range `>=0.147.0 <0.148.0`

## Outcome

Pibo now has an adapter-private, typed Codex App Server stdio client. It uses newline-delimited JSON messages from the official protocol and never parses terminal/TUI output. The client performs one `initialize` request, sends one `initialized` notification, omits the wire-level `jsonrpc` header as required by the official protocol, correlates concurrent requests, handles server notifications and server-initiated requests, honors write backpressure, bounds protocol resources, redacts stderr diagnostics, retries official overload errors with a bounded policy, and shuts down owned processes within configured limits.

This milestone does not register a runtime driver, create Codex threads, send model turns, add a profile, or claim native-Codex product behavior. Those remain tasks 9.3 and later.

## Implemented surface

### Adapter-private protocol projection

`src/agent-runtimes/codex-native/protocol-types.ts` defines only the stable wire primitives required by the client:

- JSON values and string/integer request ids;
- client metadata and stable initialize capabilities;
- initialize request/response;
- client request/notification envelopes;
- server response/error envelopes;
- server request/notification envelopes.

The complete generated full/v2 schemas remain authoritative and unchanged. These compact types do not leak Codex protocol types into Pibo's generic runtime SPI.

### Process and handshake

`CodexAppServerClient.start()`:

1. validates all resource limits before spawning;
2. starts one owned child process with piped stdin/stdout/stderr;
3. waits for process spawn within the startup deadline;
4. sends exactly one `initialize` request;
5. defaults `experimentalApi` explicitly to `false`;
6. validates the required stable initialize response fields;
7. sends exactly one `initialized` notification;
8. returns only after the handshake write settles.

Public calls cannot repeat `initialize` or `initialized`.

### Request and event flow

- Monotonic request ids are correlated independently of response order.
- Concurrent requests resolve to their matching response.
- Request timeouts and caller abort signals remove pending entries.
- A configurable pending-request limit rejects overload before another write begins.
- Notifications are delivered through bounded listener sets.
- Server-initiated requests are handled through one explicit handler and receive either a result or JSON-RPC error response.
- Unknown/expired response ids produce a bounded, redacted warning rather than crashing the process.

### Backpressure and limits

Default bounds are:

| Resource | Default |
|---|---:|
| Startup timeout | 10,000 ms |
| Request timeout | 120,000 ms |
| Graceful shutdown timeout | 2,000 ms |
| Forced-kill wait | 500 ms |
| Inbound/outbound JSON message | 8 MiB |
| Pending requests | 128 |
| Captured stderr | 64 KiB |
| Stored diagnostics | 50 |

Writes are serialized. When Node reports a full stdin buffer, the client waits for `drain` before the next write. Closing changes state before queued writes execute, rejects pending callers, ends stdin without waiting indefinitely on a blocked write, then escalates from EOF to `SIGTERM` and finally `SIGKILL` within bounded waits.

Official overload error `-32001` is retried with bounded exponential backoff and jitter. Defaults allow three retries with delays starting at 100 ms and capped at 2,000 ms; all retries remain inside the caller's total request deadline.

### Failure and redaction behavior

Malformed JSON, non-object messages, invalid ids, invalid response envelopes, malformed RPC errors, and oversized messages fail the client and terminate the owned process. Spawn errors, process crashes, write failures, timeouts, aborts, and pending-limit errors use explicit client error codes.

Stderr is captured only up to the configured byte limit. Diagnostic access redacts bearer values, common token/key assignments, API-key-shaped values, and JWT-shaped values. Protocol parse failures never include the raw offending line.

## Deterministic tests

`test/fixtures/codex-app-server-fake.mjs` is a real child process speaking newline-delimited protocol messages. It covers:

- initialize/initialized ordering and explicit non-experimental capability negotiation;
- absence of the wire-level `jsonrpc` header;
- out-of-order response correlation;
- server notifications;
- server-initiated request/response flow;
- bounded `-32001` overload retries and exhaustion;
- pending limits, timeout, and abort;
- malformed JSON;
- inbound and outbound message-size rejection;
- actual pipe backpressure with ordered completion;
- stderr capture and redaction;
- process crash;
- spawn and malformed-initialize failure;
- bounded shutdown while a write is backpressured;
- idempotent forced shutdown when the child ignores EOF and `SIGTERM`.

Focused result:

- protocol/client tests: **15/15 passed**;
- client-only suite repeated five times: **5/5 runs passed**.

## Full repository verification

Final committed-source verification:

- full workspace typecheck: passed;
- full build: passed;
- full suite: **1,675/1,675 passed across 12 suites**;
- `git diff --check`: passed.

An earlier isolated yielded run was discarded after Chat UI TypeScript exceeded that runner's approximately 640-MB V8 heap limit. The same typecheck passed with the repository's explicit 1.2-GB heap setting, and the final full suite passed from the stable source tree. The resource-limited attempt is not counted as validation evidence.

## Exact Pibo2 App Server handshake

The compiled client was also exercised against the exact installed Pibo2 binary through its real stdio stream:

- binary reported `codex-cli 0.147.0`;
- isolated private `CODEX_HOME` was created solely for the handshake;
- `initialize` and `initialized` succeeded;
- returned user-agent version matched `0.147.0`;
- platform reported Linux;
- stable `model/list` returned an array through normal request correlation;
- `experimentalApi` remained `false`;
- no login and no model turn were attempted;
- graceful close completed;
- the isolated home, containing 16 generated files, was removed;
- zero matching isolated homes and zero Codex processes remained afterward.

No credential value or existing target auth storage was read, copied, injected, or reported during this handshake.

## Boundary decision

Task 9.2 passes. Task 9.3 may build process/version diagnostics and private per-instance/session homes on this client. Runtime registration, threads, turns, event normalization, approvals, resources, profiles, and integrated model validation remain explicitly outside this commit.
