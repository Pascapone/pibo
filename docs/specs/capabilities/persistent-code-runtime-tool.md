# Spec: Persistent Code Runtime Tool

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage; current workspace code
**Related docs:** [Yielded Run Control](./yielded-run-control.md), [Plugin Registry and Capability Catalog](./plugin-registry-and-capability-catalog.md), [Runtime Prompt and Compaction Configuration](./runtime-prompt-and-compaction.md)

## Why

Agents often need to run exploratory Python or Node code, inspect live objects, and continue from partial failures without losing state. Shell commands are good for process-level work, but they force agents to rebuild interpreter state for each snippet and can waste context with repeated setup.

Pibo exposes a profile-selectable `runtime` native tool that starts persistent Python or Node worker sessions managed by the current Pibo Session. The behavior must stay predictable, app-spaced, bounded by timeouts, and safe to use with yielded-run control.

## Goal

Pibo MUST provide a profile-gated `runtime` tool for persistent Python and Node execution, inspection, variable listing, interruption, and session listing without leaking runtime state across Pibo Sessions.

## Background / Current State

The core plugin registers a native tool profile named `runtime` with `builtInPiboTool: "runtime"`. Runtime creation only materializes the Pi tool definition when the selected profile enables that tool and a runtime-tool controller is available.

A `RuntimeSessionRegistry` owns in-memory runtime worker sessions. Each session has an controller Pibo Session ID, runtime kind, current working directory, process metadata, status, execution count, and bounded history. If no controller is supplied and the profile enables the runtime tool, `createPiboRuntime` creates a local registry and closes controller sessions when the Pi session is disposed.

Worker backends currently support local Python (`python3`) and Node (`node`) subprocesses. Declared `docker` and `ssh` targets are accepted by the input type but return an unsupported-target error.

## Scope

### In Scope

- The `runtime` native tool as exposed to agent profiles.
- Python and Node local worker behavior.
- Runtime session stewardship, default session selection, listing, interruption, and cleanup.
- Tool-result status and formatting semantics that agents observe.
- Interaction with run-control as a yieldable tool.

### Out of Scope

- Remote Docker or SSH runtime targets — the current implementation rejects them as unsupported.
- Durable runtime session recovery after gateway restart — runtime sessions are in-memory process state.
- Package installation inside runtime workers — agents must use shell/package tools for dependency management.
- Language runtimes other than Python and Node.

## Requirements

### Requirement: Runtime tool activation is profile-gated

The system MUST expose the `runtime` Pi tool only when the active profile includes the Pibo runtime tool and the runtime can create or receive a controller.

#### Current

`pibo.core` registers the `runtime` native tool profile. `createPiboRuntime` detects enabled runtime tool profiles, creates the tool definition with `createRuntimeToolDefinition`, and includes generated runtime tools in profile inspection.

#### Target

Profiles that select `runtime` get an active `runtime` tool. Profiles that omit it do not receive an accidental interpreter tool.

#### Acceptance

- Inspecting a profile with the runtime tool reports `runtime` as registered and active.
- Inspecting a profile without the runtime tool does not report an active generated runtime tool.
- The capability catalog lists `runtime` as a Pibo core native tool.

#### Scenario: Codex-compatible profile includes runtime

- GIVEN the default plugin registry creates the `codex` profile
- WHEN profile inspection runs
- THEN `runtime` appears as a registered, active tool with a generated definition

### Requirement: Exec auto-starts an app-spaced default session

The tool MUST start a default runtime session for the controller when `exec` is called without a `sessionId`, and subsequent default calls of the same runtime kind MUST reuse the live managed session.

#### Current

`RuntimeSessionRegistry.exec` calls `getOrStartDefault` when no `sessionId` is provided. Defaults are keyed by controller Pibo Session ID and runtime kind.

#### Target

Agents can begin with one `exec` call and keep state across later calls without manually starting or naming a session.

#### Acceptance

- A first Python `exec` without `sessionId` returns `status: ok`, a `sessionId`, and `runtime: python` unless startup fails.
- A later Python `exec` by the same controller can read variables created by the first call.
- A different controller cannot read or list that session.

