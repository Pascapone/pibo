# Spec: Chat Web Slash Command Surface

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** `docs/specs/capabilities/core-gateway-actions-and-session-controls.md`, `docs/specs/capabilities/chat-web-file-download.md`, `docs/specs/capabilities/chat-web-settings-area.md`, `docs/specs/spec-product-projects-area.md`

## Why

Chat Web exposes runtime actions through the message composer. Users can type a normal message, choose a slash command, toggle browser-only display state, or trigger a file download from the same input. Without a focused contract, future UI changes can accidentally send local commands to the router, submit incomplete commands as messages, or run gateway actions against the wrong Pibo Session.

This spec covers the browser command surface only. The meaning of each gateway action remains managed by the gateway-action spec.

## Goal

Chat Web SHALL derive visible slash commands from advertised gateway actions plus explicit browser-local commands, route each command to the selected Pibo Session, and avoid treating recognized commands as chat messages.

## Background / Current State

`src/apps/chat-ui/src/App.tsx` builds `slashCommands` from `bootstrap.capabilities.actions[*].slashCommands`, filters out `/tree`, and adds `/download` and `/thinking-show`. The `Composer` shows a command menu when trimmed input starts with `/`, lets Enter complete an unambiguous menu choice before submission, and calls `onCommand` before sending text as a user message.

In the Sessions area, `runCommand` handles `/thinking-show` locally, handles `/download <path>` through the file download API, and posts other commands to `/api/chat/action` for the selected `piboSessionId`. The Chat Web action endpoint in `src/apps/chat/web-app.ts` requires same-origin JSON, an authenticated web session, a JSON-serializable params payload, an accessible non-archived room, and emits a Pibo `execution` event through the channel context.

## Scope

### In Scope

- Sessions-area slash command discovery in the React Chat Web UI.
- Composer menu completion and command-vs-message dispatch.
- Browser-local `/thinking-show` behavior.
- Browser-local `/download <path>` behavior as a command-surface entry point.
- `/thinking <level>` parameter extraction for the routed thinking action.
- Fork and clone command result selection behavior.
- `/api/chat/action` request validation that is specific to Chat Web command dispatch.

### Out of Scope

- Gateway action semantics such as status, model, thinking, compaction, fork, clone, abort, or kill — covered by the core gateway actions spec.
- Download authorization and path resolution internals — covered by the Chat Web file-download spec.
- Local Routed TUI slash commands — covered by the Local Routed TUI spec.
- Project-area workflow behavior — covered by the Projects Area spec.
- Visual styling of the command menu.

## Requirements

### Requirement: Slash commands are derived from advertised actions plus explicit local commands

The Sessions area MUST show slash commands from the selected Chat Web bootstrap capabilities and MUST add only explicit browser-local command entries.

#### Current

The command list is built from `bootstrap.capabilities.actions`, using each action's `slashCommands` and description. The `tree` slash command is filtered out. `/download` and `/thinking-show` are appended by the browser.

#### Acceptance

- Gateway actions with slash commands appear as `/name` entries.
- The `/tree` command is not listed in Chat Web even when advertised by the gateway action catalog.
- `/download` and `/thinking-show` are available even though they are not gateway actions.
- The `/thinking` entry explains that a level argument is allowed.

#### Scenario: Build command list

- GIVEN bootstrap capabilities include actions `status`, `tree`, and `thinking`
- WHEN the Sessions composer receives the bootstrap data
- THEN `/status` and `/thinking` are listed
- AND `/tree` is not listed
- AND `/download` and `/thinking-show` are listed.

### Requirement: Composer completion prevents incomplete command text from becoming a message

The composer MUST treat visible slash-command suggestions as command completion before it sends text as a chat message.

#### Current

When trimmed input starts with `/`, the composer filters commands by the first token. If Enter is pressed while suggestions exist and the first token does not exactly match a command, the active suggestion replaces the input value. A second submit can run the command. Unknown slash text falls through to normal send behavior only when no command handler accepts it.

