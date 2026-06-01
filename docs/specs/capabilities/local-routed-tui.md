# Spec: Local Routed TUI

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo source-spec coverage from current workspace code
**Related docs:** `GLOSSARY.md`, `docs/specs/capabilities/pibo-session-routing.md`, `docs/specs/capabilities/plugin-registry-and-capability-catalog.md`, `docs/specs/capabilities/runtime-prompt-and-compaction.md`

## Why

Pibo can run a terminal chat UI either directly against Pi Coding Agent or through Pibo's product boundary. Profiles that depend on Pibo routing, gateway actions, subagents, product session IDs, or Pibo-managed runtime options need a local terminal path that exercises the routed runtime instead of bypassing it.

The Local Routed TUI gives operators and agents a terminal interface that creates a local Pibo Session, sends input through the Session Router, and renders normalized Pibo output events with Pi TUI components.

## Goal

Provide a local terminal session that behaves like a Pibo-routed conversation while preserving safe terminal controls and clear rendering of routed messages, tools, thinking, execution results, and errors.

## Background / Current State

The CLI exposes `pibo tui:routed [profile]` with `--show-thinking` and `--thinking <level>`. It constructs a local routed client, creates an in-memory Pibo Session on the `local-tui` channel, resolves the selected profile through the plugin registry, starts a `PiboSessionRouter`, and runs a Pi TUI controller profile with a Pibo local extension.

The Local Routed TUI does not use the gateway daemon or persistent Pibo Session store. It is a same-process local adapter for interactive QA and local routed use.

## Scope

### In Scope

- `pibo tui:routed` behavior.
- Local in-process Pibo Session creation for terminal use.
- Routing of terminal user input and supported slash commands through `PiboSessionRouter`.
- Rendering of normalized Pibo output events in the Pi TUI.
- Local safeguards that block conflicting direct Pi TUI commands.
- Thinking display controls for routed thinking events.

### Out of Scope

- Network gateway protocol behavior — covered by `local-gateway-protocol-and-lifecycle.md`.
- Browser Chat Web behavior — covered by Chat Web capability specs.
- Durable session persistence for the Local Routed TUI — the current implementation uses an in-memory Pibo Session store.
- Changing Pi TUI core behavior outside the Pibo extension.

## Requirements

### Requirement: CLI starts a routed local session

The CLI MUST start `pibo tui:routed [profile]` as a local Pibo-routed terminal session, not as a direct Pi Coding Agent session.

#### Current

`src/cli.ts` registers `tui:routed`, resolves options, and calls `runLocalRoutedTui`. `src/local/client.ts` creates a `PiboSessionRouter` and an in-memory `PiboSession` with channel `local-tui` and kind `local`.

#### Acceptance

A test can create a local routed client for profile alias `codex` and observe a Pibo Session ID, channel `local-tui`, kind `local`, canonical resolved profile `codex-compat-openai-web`, and the requested thinking level on the router options.

#### Scenario: Start routed TUI with profile alias

- GIVEN a valid profile alias `codex`
- WHEN an operator runs `pibo tui:routed --thinking high codex`
- THEN Pibo creates a local Pibo Session through the router using the canonical profile
- AND the routed runtime receives thinking level `high`.

### Requirement: Terminal input routes through Pibo events

The Local Routed TUI MUST convert normal terminal input into Pibo `message` events for the current local Pibo Session.

#### Current

The extension intercepts Pi TUI `input` events, echoes user text to the TUI, and calls `client.sendMessage`. The client emits a router message with a generated event ID and source `ui`.

#### Acceptance

Submitting non-empty text that is not a recognized slash command produces exactly one routed user message and marks the Pi input as handled.

#### Scenario: Send local message

- GIVEN a connected Local Routed TUI session
- WHEN the user submits `Hallo local`
- THEN the TUI displays `Hallo local` as a user message
- AND the local client sends `Hallo local` through the Pibo Session Router.

### Requirement: Routed slash commands are derived from registered gateway actions

The Local Routed TUI MUST expose registered gateway actions as terminal slash commands, except direct Pi TUI commands that are unsafe or misleading in routed mode.

#### Current

The extension builds commands from `client.capabilities.actions[*].slashCommands`, filters a fixed set of blocked Pi TUI commands, registers allowed commands in Pi TUI, and sends selected commands as Pibo `execution` events.

