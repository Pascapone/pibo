# PRD 12: Slash Commands, Room/Session Resolution, and Pickers

**Status:** Draft  
**Created:** 2026-05-17  
**Related docs:** `../web-terminal-reference-audit.md`, `../spec.md`, `src/session-ui/commandCatalog.ts`, `src/session-ui/roomSessionViewModel.ts`

## 1. Executive Summary

### Problem Statement

The TUI has slash-command support, but behavior still diverges from Web Terminal. Some command results are too generic, some picker flows do not resolve labels consistently, and room IDs can appear where Web shows named rooms. The user specifically observed that room names are not visible/resolved correctly.

### Proposed Solution

Define and implement a complete slash-command behavior matrix. Resolve room and session labels through the same canonical room/session data used by Web where available. Ensure every command either appends a transcript result, opens a terminal overlay, changes navigation state, or reports a clear unsupported/deferred result.

### Success Criteria

- SC-12-01: Every command in `CLI_ONLY_SLASH_COMMANDS` and `WEB_PARITY_SLASH_COMMANDS` has documented TUI behavior and tests.
- SC-12-02: Room pickers, headers, session pickers, `/sessions`, `/session-current`, `/clone`, `/fork-candidates`, repair messages, and session-link rows show room names when available and IDs only as secondary/fallback metadata.
- SC-12-03: Room/session data is resolved from canonical local stores/services, not guessed from stale IDs when a name exists.
- SC-12-04: Unsupported/browser-only/deferred commands render compact transcript results or palette states without breaking flow.

## 2. Command Behavior Matrix

Commands to cover:

- CLI/navigation: `/help`, `/new`, `/room`, `/session`, `/agent`, `/owner`, `/profile`, `/repair-user-unknown`, `/exit`, `/quit`.
- Runtime/session parity: `/status`, `/compact`, `/clear`, `/abort`, `/kill`, `/kill-all`, `/fast [on|off]`, `/thinking [level]`, `/model`, `/login`, `/session-current`, `/sessions`, `/clone`, `/fork-candidates [entry-id]`, `/download <path>`, `/upload <path>`, `/thinking-show`.
- Dynamic gateway capabilities returned by the active source.

For each command define:

- visible slash palette row
- Enter behavior with and without arguments
- whether it appends transcript rows, opens overlay/picker, mutates navigation, exits, or returns unsupported
- required room/session/owner context
- error behavior
- Web parity note or terminal adaptation
- PTY/default-path validation requirement

## 3. Room/Session Naming Requirements

- `CliRoomSummary.title` is the primary room display value.
- Room IDs are secondary metadata and should appear as `room <id>` only when useful, not as the main label if a title exists.
- Session summaries should include title, room title, status, model/profile when available, and ID as secondary metadata.
- Header/status/navigation messages should prefer `Room Name` over `room_xxx`.
- `/sessions`, `/session-current`, `/clone`, `/fork-candidates`, and session-link descriptors should resolve `roomId` to room title when possible.
- When a room is renamed in Web, the TUI should show the renamed value after refresh/reopen.
- Missing room names fall back to ID with an explicit fallback test.

## 4. Picker/Overlay Requirements

- Owner → room → session flow mirrors Web navigation semantics.
- Room picker marks active/default/archived rooms.
- Session picker shows `+ New session in <Room Name>` and existing sessions with room title context.
- Agent/model/login/thinking/fork candidate pickers remain compact overlays, not transcript dumps.
- Overlay text is redacted and does not truncate labels by character budget.

## 5. Validation

- Unit/controller tests for every command path.
- Shared room/session view model tests for label resolution.
- PTY smoke for `/room`, `/session`, `/sessions`, `/session-current`, `/status`, and at least one runtime command.
- Real/default local source path validates a renamed Web room when feasible; otherwise test fixture documents why real store setup is deferred.

## Web UI Preservation Gate

Web Compact Terminal is the reference surface and must not be changed to accommodate Ink. Ink must adapt to Web semantics. Any change under `src/session-ui/**` is Web-impacting and requires Web Compact Terminal regression evidence. Direct changes under `src/apps/chat-ui/src/session-views/compact-terminal/**` are allowed only for tests or stable semantic hooks unless the user explicitly approves a Web behavior change.

