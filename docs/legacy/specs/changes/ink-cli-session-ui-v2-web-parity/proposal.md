# Proposal: Ink CLI Session UI V2 Web Parity

## Why

The first `pibo tui:sessions` implementation now sends messages through the routed runtime, but it is still a reduced CLI chat surface. It does not feel like the Web Compact Terminal View, does not expose the Web Slash Command catalog, and does not organize work by rooms before sessions.

The next change should move the CLI from a recovery-only chat subset to a terminal-native companion for the Web Session UI. The CLI should share the same session data, terminal row model, command catalog, and interaction semantics where possible, while rendering through Ink instead of DOM/CSS.

## What Changes

- `pibo tui:sessions` becomes a room-aware, Web-parity session terminal.
- The CLI opens through room selection first, then session selection.
- `/new` requires a target room, defaulting to Personal Chat when no room is selected.
- The CLI supports the Web Chat Slash Command catalog, plus CLI-only navigation commands.
- Interactive Web controls such as thinking/model/login menus are adapted to keyboard-first Ink pickers.
- Status, thinking, model, login, tool, yielded-run, and error cards use shared headless view models and renderer-specific components.
- CLI-created sessions are visible and navigable in the Web UI under the same rooms.

## Capabilities

### New Capabilities

- `cli-web-parity-terminal`: Ink renders the same compact terminal view model as Web Compact Terminal View.
- `cli-owner-impersonation`: Host-root CLI users select an effective Pibo owner scope and continue as that Web user, or as a local Root recovery profile when no Web user exists.
- `cli-room-navigation`: CLI users browse rooms before sessions and create sessions in a selected owner's room.
- `cli-slash-command-catalog`: CLI exposes Web Slash Commands from the same gateway capability catalog.
- `cli-interactive-command-flows`: CLI adapts Web click/menu flows to keyboard pickers and confirmation prompts.

### Modified Capabilities

- `ink-cli-session-ui`: expands from reduced V1 to Web Session UI parity for chat/session/command operations.
- `shared-terminal-view-model`: expands beyond rows into cards, command output, status summaries, and interaction descriptors.
- `cli-session-source`: gains owner selection, room-scoped creation/navigation, and action execution needed by Web Slash Commands.

## Impact

- **Code:** `src/session-ui`, `src/apps/chat-ui/src/session-views/compact-terminal`, `src/apps/cli-ui`, `src/cli-session`, `src/core/session-router`, `src/apps/chat/web-app`, and tests.
- **APIs / CLI:** `pibo tui:sessions` keeps the same command name but adds room-first navigation and more Slash Commands.
- **Data:** CLI-created sessions must write room/session/navigation/event-log records so Web UI can show them immediately.
- **Auth / Security:** The host-root CLI is an explicit recovery/admin surface. It may impersonate local owner scopes after an in-terminal selection, must show the active owner clearly, must never silently fall back to `user:unknown`, and must redact secrets in status/error output.
- **Docs:** Update CLI docs, Web parity notes, and PRDs for the V2 implementation batches.