#### Acceptance

If capabilities include `status`, `thinking`, `session`, `tree`, and `session-current`, only non-blocked commands such as `/status`, `/thinking`, and `/session-current` are registered and advertised.

#### Scenario: Run routed status

- GIVEN the local client advertises a `status` gateway action with slash command `/status`
- WHEN the user invokes `/status`
- THEN the extension sends a Pibo execution event with action `status`
- AND the input does not run Pi TUI's direct local status behavior.

### Requirement: Conflicting Pi TUI commands are blocked before submit

The Local Routed TUI MUST block leading slash commands that would mutate or inspect the direct Pi session instead of the routed Pibo Session.

#### Current

The extension blocks leading commands such as `/settings`, `/model`, `/session`, `/tree`, `/fork`, `/clone`, `/login`, `/logout`, `/new`, `/reload`, and `/resume`. The submit guard only blocks exact leading command names, not text that merely contains those strings.

#### Acceptance

Submitting `  /fork` or `/clone now` is consumed, clears the editor, and displays an error. Submitting `Bitte erkläre /fork im Text` or `/forked` is not blocked by the guard.

#### Scenario: Block direct fork command

- GIVEN a connected Local Routed TUI session
- WHEN the user submits `/fork`
- THEN the command is not forwarded to Pi TUI or the Pibo router
- AND the TUI explains that the command is unavailable in local routed mode.

### Requirement: Streaming assistant and thinking events render live and finalize cleanly

The Local Routed TUI MUST render assistant deltas in a live widget and replace the widget with final conversation messages when the routed turn finishes.

#### Current

`message_started` creates a streaming widget. `assistant_delta` appends text. `thinking_delta` and `thinking_finished` collect thinking blocks. `assistant_message` clears the widget, optionally emits thinking blocks, emits the final assistant message, and sets status to connected.

#### Acceptance

During streaming, the live widget displays accumulated assistant text without appending final messages. After `assistant_message`, the live widget is removed and the final assistant message is appended once.

#### Scenario: Stream and finish assistant response

- GIVEN a running routed turn
- WHEN Pibo emits assistant deltas `Hallo` and ` streaming`
- THEN the terminal shows `Hallo streaming` in the live widget
- WHEN Pibo emits final assistant message `Hallo streaming`
- THEN the live widget disappears
- AND the conversation contains one final assistant message.

### Requirement: Thinking visibility is explicit and local

The Local Routed TUI MUST hide routed thinking content by default unless `--show-thinking` is set or the user toggles `/thinking-show`.

#### Current

`runLocalRoutedTui` passes `showThinking` from CLI options. The extension maintains local display state and registers `/thinking-show` as a local-only command. The routed `/thinking` command remains a router execution action that can change runtime thinking level.

#### Acceptance

With thinking display enabled, thinking deltas appear in the live widget and finalized thinking blocks appear before the final assistant response. Toggling `/thinking-show` hides or shows existing live thinking blocks without sending a router execution event.

#### Scenario: Toggle thinking display

- GIVEN a routed turn has collected thinking blocks
- WHEN the user runs `/thinking-show`
- THEN the terminal reports whether thinking display is on or off
- AND the current streaming widget updates to match that local display state.

### Requirement: Tool execution events use Pi TUI tool rendering

The Local Routed TUI MUST render routed tool-call lifecycle events with Pi-compatible tool execution components.

#### Current

The extension creates per-tool live widgets on `tool_call`, updates them on execution start and partial updates, normalizes final results, removes the live widget on `tool_execution_finished`, and appends a persisted custom tool message.

#### Acceptance

A tool call for `bash` with arguments appears in a live tool widget while running. After completion, the live widget is gone and the final tool result can be rendered by the registered `pibo.local-routed` message renderer.

#### Scenario: Render completed tool call

- GIVEN the router emits `tool_call`, `tool_execution_started`, and `tool_execution_finished` for one tool call ID
- WHEN the final event includes text result `Echo: Hallo`
- THEN the live tool widget is removed
- AND the conversation contains a rendered tool message with `Echo: Hallo`.

### Requirement: Session shutdown releases local routing resources

