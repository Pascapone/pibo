# Spec: Core Gateway Actions and Routed Session Controls

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code
**Related docs:** [Plugin Registry and Capability Catalog](./plugin-registry-and-capability-catalog.md), [Pibo Session Routing](./pibo-session-routing.md), [Model Provider Auth and Session Model Selection](./model-provider-auth-and-session-selection.md), [Runtime Prompt and Compaction Configuration](./runtime-prompt-and-compaction.md)

## Why

Pibo channels, Chat Web, the local routed TUI, and gateway clients need one stable control surface for routed sessions. Users must be able to inspect status, clear queued work, stop active work, change runtime controls, navigate Pi session history, compact context, and start provider login flows without reaching into Pi Coding Agent internals.

The current code implements this surface as plugin-registered gateway actions executed by `RoutedSession`. This spec captures the observable behavior so channels can depend on it and new actions do not break routing, visibility, or safety.

## Goal

Define the behavior of core gateway actions and routed session controls as the public execution-action contract for a Pibo Session.

## Background / Current State

`piboCorePlugin` registers gateway actions such as `status`, `compact`, `clear_queue`, `abort`, `kill`, `kill_all`, `thinking`, `fast_mode`, `session.*`, `login.*`, `logout`, and `model`. `RoutedSession.executeAction()` looks up the action in the plugin registry, executes it with a bounded context object, emits an `execution_result`, and applies special handling for compaction and session operation results.

The action surface overlaps with several capabilities. This spec does not redefine provider credential storage, product session branch creation, or UI rendering. It specifies the shared routed execution behavior that those capabilities use.

## Scope

### In Scope

- Dispatch and error behavior for execution events handled by routed sessions.
- Core status, queue, abort, dispose, kill, and kill-all controls.
- Thinking level and fast-mode controls.
- Manual compaction queuing behavior.
- Pi session inspection, fork, clone, tree navigation, and switch action validation and result shape.
- Provider login/model action menu and parameter validation at the action boundary.

### Out of Scope

- Provider-specific OAuth, API-key persistence, and usage accounting — covered by model provider auth specs.
- Product-level branch session projection after fork or clone — covered by Pibo Session Routing.
- Chat Web or TUI rendering of execution results — covered by their UI specs.
- Plugin registration uniqueness and slash-command collision rules — covered by the plugin registry spec.

## Requirements

### Requirement: Execution actions are registry-dispatched and correlated

The system MUST execute only registered gateway actions and MUST emit an `execution_result` correlated to the requested Pibo Session and event id when the action succeeds.

#### Current

`RoutedSession.runAction()` looks up `event.action` through `pluginRegistry.getGatewayAction()`. Unknown actions throw `Unknown execution action`. Successful actions are emitted as `execution_result` with `piboSessionId`, `eventId`, `action`, and the returned result.

#### Target

Channels can send any registered execution action by name and receive one correlated result. Unregistered action names fail instead of becoming no-ops.

#### Acceptance

A router or channel test can register a custom gateway action, submit an execution event, and observe exactly one `execution_result` with the same action and event id. Submitting an unregistered action produces an error response through the caller path.

#### Scenario: Unknown action is rejected

- GIVEN a routed session with no `does.not.exist` gateway action
- WHEN a channel submits an execution event with action `does.not.exist`
- THEN execution fails with an unknown-action error
- AND no successful `execution_result` is emitted for that action.

### Requirement: Status reports runtime state and safe optional metadata

The `status` action MUST report queue, processing, streaming, cwd, disposal, enabled-tool, active-model, context-usage, thinking, fast-mode, and provider-usage state when available.

#### Current

`getStatus()` returns routed runtime state. The `status` action merges it with `activeModel`, `contextUsage`, and optional provider usage fetched for the active model.

#### Target

All channels can use `status` as the common readiness and diagnostics action without importing runtime internals.

#### Acceptance

A status action result includes `piboSessionId`, `queuedMessages`, `processing`, `streaming`, `cwd`, `disposed`, `enabledTools`, `activeModel` when set, and does not fail if provider usage cannot be read.

#### Scenario: Provider usage unavailable

- GIVEN a routed session with an active model
- AND provider usage lookup throws or is unsupported
- WHEN `status` runs
- THEN the action still succeeds
- AND the result omits provider usage instead of failing.

### Requirement: Queue and stop controls mutate only the addressed routed session tree

