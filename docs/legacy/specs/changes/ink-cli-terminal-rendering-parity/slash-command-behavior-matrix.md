# Slash Command Behavior Matrix

**Date:** 2026-05-18  
**Scope:** PRD 12 Web-derived command, picker, and room/session label parity for `pibo tui:sessions`.

Web Compact Terminal remains the behavior/design reference. The TUI adapts command outcomes to terminal-native transcript rows and overlays; it does not change Web rendering.

## Rules

- Slash palette rows are visible for all static CLI-only, Web-parity, terminal-adapted, unsupported/deferred, and dynamic gateway commands unless a gateway marks a capability hidden.
- Command results append chronological transcript rows, except commands that open a picker/overlay, mutate navigation, or exit.
- Picker overlays do not append transcript rows until the user confirms an action.
- Room/session labels prefer canonical room titles and session titles. Raw IDs are secondary/fallback metadata.
- Errors, unsupported results, previews, details, picker descriptions, and PTY artifacts are redacted before display.

## Static command matrix

| Command | Family | Arguments | Enter behavior | Result placement | Context | Error behavior |
|---|---|---|---|---|---|---|
| `/help` | CLI-only | none | Show command help and keyboard controls | Guidance text | none | Redacted guidance/error |
| `/new` | CLI navigation | none | Create a session in the active room or selected room | Navigation/session open | owner + room | Redacted error row/message |
| `/room` | CLI navigation | none | Open room picker | Overlay | owner | Compact picker error/cancel |
| `/session` | CLI navigation | none | Open room/session picker flow | Overlay | owner + room | Compact picker error/cancel |
| `/agent` | CLI navigation | none | Open agent/profile picker | Overlay | active session | Compact picker error/cancel |
| `/owner` | CLI navigation | none | Open owner picker | Overlay | local/Web owner store | Compact picker error/cancel |
| `/profile` | Alias | none | Alias for `/owner` | Overlay | local/Web owner store | Compact picker error/cancel |
| `/repair-user-unknown` | CLI recovery | optional internal target data | Repair legacy `user:unknown` CLI sessions | Transcript | selected owner + room | Redacted command error row |
| `/exit` | CLI-only | none | Exit TUI | Exit | none | best-effort cleanup |
| `/quit` | CLI-only | none | Exit TUI | Exit | none | best-effort cleanup |
| `/status` | Web parity | none | Dispatch status action or local status | Transcript status row | active session when available | Redacted command error row |
| `/compact` | Terminal-adapted | optional custom instructions | Dispatch compaction | Transcript | active routed session/runtime | Redacted command error row |
| `/clear` | Terminal-adapted | none | Dispatch queue clear and clear local display where applicable | Transcript | active routed session/runtime | Redacted command error row |
| `/abort` | Terminal-adapted | none | Abort active response | Transcript | active routed session/runtime | Redacted command error row |
| `/kill` | Terminal-adapted | none | Dispose active runtime | Transcript | active routed session/runtime | Redacted command error row |
| `/kill-all` | Terminal-adapted | none | Dispose owner runtimes when supported | Transcript | selected owner/runtime | Redacted command error row |
| `/fast [on|off]` | Terminal-adapted | `on`/`off` optional | Toggle fast mode | Transcript | active routed session/runtime | Redacted command error row |
| `/thinking [level]` | Terminal-adapted | level optional | No arg opens picker; arg applies setting | Overlay or transcript | active routed session/runtime | Overlay stays compact or redacted result row |
| `/model` | Terminal-adapted | provider/model optional | No arg opens provider/model pickers; arg applies model | Overlay or transcript | active routed session/runtime | Overlay stays compact or redacted result row |
| `/login` | Terminal-adapted | provider/method optional | No arg opens provider/auth pickers; arg starts terminal-safe auth instructions | Overlay or transcript | active routed session/runtime | Overlay stays compact or redacted result row |
| `/session-current` | Terminal-adapted | none | Show active session metadata with named room context | Transcript | active session | Redacted unsupported/error row |
| `/sessions` | Terminal-adapted | none | List sessions for selected owner/room with named room context | Transcript | selected owner/room | Redacted unsupported/error row |
| `/clone` | Terminal-adapted | none | Clone/derive current session when supported | Transcript + session open | active session | Redacted unsupported/error row |
| `/fork-candidates [entry-id]` | Terminal-adapted | entry id optional | No arg opens/list candidates; entry id dispatches fork | Overlay or transcript | active session | Overlay stays compact or redacted result row |
| `/download <path>` | Terminal-adapted | server path required | Show terminal-safe copy instructions | Transcript | terminal path | Redacted usage/unsupported row |
| `/upload <path>` | Terminal-adapted | local/server path required | Show terminal-safe upload instructions | Transcript | terminal path | Redacted usage/unsupported row |
| `/thinking-show` | Deferred Web command | none | Explain terminal adaptation (`/thinking`) | Transcript | none | Compact unsupported/deferred row |

## Dynamic gateway commands

Dynamic gateway capabilities are merged into the same catalog by slash command. A hidden capability is excluded. A browser-only/product-area/deferred capability appears in the slash palette as unavailable and appends a compact unsupported transcript result if run. A supported gateway capability dispatches its action and renders the normalized command result as a transcript row or a terminal-native menu overlay when the result descriptor is a menu.

## Picker semantics

- Owner → room → session is the primary navigation flow.
- `Esc` closes a top-level picker; nested command pickers and room/session pickers return to their parent picker.
- `↑`/`↓` move selection; `Enter` confirms.
- Room picker labels use room titles first and keep IDs in secondary metadata.
- Session picker labels use session titles first. `+ New session in <Room Name>` uses the resolved room title.
- Model, login, thinking, and fork-candidate choices remain overlays until confirmed.

## Validation ownership

- PRD12 US-001 owns catalog/matrix coverage tests.
- PRD12 US-002/US-003 own canonical room/session label resolution in local and fake sources plus command result rendering.
- PRD12 US-004 owns picker overlay reducer/render tests.
- PRD12 US-005 owns PTY/default-path evidence for slash, room, session, status, and runtime command flows.
