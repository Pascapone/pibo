# Spec: Runtime Thinking and Fast Mode Controls

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** [Model Provider Auth and Session Model Selection](./model-provider-auth-and-session-selection.md), [Pibo Runtime Assembly and Profile Inspection](./pibo-runtime-assembly-and-inspection.md), [Chat Web Output Compaction and Stream Projection](./chat-web-output-compaction-and-stream-projection.md), [Core Gateway Actions and Session Controls](./core-gateway-actions-and-session-controls.md)

## Why

Pibo exposes provider reasoning as a product-level thinking control. Users and agents can select a thinking level before runtime creation through profiles and model defaults, inspect or change it during a routed session with `/thinking`, and temporarily prefer speed over reasoning with `/fast` when the active model supports thinking.

This behavior needs its own contract because thinking touches runtime assembly, gateway actions, Chat Web command handling, local routed TUI commands, status output, trace events, and compact terminal controls. It is related to model selection, but it is not the same as choosing a provider model.

## Goal

Pibo MUST validate, apply, expose, and render runtime thinking and fast-mode state consistently across profiles, routed sessions, Chat Web, and local routed TUI surfaces.

## Background / Current State

The current code defines the allowed thinking levels in `src/core/thinking.ts` as `off`, `minimal`, `low`, `medium`, `high`, and `xhigh`. Model defaults can store global, main-session, and subagent thinking defaults. Runtime creation passes the selected thinking level to Pi Coding Agent.

The core plugin registers gateway actions `thinking` and `fast_mode` with slash commands `/thinking` and `/fast`. `RoutedPiboSession` can report the current thinking level, set a requested level, report available thinking levels, and toggle fast mode only when the active runtime reports thinking support. Chat Web maps slash commands and terminal thinking cards to those actions. The local routed TUI exposes `/thinking <level>` and `/thinking-show` behavior.

## Scope

### In Scope

- Valid thinking level vocabulary and validation.
- Thinking-level precedence from profile and model defaults during runtime creation.
- Runtime `/thinking` inspection and mutation action behavior.
- Fast-mode action behavior and status projection.
- Thinking event normalization from Pi runtime output into Pibo output events.
- Chat Web and local routed TUI command behavior for thinking controls.
- Compact terminal thinking-card behavior.

### Out of Scope

- Provider model discovery and authentication — covered by the model-provider spec.
- Persistence of active model choices on Pibo Sessions — covered by session-routing and model-provider specs.
- Storage and compaction of thinking deltas for Chat Web streams — covered by output-compaction and trace specs.
- Provider-specific reasoning token accounting beyond the generic context and provider usage status fields.

## Requirements

### Requirement: Thinking levels use one bounded vocabulary

The system MUST accept only the Pibo thinking levels `off`, `minimal`, `low`, `medium`, `high`, and `xhigh` wherever a product-level thinking level is parsed or persisted.

#### Current

`isPiboThinkingLevel` and `parsePiboThinkingLevel` define the allowed values. `sanitizePiboModelDefaults` drops invalid thinking values. The gateway `thinking` action rejects non-string or unknown `params.level` values before mutating the runtime.

#### Target

All user-facing and configuration-facing thinking inputs share the same vocabulary and fail or sanitize predictably.

#### Acceptance

- Saving model defaults preserves valid thinking values and omits invalid ones.
- `/thinking high` sends a valid execution request.
- A `thinking` execution event with `params.level: "none"` fails validation.
- A `thinking` execution event with a non-string level fails validation.
- Error messages list the valid thinking levels when parsing rejects a string value.

#### Scenario: Invalid runtime level is rejected

- GIVEN a routed Pibo Session is active
- WHEN a client executes action `thinking` with `{ "level": "none" }`
- THEN Pibo rejects the action
- AND the runtime session keeps its previous thinking level.

### Requirement: Runtime creation selects thinking by session role

The system MUST resolve the requested thinking level before Pi runtime creation using session role, profile fields, and model defaults.

#### Current