#### Acceptance

- Typing `/thi` with `/thinking` visible and pressing Enter completes the input to `/thinking`.
- The incomplete text `/thi` is not sent as a user message on that Enter press.
- Exact recognized slash commands call `onCommand` before `onSend`.
- Empty or whitespace-only composer content does not send or run commands.

#### Scenario: Complete command suggestion

- GIVEN the command menu contains `/thinking`
- AND the composer text is `/thi`
- WHEN the user presses Enter
- THEN the composer value becomes `/thinking`
- AND no chat message is posted.

### Requirement: Browser-local commands do not enter the runtime router

Browser-local slash commands MUST complete entirely in the browser or through their managed browser API and MUST NOT be emitted as Pibo execution events.

#### Current

`/thinking-show` toggles `localStorage["pibo.chat.showThinking"]` and the local `showThinking` state. `/download` parses the remaining text as a path and calls the Chat Web file download helper with the selected Pibo Session and room. A missing path sets `Usage: /download <path>` as the UI error.

#### Acceptance

- `/thinking-show` changes only browser display state and does not call `/api/chat/action`.
- `/download <path>` calls the file download flow for the selected session and room.
- `/download` without a path reports usage and is not sent as a chat message.
- Browser-local commands are disabled when no session is selected or the selected room is archived.

#### Scenario: Toggle thinking display

- GIVEN a selected Pibo Session in an active room
- WHEN the user submits `/thinking-show`
- THEN the browser toggles historical thinking display
- AND no execution event is emitted to the router.

### Requirement: Routed command execution targets the selected Pibo Session

Recognized non-local slash commands MUST be sent to the Chat Web action endpoint for the selected Pibo Session and MUST refresh visible session state after completion.

#### Current

The Sessions area posts `piboSessionId`, `action`, and optional `params` to `/api/chat/action`. After most command results it reloads bootstrap/navigation state, updates the URL selection, and refreshes the selected trace. If a `session.clone` or `session.fork` result contains a derived `piboSessionId`, Chat Web selects that derived session instead.

#### Acceptance

- Non-local commands include the selected `piboSessionId` in the action request.
- The command text is not also sent as a user message after the action request is accepted.
- Clone and fork results that return a new Pibo Session ID navigate to that session.
- Other routed command results refresh bootstrap and trace data for the selected session.

#### Scenario: Clone command selects derived session

- GIVEN the selected session is `ps_parent`
- AND `/session.clone` maps to action `session.clone`
- WHEN the action result contains derived Pibo Session `ps_child`
- THEN Chat Web selects `ps_child`
- AND it does not send `/session.clone` as a chat message.

### Requirement: Thinking level arguments are passed only to the thinking action

The Sessions command dispatcher MUST parse a single level token from `/thinking <level>` and pass it as action params for the routed thinking action.

#### Current

The dispatcher matches `/thinking\s+(\S+)` and sends `{ level }` as params when present. Commands without a matched thinking level send no params.

#### Acceptance

- `/thinking high` posts action `thinking` with params `{ "level": "high" }`.
- `/thinking` posts action `thinking` without params.
- Other slash commands do not receive arbitrary trailing composer text as params through this dispatcher.
- Invalid thinking levels are rejected by the gateway action validation, not by the command menu.

#### Scenario: Set thinking level

- GIVEN the selected session supports thinking controls
- WHEN the user submits `/thinking medium`
- THEN Chat Web posts action `thinking` with params `{ "level": "medium" }`.

### Requirement: Chat Web action endpoint validates command requests before routing

The `/api/chat/action` endpoint MUST accept only authenticated same-origin JSON command requests for accessible non-archived room sessions and JSON-serializable params.

#### Current

The endpoint requires same-origin JSON, calls `requireSession`, validates `body.action`, rejects non-JSON-compatible params, resolves the requested session through the authenticated controller context, ensures the session room exists and is not archived, upserts the session projection, and emits an `execution` input event through the channel context.

#### Acceptance