Core stop controls MUST expose bounded, explicit behavior: `clear_queue` clears not-yet-started messages, `abort` aborts the active Pi run, `dispose` disposes the addressed runtime, `kill` aborts the addressed session and child sessions, and `kill_all` also cancels yielded runs managed by the killed tree.

#### Current

The plugin registers `clear_queue`, `abort`, hidden `dispose`, `kill`, and `kill_all`. `RoutedSession` clears its queue, calls Pi abort/dispose APIs, and delegates recursive child/run cancellation through router callbacks when available.

#### Target

Stopping one session never silently affects unrelated sessions. Recursive kill actions report which sessions and yielded runs were affected.

#### Acceptance

Tests can enqueue multiple messages, clear the queue, abort an active run, and recursively kill a parent with child sessions. Results report cleared counts or killed ids, and unrelated sessions remain active.

#### Scenario: Kill all cancels child yielded runs

- GIVEN a parent routed session has a child session with an active yielded run
- WHEN `kill_all` runs on the parent
- THEN the parent and child session ids are reported as killed
- AND the yielded run id is reported as cancelled.

### Requirement: Manual compaction is queued like agent work

The `compact` action MUST enter the session queue and return an immediate queued result instead of running concurrently with active message processing.

#### Current

`RoutedSession.executeAction()` routes `compact` through `enqueueCompactAction()`. It emits an immediate `execution_result` with `{ queued: true, queuedMessages }`, then later processes compaction in queue order and emits the final `execution_result` or `session_error`.

#### Target

Manual compaction cannot race with message prompts or other queued work.

#### Acceptance

When a message is processing and `compact` is submitted, the first result indicates it was queued. The actual compaction result appears only after earlier queue items complete.

#### Scenario: Compact behind a running message

- GIVEN a session is processing a user message
- WHEN a channel submits `compact`
- THEN the immediate result says `queued: true`
- AND compaction runs after the active message finishes.

### Requirement: Thinking and fast mode are explicit and independent

The `thinking` action MUST read or set the runtime thinking level. The `fast_mode` action MUST toggle a separate fast-mode flag only when thinking is supported, without changing the selected thinking level.

#### Current

`thinking` validates optional `params.level` through `parsePiboThinkingLevel`; without a level it returns the current thinking result. `fast_mode` reads support from the runtime session and toggles `RoutedSession.fastMode` independently of `runtime.session.thinkingLevel`.

#### Target

Users can inspect and change thinking depth and toggle fast mode without hidden cycling or state loss.

#### Acceptance

A test can set thinking to `medium`, run `fast_mode`, then set thinking to `high` and verify fast mode remains enabled and the thinking level changes only when the `thinking` action requests it.

#### Scenario: Thinking read does not cycle

- GIVEN a session supports thinking and the current level is `medium`
- WHEN `thinking` runs with no params
- THEN the result reports `medium`
- AND the runtime thinking level remains `medium`.

### Requirement: Pi session controls validate parameters and return snapshots

The `session.*` actions MUST validate required parameters before calling Pi session operations and MUST return snapshot-shaped results for current, previous, and tree state.

#### Current

`session.current`, `session.list`, `session.fork_candidates`, `session.fork`, `session.clone`, `session.tree`, `session.tree_navigate`, and `session.switch` are registered in the core plugin. Required `entryId` and `sessionFile` parameters are checked before execution. Operation results include previous and current Pi session snapshots.

#### Target

Channels can expose Pi transcript history and branch controls safely while product-level Pibo Session projection remains the router's responsibility.

#### Acceptance

Invalid `session.fork`, `session.tree_navigate`, and `session.switch` params produce clear validation errors. Valid fork, clone, navigate, and switch actions return current/previous snapshots with Pi session id, cwd, session file, and leaf id where available.

#### Scenario: Switch requires a session file

- GIVEN a routed session is active
- WHEN `session.switch` runs without `params.sessionFile`
- THEN execution fails with `session.switch requires params.sessionFile`
- AND the current Pi session is unchanged.

### Requirement: Provider menu and login actions validate at the gateway boundary

Provider-facing actions MUST validate provider identifiers and secret parameters before delegating to provider auth helpers, and menu actions MUST return UI-neutral data structures.

#### Current

`login` returns provider menu metadata and configured flags. `model` returns authenticated providers and model choices. `login.start`, `login.complete`, `login.apikey`, `login.status`, and `logout` validate required params in the core plugin before calling auth helpers.

#### Target

Web and terminal clients can build provider menus from action results, while malformed provider-auth requests fail before mutating credential state.