`selectRequestedThinkingLevel` chooses `subagentThinkingLevel`, then profile `thinkingLevel`, then `subagentThinking`, then global `thinking` for child sessions. For root sessions it chooses `mainThinkingLevel`, then profile `thinkingLevel`, then `mainThinking`, then global `thinking`. `createPiboRuntime` passes the selected value to Pi Coding Agent unless an explicit creation option overrides it.

#### Target

Main sessions and subagent sessions can have different defaults while profile hard preferences remain honored.

#### Acceptance

- A root session uses `profile.mainThinkingLevel` before global defaults.
- A subagent session uses `profile.subagentThinkingLevel` before global defaults.
- Profile `thinkingLevel` is the fallback profile-level preference for both root and subagent sessions.
- `mainThinking` and `subagentThinking` override global `thinking` for their respective session roles.
- Explicit runtime creation options override profile/default selection when supplied by the caller.

#### Scenario: Subagent thinking default wins for child session

- GIVEN model defaults contain `thinking: "medium"` and `subagentThinking: "low"`
- AND a child routed session profile has no thinking override
- WHEN Pibo creates the child runtime
- THEN the runtime starts with thinking level `low`.

### Requirement: Thinking action reports state when no level is supplied

The system MUST make the `thinking` gateway action read-only when no level parameter is supplied.

#### Current

`getThinkingParams` returns an empty object when `params.level` is absent. The action then calls `context.getThinkingLevel()` instead of `context.setThinkingLevel()`.

#### Target

Users can inspect the current thinking state without accidentally cycling or changing it.

#### Acceptance

- Executing `thinking` without params returns the current level.
- The response includes available levels from the runtime.
- The response includes whether the active model supports thinking.
- The runtime thinking level is unchanged by a read-only action.

#### Scenario: Show current thinking level

- GIVEN a routed Pibo Session is active with thinking level `medium`
- WHEN the user runs `/thinking` with no argument
- THEN the execution result reports `level: "medium"`
- AND the runtime remains at `medium`.

### Requirement: Thinking action mutates only the addressed routed runtime

The system MUST apply a valid thinking-level change to the current routed Pibo Session runtime and report the resulting runtime-supported state.

#### Current

`RoutedPiboSession.setThinkingLevel` calls `runtime.session.setThinkingLevel(level)` and returns `level`, `availableLevels`, and `supported` from the live Pi session. The result is emitted as an `execution_result` for the same Pibo Session.

#### Target

A thinking change is session-scoped runtime state. It does not mutate global defaults, other sessions, or stored model choices.

#### Acceptance

- A valid thinking action changes the live runtime session level.
- The emitted execution result uses the same Pibo Session ID as the action target.
- The result includes the new level and available levels.
- Model defaults on disk are not modified by the action.
- Other active routed sessions keep their own thinking state.

#### Scenario: Change thinking to high

- GIVEN Pibo Session `ps_a` is active at thinking level `medium`
- WHEN the user runs `/thinking high` for `ps_a`
- THEN the runtime for `ps_a` changes to `high`
- AND Pibo emits an `execution_result` for action `thinking` with result level `high`.

### Requirement: Fast mode toggles independently of thinking level

The system MUST expose fast mode as a runtime preference that switches between `fast` and `normal` without rewriting the selected thinking level.

#### Current

The `fast_mode` gateway action reads `context.getFastMode()`. If thinking is unsupported it returns the current state with `changed: false`. Otherwise it toggles the routed session's `fastMode` boolean. `getStatus()` reports `fastMode` as true only when the model supports thinking and the flag is enabled.

#### Target

Users can temporarily request faster behavior for thinking-capable models while preserving the selected thinking level for later normal-mode operation.

#### Acceptance

- `/fast` on a thinking-capable session toggles between `mode: "fast"` and `mode: "normal"`.
- `/fast` on a session that does not support thinking returns `supported: false` and `changed: false`.
- Toggling fast mode does not change `runtime.session.thinkingLevel`.
- Status output exposes the effective fast-mode boolean.

#### Scenario: Fast mode leaves thinking level intact

- GIVEN a routed session supports thinking and has thinking level `medium`
- WHEN the user runs `/fast`
- THEN the fast-mode result reports `mode: "fast"` and `changed: true`
- AND a later `/thinking` report still shows level `medium`.

