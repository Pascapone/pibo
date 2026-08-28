# Session CLI steering validation — 2026-08-24

## Review target

PR #485 was rebuilt semantically from old head `90cf88f47aa46b4c233dfbad0c133bff58d832da` onto exact `upstream/dev` base `44e37e79a2a250e090e2151c3cf1de910c5fcddf` in isolated Docker dev worker `pibo-dev-pr485-review-repair-20260824`.

The resulting six-file change keeps the original delivery feature while repairing the independent review findings:

- plain messages queue as before;
- `/queue <message>` queues explicitly;
- `/steer <message>` steers the active turn;
- normal whitespace separators, including tabs, are accepted;
- each request preserves or receives a stable event id;
- the client establishes and verifies a server-side session subscription before accepting input;
- interactive prompts appear only under a real TTY;
- piped EOF does not cut off accepted assistant work;
- expected transport and protocol failures are compact and do not emit Node stack traces.

## Pipe and streaming contract

The existing output and signal forms are sufficient for a real streaming contract, so the implementation does not fall back to a delivery-only pipe contract.

For default and explicit queue delivery, the generated message event id correlates the accepted request with terminal `message_finished` or `session_error` output. For steering delivery, the successful `message_steered` acknowledgement supplies `activeEventId`; that active turn id correlates the continued assistant stream and its terminal `message_finished` or `session_error` output.

The signal projector confirms the same lifecycle model:

- accepted and started messages create `turn:<piboSessionId>:<eventId>` signal nodes;
- `message_steered.activeEventId` attaches the steering message to the active turn;
- `message_finished` terminalizes that turn as done;
- `session_error` terminalizes it as failed.

Piped input therefore follows this deterministic sequence:

1. Subscribe to the requested Pibo Session and verify the subscription acknowledgement.
2. Send every non-empty input line with stable request and event identity.
3. After EOF, wait up to five seconds for every request acknowledgement.
4. For every accepted message, continue rendering assistant output and wait up to 120 seconds for its correlated terminal event.
5. Preserve terminal events that arrive before their request acknowledgement and settle them once acknowledgement correlation is known.
6. Exit non-zero after local input failures, rejected acknowledgements, malformed steering acknowledgements, or correlated session errors.

Execution commands such as `/status` wait for their acknowledgements but do not invent a turn-completion requirement.

## Compatibility decision

The old PR head globally tightened the unversioned gateway request validator by rejecting blank request ids, blank event ids, whitespace-only messages, and unknown delivery values. That would unexpectedly reject frames accepted from older clients.

The rebuilt change does not alter that wire-level acceptance behavior. Strict validation remains local to `pibo client`:

- the Pibo Session id and gateway host must be non-empty after trimming;
- the port must be an integer from 1 through 65535;
- `/queue` and `/steer` require non-empty message text;
- the client itself emits only `queue` or `steer` delivery values.

A focused compatibility test proves that the global gateway validator remains permissive for a legacy-shaped message while the CLI tests prove stricter local rejection.

## Error contract

Expected client failures are represented as gateway-client expected errors and are caught at the CLI command boundary. The CLI prints one compact `error: ...` line and exits with status 1 instead of exposing an unhandled top-level rejection or Node stack trace.

Covered failures include:

- connection failure;
- subscription rejection, mismatch, timeout, or premature close;
- rejected request acknowledgement;
- successful steering acknowledgement without an active-turn id;
- acknowledgement timeout after piped EOF;
- connection close before pending acknowledgements or terminal turns finish;
- correlated session error.

## Security boundary

`--host` and `--port` continue to allow deterministic local or remote endpoints. Help and runtime guidance explicitly state that raw gateway TCP is unauthenticated and unencrypted and that remote hosts are appropriate only on trusted networks or through a secure tunnel. The client does not impose a loopback-only prohibition.

## Verification

### Build and type safety

- `npm run typecheck` in the Docker worker — passed after the implementation fix.
- `npm run build` in the Docker worker — passed.
- The earlier yielded typecheck process ended with `SIGKILL`; the successful direct worker repetition establishes that as harness infrastructure rather than a remaining validation result.

### Focused tests

Command:

```text
node --test test/gateway-client.test.mjs test/gateway-request.test.mjs
```

Result: 26 passed, 0 failed.

The focused client coverage includes root discovery/help, local argument validation, queue defaults, whitespace-aware delivery parsing, empty-command rejection, event identity, session subscription framing, legacy wire compatibility, three-line pipe delivery, acknowledgement-before-streaming, terminal-before-acknowledgement, rejected acknowledgement, correlated session error, subscription rejection, malformed steering acknowledgement, premature close, timeout, stdout/stderr separation, prompt suppression, stack-trace suppression, and exit codes.

### Broad relevant tests

Command:

```text
node --test --test-concurrency=1 test/gateway-*.test.mjs test/routed-steering.test.mjs test/session-router-store.test.mjs test/chat-web-app-sessions.test.mjs
```

Result: 97 passed, 0 failed across four suites.

The serial file-level execution is intentional. An exploratory parallel multi-file invocation triggered post-test database activity in the Chat Web disposal file. The exact base file passed 8/8 alone, the two queue/steer Chat Web cases passed 2/2 directly, and the final complete relevant serial command passed 97/97.

### Pipe process validation

The built CLI was spawned with real piped stdin against deterministic TCP fixtures. The primary fixture acknowledged all requests before emitting assistant output and received these three lines before EOF:

```text
/steer<TAB>change the active approach
/queue follow up afterward
plain default queue
```

Observed behavior:

- the session subscription was the first frame;
- all three messages arrived without loss;
- every request id matched its generated event id;
- the successful steering acknowledgement supplied `active-turn-1`;
- the process remained alive after all acknowledgements;
- streamed output for the steered turn and both queued turns reached stdout;
- the process exited only after all three terminal events and returned status 0;
- no `you>` prompt appeared in piped stdout or stderr.

Separate process fixtures proved terminal-before-acknowledgement success and status-1 behavior for rejected acknowledgement, correlated session error, subscription rejection, malformed steering acknowledgement, premature close, and acknowledgement timeout. Expected failures contained no Node stack trace.

### Real PTY validation

The built CLI was run through `pibo debug pty scenario` under a real pseudo-terminal with a deterministic gateway fixture.

Result:

```text
PTY passed: session-cli-steering-pr485
backend host
exitCode 0
stopReason completed
```

Cleaned PTY output proved:

```text
fixture subscription ps_running
fixture received steer eventMatch=true
steer: delivered to active turn active-turn-1
steered response
fixture received queue eventMatch=true
assistant> queued response
```

The scenario also proved that `you>` prompts are present under a PTY, tab-separated steering is parsed correctly, explicit queue delivery remains interactive, and `/quit` exits cleanly.

## Boundaries

Validation was local-only in the isolated Docker worker. No Pibo2 deployment, controller-host gateway change, production deployment, live-session steering, merge, or release was performed.