#### Acceptance

`login.start` without `params.provider`, `login.complete` without `params.state`, `login.apikey` without `params.apiKey`, and `logout` without `params.provider` all fail with explicit validation errors.

#### Scenario: API key action requires a secret

- GIVEN a client submits `login.apikey` with only `params.provider`
- WHEN the action runs
- THEN execution fails with `login.apikey requires params.apiKey`
- AND no API key is stored.

## Edge Cases

- Execution against a disposed routed session fails with `Session "<id>" has been disposed`.
- `fast_mode` on a model without thinking support returns the current mode and `changed: false`.
- `session.clone` fails when there is no current leaf entry to clone.
- Compaction failures are emitted as `session_error` for the compaction event.
- Recursive kill behavior depends on router-provided child/run cancellation callbacks; without them, only the addressed session is killed.

## Constraints

- **Compatibility:** Existing action names and slash commands remain stable unless a migration spec changes them.
- **Safety:** Stop controls MUST operate on the addressed routed session or explicit descendants, not global process state.
- **Security / Privacy:** Provider secret values are accepted only by credential actions and MUST NOT be returned in action results.
- **Source of Truth:** Registered gateway actions and `RoutedSession` behavior in the current code are authoritative.

## Success Criteria

- [ ] SC-001: Unknown actions fail, while registered actions emit correlated `execution_result` events.
- [ ] SC-002: Status, queue, stop, thinking, fast-mode, compaction, and session-control actions have tests covering success and validation failures.
- [ ] SC-003: Compaction is queued and cannot race active message processing.
- [ ] SC-004: Recursive kill actions report killed sessions and cancelled yielded runs without affecting unrelated sessions.
- [ ] SC-005: Provider login/model actions validate parameters before auth helper calls and never return secrets.

## Assumptions and Open Questions

### Assumptions

- Gateway action names are the durable API; slash commands are channel conveniences.
- Provider-specific auth behavior remains specified outside this document.
- Product-level branch creation after fork or clone remains part of session-router behavior, not the action itself.

### Open Questions

- Should `kill` and `kill_all` be hidden or role-gated differently from `abort` in browser-facing UIs?
- Should all validation errors use structured error codes in addition to human-readable messages?
- Should `compact` emit a distinct queued event type instead of using an immediate `execution_result` with `{ queued: true }`?

## Traceability

| Requirement | Scenario / Story | Code / Tests | Status |
|---|---|---|---|
| Execution actions are registry-dispatched and correlated | Unknown action is rejected | `src/core/routed-session.ts`, `src/plugins/registry.ts`, `test/channel-runtime.test.mjs` | Implemented |
| Status reports runtime state and safe optional metadata | Provider usage unavailable | `src/core/routed-session.ts`, `src/plugins/builtin.ts`, `src/auth/openai-codex-usage.ts` | Implemented |
| Queue and stop controls mutate only the addressed routed session tree | Kill all cancels child yielded runs | `src/core/routed-session.ts`, `src/core/session-router.ts`, `src/plugins/builtin.ts`, `test/session-actions.test.mjs` | Implemented |
| Manual compaction is queued like agent work | Compact behind a running message | `src/core/routed-session.ts`, `src/plugins/builtin.ts`, `test/session-actions.test.mjs`, `test/compaction-prompt.test.mjs` | Implemented |
| Thinking and fast mode are explicit and independent | Thinking read does not cycle | `src/core/routed-session.ts`, `src/plugins/builtin.ts`, `test/session-actions.test.mjs` | Implemented |
| Pi session controls validate parameters and return snapshots | Switch requires a session file | `src/core/events.ts`, `src/core/routed-session.ts`, `src/plugins/builtin.ts`, `test/session-actions.test.mjs` | Implemented |
| Provider menu and login actions validate at the gateway boundary | API key action requires a secret | `src/plugins/builtin.ts`, `src/auth/login-actions.ts`, `test/login-actions.test.mjs`, `test/model-catalog.test.mjs` | Implemented |

## Verification Basis

This spec is based on the current workspace code in `src/core/routed-session.ts`, `src/core/session-router.ts`, `src/core/events.ts`, `src/plugins/builtin.ts`, `src/plugins/registry.ts`, `src/auth/login-actions.ts`, `src/auth/openai-codex-usage.ts`, and tests including `test/session-actions.test.mjs`, `test/channel-runtime.test.mjs`, `test/login-actions.test.mjs`, and `test/model-catalog.test.mjs`.