### Requirement: Thinking output events preserve reasoning block identity

The system MUST normalize Pi thinking output into Pibo thinking events that are tied to the active message and stable per reasoning block.

#### Current

`RoutedPiboSession` maps Pi `thinking_start`, `thinking_delta`, and `thinking_end` message updates to `thinking_started`, `thinking_delta`, and `thinking_finished`. `withActiveMessage` attaches the active message event id and assigns incrementing `thinkingIndex` values across multiple thinking blocks in one turn.

#### Target

Trace, stream, and terminal views can distinguish separate reasoning blocks and attach them to the correct assistant turn.

#### Acceptance

- Thinking events emitted during an active message include that message's event id.
- A thinking block receives the same `thinkingIndex` for start, delta, and finish.
- A second thinking block in the same message receives a different `thinkingIndex`.
- A `thinking_finished` event clears the active thinking index for the next block.

#### Scenario: Two thinking blocks in one turn

- GIVEN one assistant turn emits two provider thinking blocks
- WHEN Pibo normalizes the turn output
- THEN the first block's thinking events have `thinkingIndex: 0`
- AND the second block's thinking events have `thinkingIndex: 1`.

### Requirement: Chat Web thinking controls call gateway actions

The Chat Web UI MUST route thinking-level selections and slash commands through the same gateway action contract as other session controls.

#### Current

Chat Web recognizes `/thinking <level>` and posts action `thinking` with `{ level }`. The compact terminal `TerminalThinkingCard` parses action output, shows current and available levels, disables unsupported or unknown levels, and calls the provided level-selection callback. The session model badge can include resolved thinking and fast state.

#### Target

Chat Web does not maintain a separate thinking state machine. It renders and mutates state from gateway action results and bootstrap/status data.

#### Acceptance

- Typing `/thinking low` sends action `thinking` with level `low` for the selected Pibo Session.
- Clicking an available thinking level in the terminal card triggers the same action path.
- Unknown levels in an action result are displayed but not selectable.
- If `supported` is false, level buttons are disabled.
- Malformed thinking action output renders an unparseable state instead of crashing the session view.

#### Scenario: Terminal thinking card changes level

- GIVEN a thinking execution result reports available levels `off`, `low`, and `high`
- AND the active model supports thinking
- WHEN the user clicks `high`
- THEN Chat Web sends `/thinking high` or the equivalent gateway action for the selected session.

### Requirement: Local routed TUI exposes thinking commands without hiding reasoning output

The local routed TUI MUST register thinking commands and render thinking content according to the user's display setting.

#### Current

Local routed TUI tests cover command registration for `/thinking`, `/thinking-show`, and action dispatch for `/thinking <level>`. They also cover hiding or showing historical thinking deltas and preserving thinking blocks when an assistant message finishes.

#### Target

Terminal users have parity with Chat Web for changing thinking levels and can choose whether reasoning blocks are shown in the local transcript.

#### Acceptance

- The local routed TUI command list includes `/thinking` when the routed profile exposes the action.
- `/thinking <level>` sends execution action `thinking` with the parsed level.
- `/thinking-show` toggles local display of historical thinking blocks.
- Completed assistant messages retain their associated thinking block data even when display is currently hidden.

#### Scenario: Local TUI sends thinking action

- GIVEN the local routed TUI is attached to a routed session
- WHEN the user enters `/thinking high`
- THEN the client sends execution action `thinking` with `{ level: "high" }`.

## Edge Cases

- A provider can expose no thinking support even when Pibo has a selected thinking level; UI controls must report unsupported rather than assume mutation works.
- A session may have a stored or selected thinking level that is no longer available from the active provider. Reporting should include the runtime's available levels so clients can disable impossible choices.
- Fast mode is effective only when the active runtime supports thinking.
- Invalid model-default JSON loads as empty defaults, so thinking selection falls through to profile or undefined values.
- Thinking deltas can arrive without final text; output compaction and trace specs define how final text is recovered for Chat Web views.

## Constraints