#### Scenario: Preserve Python variable

- GIVEN controller `A` calls `runtime.exec` with Python code `x = 1`
- WHEN controller `A` calls `runtime.exec` again with Python code that evaluates `x + 1`
- THEN the result summary represents `2`
- AND controller `B` receives `not_found` when using controller `A`'s `sessionId`

### Requirement: Runtime sessions preserve state after code errors

The system MUST report code-level errors without closing the worker or discarding prior successful state.

#### Current

Python and Node workers return `status: error` for language exceptions. The registry marks a session failed only when the backend process is no longer alive.

#### Target

An exception in user code should be recoverable. Agents can inspect or continue using values assigned before the failure, unless the process exited or was closed.

#### Acceptance

- Code that assigns a value and then raises an exception returns `status: error` and an error summary.
- A later `exec` in the same session can access values assigned before the exception.
- `closeOnSuccess: true` does not close a session after an error.

#### Scenario: Node exception keeps prior state

- GIVEN a Node runtime session
- WHEN code sets `globalThis.x = 1` and then throws an error
- THEN the result status is `error`
- AND a later exec can evaluate `x`
- AND the session remains listed for the same controller

### Requirement: Outputs and value summaries are separated and bounded by action results

The tool MUST return stdout, stderr, result summaries, and error summaries in separate fields and in the formatted text response.

#### Current

Backends capture stdout and stderr separately. Worker value inspection produces summaries such as type, repr, length, keys, shape, columns, or preview. `formatRuntimeResult` renders status, metadata, output streams, summaries, variables, inspection fields, and errors.

#### Target

Agents can distinguish printed output from return values and failures without parsing mixed streams.

#### Acceptance

- Code that writes to stdout and stderr returns both streams separately.
- Successful expression-like snippets return a `result` summary when the worker can derive one.
- Tool calls with non-`ok` statuses are marked as errors to the Pi tool layer.

#### Scenario: Separate Python streams

- GIVEN a Python runtime session
- WHEN code prints `out` to stdout and `err` to stderr
- THEN the exec result includes `stdout: "out\n"`
- AND includes `stderr: "err\n"`
- AND does not merge either stream into the value summary

### Requirement: Worker protocol isolates control frames from user streams

The system MUST keep backend request/response protocol frames parseable while capturing user stdout and stderr as result fields.

#### Current

Python workers redirect user stdout and stderr while executing user code, then write one JSON response line to the worker protocol stream. Node workers run user code in a VM context with proxied `console`, `process.stdout.write`, and `process.stderr.write` so user output is appended to the current action result instead of corrupting protocol JSON.

#### Target

Agents can print arbitrary normal text from Python or Node snippets without breaking the runtime session protocol, and protocol errors are reported as runtime errors rather than mixed into user output.

#### Acceptance

- Python `print` and `sys.stderr` writes appear in `stdout` and `stderr` result fields.
- Node `console.log`, `console.error`, `process.stdout.write`, and `process.stderr.write` appear in `stdout` and `stderr` result fields.
- User output does not appear as standalone protocol lines consumed by the backend controller.
- Unknown worker request types return a structured `RuntimeProtocolError` response.
- Worker readiness is reported with a ready control frame before normal requests are accepted.

#### Scenario: Node output does not corrupt protocol

- GIVEN a Node runtime session
- WHEN code writes JSON-looking text to `console.log` and `process.stdout.write`
- THEN the exec result contains that text in `stdout`
- AND the controller still receives one response for the exec request.

### Requirement: Inspect and vars read live runtime state without executing new user code blocks

The tool MUST support `inspect` and `vars` actions for the selected managed runtime session.

#### Current

`inspect` evaluates an expression through the worker inspection protocol and can request `summary`, `signature`, `members`, `source`, `doc`, or `all`. `vars` lists visible variables, excludes private names by default, supports `includePrivate`, `maxItems`, and `maxBytes`, and reports truncation.

#### Target

Agents can examine live state before deciding what to run next.

#### Acceptance

- `vars` omits private variables by default.
- `inspect` of a function can return its signature when supported by the backend.
- Missing or cross-controller sessions return `not_found` for inspect and vars.