- Missing or blank `action` returns HTTP 400.
- Non-JSON-serializable `params` return HTTP 400.
- Requests for archived rooms fail with HTTP 403.
- The emitted input event type is `execution` and uses the resolved selected Pibo Session ID.

#### Scenario: Archived room rejects command

- GIVEN a selected Pibo Session belongs to an archived room
- WHEN Chat Web posts `/api/chat/action` for that session
- THEN the endpoint returns a forbidden error
- AND no router execution event is emitted.

## Edge Cases

- Unknown slash text with no matching command handler currently falls through to normal message sending; future changes should decide whether unknown leading slash text should remain sendable.
- Command menu matching uses the first whitespace-delimited token, so arguments are not considered when choosing suggestions.
- `/thinking <level>` captures only the first non-whitespace level token; extra text is ignored by the command dispatcher.
- The Project area has its own command path and should not be inferred from the Sessions-area behavior in this spec.

## Constraints

- **Compatibility:** Gateway action names remain the durable API. Slash commands are a Chat Web convenience layer.
- **Security / Privacy:** Browser command dispatch must use the same authenticated same-origin protections as normal Chat Web mutations.
- **Performance:** Command-list construction should use bootstrap capabilities and should not require a separate command discovery request.
- **Dependencies:** Routed command execution depends on the channel context and session router. Local commands depend on browser state and file-download APIs.

## Success Criteria

- [ ] SC-001: UI tests or component-level checks verify command-list construction, `/tree` filtering, and local command inclusion.
- [ ] SC-002: Composer tests verify incomplete command completion, exact command dispatch before message send, and empty input behavior.
- [ ] SC-003: Browser-local command tests verify `/thinking-show` and `/download` do not emit router execution events.
- [ ] SC-004: API tests verify `/api/chat/action` rejects missing actions, invalid params, archived rooms, and unauthenticated or non-same-origin requests.
- [ ] SC-005: Command action tests verify `/thinking <level>` params and fork/clone derived-session selection.

## Assumptions and Open Questions

### Assumptions

- The Sessions area remains the primary Chat Web command surface for gateway actions.
- The gateway action catalog remains the source for action-managed slash commands.
- `/tree` is intentionally hidden because Chat Web already renders session hierarchy through navigation and trace views.

### Open Questions

- Should unknown leading slash text remain sendable as a normal message, or should Chat Web show an explicit unknown-command error?
- Should the Project area filter browser-local commands that it does not handle locally?
- Should routed command results be rendered as visible trace events in the browser, or is refreshing state enough for all actions?

## Traceability

| Requirement | Scenario / Story | Source Basis | Status |
|---|---|---|---|
| REQ-001 Slash commands are derived from advertised actions plus explicit local commands | Build command list | `src/apps/chat-ui/src/App.tsx` command-list construction | Implemented |
| REQ-002 Composer completion prevents incomplete command text from becoming a message | Complete command suggestion | `src/apps/chat-ui/src/App.tsx` `Composer` | Implemented |
| REQ-003 Browser-local commands do not enter the runtime router | Toggle thinking display | `src/apps/chat-ui/src/App.tsx` Sessions `runCommand`, `src/apps/chat-ui/src/api.ts` download helper | Implemented |
| REQ-004 Routed command execution targets the selected Pibo Session | Clone command selects derived session | `src/apps/chat-ui/src/App.tsx` Sessions `runCommand`, `selectSession` | Implemented |
| REQ-005 Thinking level arguments are passed only to the thinking action | Set thinking level | `src/apps/chat-ui/src/App.tsx` `/thinking` regex dispatch | Implemented |
| REQ-006 Chat Web action endpoint validates command requests before routing | Archived room rejects command | `src/apps/chat/web-app.ts` `/api/chat/action` handler | Implemented |

## Verification Basis

This spec is based on current source inspection of:

- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat/web-app.ts`
- existing related specs under `docs/specs/capabilities/` and `docs/specs/spec-product-projects-area.md`