- **Compatibility:** The allowed thinking level strings are public product values and should not change without migration and UI updates.
- **Security / Privacy:** Thinking text is reasoning content. It follows the same room/session access controls as other Pibo output events and must not be exposed outside authorized streams or trace reads.
- **Performance:** Thinking deltas can be frequent. Durable storage and live compaction must stay bounded by the output-compaction contract.
- **Dependencies:** Actual reasoning support and available levels come from Pi Coding Agent runtime model capabilities.

## Success Criteria

- [ ] SC-001: Model-default tests cover valid and invalid thinking defaults, main/subagent precedence, and fallback behavior.
- [ ] SC-002: Session-action tests cover read-only `thinking`, valid mutation, invalid level rejection, and fast-mode independence.
- [ ] SC-003: Runtime output tests cover normalized thinking start, delta, finish, event id, and `thinkingIndex` behavior.
- [ ] SC-004: Chat Web tests cover `/thinking <level>`, terminal-card level selection, unsupported levels, and malformed action output.
- [ ] SC-005: Local routed TUI tests cover command registration, action dispatch, `/thinking-show`, and hidden/preserved thinking blocks.

## Assumptions and Open Questions

### Assumptions

- Thinking level is runtime state, not a persisted Pibo Session field in the current code.
- Global, main, and subagent thinking defaults belong to the existing model-defaults file.
- Fast mode is a routed-session preference that asks the runtime to behave faster; it is not a separate provider model id.

### Open Questions

- Should changing thinking level in a session be persisted in Pibo Session metadata for restore after gateway restart?
- Should Chat Web hide `/fast` for models that do not support thinking instead of returning an unsupported action result?
- Should the valid thinking vocabulary be exposed through a versioned bootstrap field rather than duplicated in frontend constants?

## Traceability

| Requirement | Scenario / Story | Code basis | Status |
|---|---|---|---|
| REQ-001: Bounded vocabulary | Invalid runtime level is rejected | `src/core/thinking.ts`, `src/core/model-defaults.ts`, `src/plugins/builtin.ts` | Draft |
| REQ-002: Creation precedence | Subagent thinking default wins for child session | `src/core/model-defaults.ts`, `src/core/runtime.ts`, `test/model-defaults.test.mjs` | Draft |
| REQ-003: Read-only thinking action | Show current thinking level | `src/plugins/builtin.ts`, `src/core/routed-session.ts`, `test/session-actions.test.mjs` | Draft |
| REQ-004: Session-scoped mutation | Change thinking to high | `src/core/routed-session.ts`, `src/core/events.ts` | Draft |
| REQ-005: Fast-mode independence | Fast mode leaves thinking level intact | `src/plugins/builtin.ts`, `src/core/routed-session.ts`, `test/session-actions.test.mjs` | Draft |
| REQ-006: Thinking event identity | Two thinking blocks in one turn | `src/core/routed-session.ts`, `test/session-actions.test.mjs` | Draft |
| REQ-007: Chat Web controls | Terminal thinking card changes level | `src/apps/chat-ui/src/App.tsx`, `src/apps/chat-ui/src/session-views/compact-terminal/TerminalThinkingCard.tsx`, `src/apps/chat-ui/src/types.ts` | Draft |
| REQ-008: Local routed TUI commands | Local TUI sends thinking action | `src/local/tui.ts`, `test/local-routed-tui.test.mjs` | Draft |

## Verification Basis

This spec was derived from current workspace code in:

- `src/core/thinking.ts`
- `src/core/model-defaults.ts`
- `src/core/runtime.ts`
- `src/core/events.ts`
- `src/core/routed-session.ts`
- `src/plugins/builtin.ts`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalThinkingCard.tsx`
- `src/apps/chat-ui/src/types.ts`
- `src/local/tui.ts`
- `test/model-defaults.test.mjs`
- `test/session-actions.test.mjs`
- `test/local-routed-tui.test.mjs`

Existing specs under `docs/specs/` were inspected first. This spec intentionally covers the thinking and fast-mode control contract, not the broader model-provider, stream-compaction, or trace-rendering behavior.