#### Scenario: Inspect Python function

- GIVEN a Python session defines `def f(a, b=1): return a + b`
- WHEN the controller inspects expression `f` with `what: signature`
- THEN the response status is `ok`
- AND the signature is `(a, b=1)`

### Requirement: Busy, timeout, interruption, and not-found states are explicit

The system MUST expose operational states as explicit result statuses instead of hiding them in generic text.

#### Current

The registry rejects concurrent exec on a busy session with `RuntimeBusy`. Backend requests return `timeout` when they exceed the action timeout. `interrupt` sends `SIGINT` to a live worker. Closed, failed, missing, or cross-controller sessions return `not_found`.

#### Target

Agents can choose whether to wait, interrupt, retry, or start a new session based on structured status.

#### Acceptance

- A second exec against a busy session returns `status: failed` with `RuntimeBusy`.
- An action timeout returns `status: timeout` for exec.
- Interrupting a live session returns `status: ok` with a message.
- Actions against closed or unmanaged sessions return `not_found`.

#### Scenario: Exec timeout is not a silent success

- GIVEN an managed runtime session
- WHEN an exec request exceeds its `timeoutMs`
- THEN the result status is `timeout`
- AND the error summary names the timeout condition

### Requirement: Session cleanup is explicit and automatic on runtime disposal

The system MUST close sessions on explicit close requests and MUST force-close locally managed runtime-tool sessions when the owning Pi session is disposed.

#### Current

`RuntimeSessionRegistry.close` sends shutdown or a force kill and removes the session record on success. `createPiboRuntime` wraps Pi session disposal to close controller runtime sessions when it created the local registry.

#### Target

Runtime subprocesses do not remain indefinitely after the owning agent session ends.

#### Acceptance

- `close` returns `closed: true` and removes the session from `list`.
- `closeOnSuccess: true` closes only after an `ok` exec result and sets `autoClosed: true`.
- Disposing a runtime that owns a local registry force-closes all sessions managed by that profile session ID.
- Idle pruning may close idle sessions after the configured timeout.

#### Scenario: closeOnSuccess removes session

- GIVEN an managed runtime session with variable `y = 2`
- WHEN exec evaluates `y + 1` with `closeOnSuccess: true`
- THEN the result is `ok` and `autoClosed: true`
- AND listing sessions for that controller no longer includes the session

### Requirement: Unsupported targets fail before worker startup

The system MUST reject runtime targets that the implementation does not support.

#### Current

The tool validates `target.type` as `local`, `docker`, or `ssh`, but `RuntimeSessionRegistry.start` returns `status: error` for non-local targets because they are not implemented.

#### Target

Agents see an explicit unsupported-target result instead of a partial or misleading remote execution attempt.

#### Acceptance

- `target.type: "local"` may start a local worker.
- `target.type: "docker"` returns an unsupported target error.
- `target.type: "ssh"` returns an unsupported target error.
- Invalid target shapes fail validation before controller execution.

#### Scenario: Docker target requested

- GIVEN an agent calls `runtime.exec` with `target.type: "docker"`
- WHEN the registry attempts to auto-start the session
- THEN the start result reports `UnsupportedRuntimeTarget`
- AND no local worker session is created for that request

## Edge Cases

- Worker startup can fail when `python3`, `node`, or a custom executable is missing.
- A worker that writes invalid protocol JSON is treated as failed and pending requests are rejected.
- User code that prints JSON-looking or newline-delimited text must be captured as output, not interpreted as backend protocol.
- An interrupt can kill or destabilize the worker; later exec may return `not_found` or `failed` if the backend exits.
- `list` only returns sessions managed by the current Pibo Session.
- Runtime history is retained only in memory and capped by `maxHistoryEntries`.

## Constraints

- **Compatibility:** The public tool name remains `runtime`, and existing action names remain `exec`, `inspect`, `vars`, `interrupt`, and `list`.
- **Security / Privacy:** Runtime state is scoped by controller Pibo Session ID. The tool executes arbitrary local code with the gateway process environment, so profile selection is the safety boundary.
- **Performance:** Default startup timeout is 10 seconds. Default exec timeout is 30 seconds. Inspect and vars use 15-second backend request timeouts.
- **Dependencies:** Local Python requires `python3` by default. Local Node requires `node` by default.