The Local Routed TUI MUST unsubscribe event listeners, remove live widgets, and close the local client on TUI shutdown.

#### Current

The extension handles `session_shutdown` by unsubscribing router event and submit-guard listeners, clearing streaming and tool widgets, marking itself disconnected, and calling `client.close`. The client disposes all router sessions on close.

#### Acceptance

After shutdown, registered local event listeners no longer receive events, live widgets are removed, and a subsequent close call is idempotent.

#### Scenario: Shutdown local routed TUI

- GIVEN a connected Local Routed TUI session with active listeners
- WHEN the Pi TUI session shuts down
- THEN the local client closes
- AND the router is disposed for the local session.

## Edge Cases

- Empty or whitespace-only input is ignored and allowed to continue through Pi TUI handling.
- `/quit` stays local and is not converted into a routed execution event.
- Unknown slash commands are handled with an error message instead of falling through to direct Pi TUI command handling.
- Router or client send failures are displayed as local routed request failures.
- `session_error` clears live widgets, displays the error, and marks the local status as error.
- Tool result payloads that are not already Pi content arrays are converted to a single text content item.

## Constraints

- **Product boundary:** The conversation runtime MUST be reached through `PiboSessionRouter`.
- **Persistence:** The Local Routed TUI uses an in-memory Pibo Session store unless the implementation is deliberately changed and specified later.
- **Compatibility:** Rendered custom messages MUST delegate to Pi TUI message components so terminal styling remains compatible with Pi.
- **Safety:** Direct Pi TUI session/model/auth/fork commands MUST NOT silently operate on the controller session in routed mode.

## Success Criteria

- [ ] SC-001: `pibo tui:routed [profile]` creates a local Pibo Session with channel `local-tui` and routes messages through `PiboSessionRouter`.
- [ ] SC-002: Supported gateway action slash commands execute as Pibo execution events.
- [ ] SC-003: Blocked direct Pi commands are consumed with a clear error.
- [ ] SC-004: Assistant, thinking, tool, execution result, and session error events render in the terminal according to this spec.
- [ ] SC-005: Shutdown cleans up local widgets, listeners, and router resources.

## Assumptions and Open Questions

### Assumptions

- The Local Routed TUI remains a local QA and operator convenience path, not a replacement for the gateway daemon.
- The direct Pi controller profile should stay minimal and should not expose built-in tools.

### Open Questions

- Should `persistSession: true` become a supported CLI option for routed local sessions, or remain an internal option only?
- Should the list of blocked direct Pi commands be derived from Pi TUI command metadata instead of a fixed Pibo-side list?

## Traceability

| Requirement | Scenario / Story | Code Basis | Status |
|---|---|---|---|
| CLI starts a routed local session | Start routed TUI with profile alias | `src/cli.ts`, `src/local/tui.ts`, `src/local/client.ts`, `test/local-routed-tui.test.mjs` | Draft |
| Terminal input routes through Pibo events | Send local message | `src/local/extension.ts`, `src/local/client.ts`, `test/local-routed-tui.test.mjs` | Draft |
| Routed slash commands are derived from registered gateway actions | Run routed status | `src/local/extension.ts`, `src/plugins/types.ts`, `test/local-routed-tui.test.mjs` | Draft |
| Conflicting Pi TUI commands are blocked before submit | Block direct fork command | `src/local/extension.ts`, `test/local-routed-tui.test.mjs` | Draft |
| Streaming assistant and thinking events render live and finalize cleanly | Stream and finish assistant response | `src/local/extension.ts`, `test/local-routed-tui.test.mjs` | Draft |
| Thinking visibility is explicit and local | Toggle thinking display | `src/cli.ts`, `src/local/extension.ts`, `test/local-routed-tui.test.mjs` | Draft |
| Tool execution events use Pi TUI tool rendering | Render completed tool call | `src/local/extension.ts`, `test/local-routed-tui.test.mjs` | Draft |
| Session shutdown releases local routing resources | Shutdown local routed TUI | `src/local/extension.ts`, `src/local/client.ts`, `test/local-routed-tui.test.mjs` | Draft |

## Verification Basis

- `test/local-routed-tui.test.mjs`
- `src/cli.ts`
- `src/local/tui.ts`
- `src/local/client.ts`
- `src/local/extension.ts`