## Success Criteria

- [ ] SC-001: Profile inspection shows `runtime` active only for profiles that select it.
- [ ] SC-002: Python and Node sessions preserve variables across successful exec calls.
- [ ] SC-003: Python and Node language errors keep prior state and do not trigger `closeOnSuccess`.
- [ ] SC-004: Controller isolation prevents one Pibo Session from listing or using another session's runtime workers.
- [ ] SC-005: `stdout`, `stderr`, value summaries, and error summaries remain separate in tool details.
- [ ] SC-006: Worker protocol frames remain isolated from user stdout/stderr for Python and Node workers.
- [ ] SC-007: Explicit close and `closeOnSuccess` remove sessions from controller listings.
- [ ] SC-008: Unsupported `docker` and `ssh` targets return explicit unsupported-target errors.

## Assumptions and Open Questions

### Assumptions

- The current in-memory registry is intentional; durable recovery is not part of the runtime tool contract.
- The owning Pibo Session ID is the correct security boundary for runtime sessions, matching run-control stewardship behavior.
- Agents should prefer this tool over shell only for Python/Node snippets where persistence or inspection helps.

### Open Questions

- Should `close` become a public tool action? The controller supports it, but the current tool action schema exposes no `close` action.
- Should remote Docker/SSH targets remain in the input type before implementation, or should they be hidden until supported?
- Should runtime execution inherit the full gateway environment, or should profiles be able to request a reduced environment?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Runtime tool activation is profile-gated | Codex-compatible profile includes runtime | Existing implementation | Implemented |
| REQ-002 Exec auto-starts an app-spaced default session | Preserve Python variable | Existing implementation | Implemented |
| REQ-003 Runtime sessions preserve state after code errors | Node exception keeps prior state | Existing implementation | Implemented |
| REQ-004 Outputs and value summaries are separated | Separate Python streams | `src/tools/runtime/python-worker-source.ts`, `src/tools/runtime/node-worker-source.ts`, `test/runtime-tool.test.mjs` | Runtime-tested |
| REQ-005 Worker protocol isolates control frames from user streams | Node output does not corrupt protocol | `src/tools/runtime/python-worker-source.ts`, `src/tools/runtime/node-worker-source.ts`, `src/tools/runtime/python-backend.ts`, `src/tools/runtime/node-backend.ts`, `test/runtime-tool.test.mjs` | Partial: stdout/stderr tested; JSON-looking output and unknown protocol source-inspected |
| REQ-006 Inspect and vars read live runtime state | Inspect Python function | `src/tools/runtime/*worker-source.ts`, `test/runtime-tool.test.mjs` | Runtime-tested |
| REQ-007 Busy, timeout, interruption, and not-found states are explicit | Exec timeout is not a silent success | `src/tools/runtime/registry.ts`, `src/tools/runtime/*backend.ts` | Source-inspected |
| REQ-008 Session cleanup is explicit and automatic | closeOnSuccess removes session | `src/tools/runtime/registry.ts`, `test/runtime-tool.test.mjs` | Runtime-tested |
| REQ-009 Unsupported targets fail before worker startup | Docker target requested | `src/tools/runtime/registry.ts` | Source-inspected |

## Verification Basis

This spec is based on current code in:

- `src/plugins/builtin.ts`
- `src/core/runtime.ts`
- `src/core/profiles.ts`
- `src/tools/runtime/tool.ts`
- `src/tools/runtime/registry.ts`
- `src/tools/runtime/types.ts`
- `src/tools/runtime/python-backend.ts`
- `src/tools/runtime/node-backend.ts`
- `src/tools/runtime/python-worker-source.ts`
- `src/tools/runtime/node-worker-source.ts`
- `test/runtime-tool.test.mjs`

## Change Log

- 2026-05-11: Added the worker-protocol isolation requirement from current Python/Node worker source inspection and existing runtime tool tests.
