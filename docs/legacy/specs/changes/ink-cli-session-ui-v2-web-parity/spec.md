# Spec: Ink CLI Session UI V2 Web Parity

**Status:** Implemented with follow-up rendering gaps  
**Created:** 2026-05-16  
**Owner / Source:** User follow-up after testing `pibo tui:sessions` V1 over SSH  
**Related docs:** `proposal.md`, `design.md`, `../ink-cli-session-ui/spec.md`, `docs/reports/ink-cli-session-subset-report.md`, `../ink-cli-terminal-rendering-parity/spec.md`

## Why

`pibo tui:sessions` V1 can now send messages and receive agent replies, but it does not match the Web Compact Terminal View. It also lacks Web Slash Commands, room-first navigation, room-scoped session creation, and terminal adaptations of Web interactive controls.

Users need a terminal UI that feels like the Web Session UI, works over SSH, and keeps sessions organized in the same rooms shown by Web Chat.

## Goal

Upgrade `pibo tui:sessions` from a reduced chat subset into a room-aware Ink terminal that shares Web Compact Terminal View logic and supports the Web Chat Slash Command surface with keyboard-native interactions.

## Background / Current State

### Implemented today

- `pibo tui:sessions` exists and renders with Ink.
- The default local source now uses a real `PiboSessionRouter`, shared data store, plugin registry, and custom agent registry.
- Messages sent through CLI can receive agent replies.
- Custom agents such as `pibo-agent` appear in the agent picker.
- Existing event-log history can be hydrated into the CLI trace.
- `buildCompactTerminalRows()` already lives under `src/session-ui` and is consumed by both Web Compact Terminal View and Ink CLI.

### Gaps today

> 2026-05-17 update: Owner scope, room navigation, slash catalog, routed local source, Root recovery selection, and several shared descriptors have been implemented. The main remaining gap is rendering parity: some command results still render as top-level CLI messages rather than chronological Compact Terminal rows, and the Ink visuals do not yet fully conform to `TERMINAL_DESIGN.md`. The follow-up change is `docs/specs/changes/ink-cli-terminal-rendering-parity/`.

- The Ink UI is visually and structurally separate from the Web Compact Terminal View.
- Only compact terminal rows are shared. Web card components such as status/model/login/thinking cards are DOM-specific and not shared as headless view models.
- CLI Slash Commands are a fixed V1 subset: `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, `/quit`.
- Web Slash Commands are dynamic from gateway capabilities and include commands such as `/status`, `/compact`, `/session`, `/clear`, `/abort`, `/kill`, `/kill-all`, `/thinking`, `/fast`, `/session-current`, `/sessions`, `/fork-candidates`, `/clone`, `/login`, `/model`, plus Web-added commands like `/download`, `/upload`, and `/thinking-show`.
- CLI sessions created without `--owner-scope` can be stored under `user:unknown`; Web UI filters by the authenticated user owner scope, so those sessions do not appear in Web navigation even when the room id is correct.
- The CLI has no owner/profile selection even though it runs as host root outside Web Auth and should be a recovery surface for multiple local users.
- `/session` shows a flat session list, not room-first navigation.
- `/new` does not require an explicit room and can create sessions that are not clearly visible in the Web room/sidebar structure.
- Interactive Web actions that rely on clicking, such as thinking level selection, model selection, and login menus, do not have CLI picker equivalents.
- Status output is mostly a single text line and does not show the richer status cards, quota/progress bars, and runtime summaries from Web.

## Scope

### In Scope

- Host-root owner/profile selection for CLI recovery and multi-user operation.
- Explicit Root recovery owner fallback when no Web-authenticated users exist.
- Room-first CLI navigation for startup, `/session`, and `/new`.
- Web-visible CLI-created sessions with correct room/session/navigation/event-log records.
- Shared headless terminal view models for rows, cards, status summaries, command menus, and command results.
- Ink renderers that visually match the Web Compact Terminal View as closely as terminal constraints allow.
- CLI support for the Web Slash Command catalog that is safe and meaningful in a terminal.
- Keyboard adaptations for Web interactive controls.
- Slash command suggestions while typing `/`.
- Status cards with context/quota/progress bars when data is available.
- Tests for shared model parity, CLI command behavior, room organization, and pseudo-TTY rendering.

### Out of Scope

- Full Web UI DOM/CSS reuse inside Ink — Ink cannot render browser DOM components.
- Mouse-only CLI interactions — every interaction must have keyboard controls.
- Agent Designer editing in CLI — CLI may select existing agents, but editing agents remains Web-only unless separately specified.
- Project/Workflow/Cron/Ralph management screens — V2 focuses on Session UI parity, not full product-area parity.
- File upload UX identical to browser drag/drop — CLI may support path-based upload instead.

## Requirements

### Requirement: CLI selects an effective owner scope before showing rooms

The CLI MUST resolve an explicit effective owner scope before listing rooms, listing sessions, creating sessions, or executing session actions.

#### Current

`pibo tui:sessions` can run without `--owner-scope`. In that case sessions may be created with no real owner and downstream navigation can fall back to `user:unknown`. Web UI then hides the session because Web filters by the authenticated user owner scope.

#### Target

When the CLI runs as host root outside Web Auth, it acts as a recovery/admin UI. It discovers known local Pibo owner scopes, lets the operator choose one, and then continues as that owner. If no Web users/owner scopes exist, it creates or uses a stable local Root recovery owner scope with no email address.

#### Acceptance

- Startup never silently uses `user:unknown` for new sessions.
- If more than one owner scope exists, startup shows an owner picker before room selection unless `--owner-scope` is supplied.
- If exactly one owner scope exists, the CLI may select it automatically but must show it in the status/header and `/status`.
- If no owner scope exists, the CLI uses a stable Root recovery owner scope and creates/uses that owner's Personal Chat room.
- All subsequent rooms, sessions, agents, slash actions, and `/new` behavior are scoped to the selected owner.

#### Scenario: Web user is selected

- GIVEN the local data store contains owner scope `user:ueR3mwuqBMPNTber3xuTwLmODbUlF4Sa`
- AND the CLI operator selects that owner
- WHEN the operator runs `/new` in Personal Chat and sends a message
- THEN the created session, session navigation row, user message, assistant message, and events use that owner scope
- AND the session appears in the Web UI for that user.

#### Scenario: No Web users exist

- GIVEN the local data store has no known Web owner scopes
- WHEN the operator starts `pibo tui:sessions`
- THEN the CLI creates or selects the Root recovery owner
- AND rooms/sessions created in that mode are isolated under the Root recovery owner scope, not `user:unknown`.

### Requirement: CLI can switch effective owner profiles

The CLI MUST provide a keyboard-native way to switch the effective owner profile during a recovery session.

#### Target

A command such as `/owner` or `/profile` opens an owner picker. After confirmation, the CLI reloads rooms and sessions for the selected owner.

#### Acceptance

- Owner switching clears or closes the previously open session unless that session belongs to the newly selected owner.
- Room and session pickers refresh for the newly selected owner.
- `/new` offers rooms owned by the selected owner.
- The header and `/status` show the active owner label/scope.
- The CLI does not allow accidentally sending a message to a session that belongs to a different owner than the active owner.

### Requirement: Shared terminal view model is the primary reuse boundary

The system MUST share terminal presentation logic through renderer-agnostic view models, not by importing Web DOM components into Ink.

#### Current

`buildCompactTerminalRows()` is shared. Most row/card rendering and interaction behavior is duplicated or Web-only.

#### Target

Shared code produces terminal rows, cards, status sections, menu descriptors, command result descriptors, tokens, tones, prefixes, progress values, and actions. Web and Ink each render those descriptors with their own renderer-specific components.

#### Acceptance

- Web Compact Terminal View and Ink CLI both consume shared `src/session-ui` models for transcript rows and rich cards.
- No `src/apps/cli-ui` file imports DOM-only packages such as `react-dom`, browser components, CSS modules, or `window`/`document` APIs.
- A parity test verifies that representative trace/status inputs produce the same shared model for both renderers.

#### Scenario: Shared thinking card model

- GIVEN a trace view with a thinking command/status node
- WHEN Web and Ink render it
- THEN both use the same shared thinking-card descriptor
- AND Web uses click controls while Ink uses arrow keys and Enter.

### Requirement: Ink renderer visually matches Web Compact Terminal View within terminal limits

The CLI MUST match the structure, labels, colors, status markers, and ordering of the Web Compact Terminal View as closely as terminal rendering allows.

#### Acceptance

- User, assistant, reasoning, tool call, tool status, yielded run, model, login, thinking, compaction, and error rows have terminal equivalents with matching labels and status meanings.
- Terminal output uses the same row grouping and collapsed/expanded semantics where feasible.
- Narrow terminals truncate or wrap predictably without hiding status/error meaning.
- Pseudo-TTY snapshot tests cover representative rows/cards.

### Requirement: CLI startup supports room-first session selection

The CLI MUST support a room-first startup flow when no explicit session id is provided.

#### Current

Startup opens the most recent session or shows a flat empty-state message.

#### Target

After owner selection, startup shows rooms for the active owner first, with that owner's Personal Chat as the default option. After selecting a room, the user sees sessions in that room and can open one or create a new session in that room.

#### Acceptance

- Running `pibo tui:sessions` without `--session` opens a room picker when multiple rooms are available.
- Personal Chat appears as the default/fallback room.
- Selecting a room shows sessions scoped to that room.
- Empty rooms offer a create-new-session action.

### Requirement: `/session` uses room then session selection

The `/session` command MUST first select a room, then select a session in that room.

#### Acceptance

- `/session` opens a room picker.
- Choosing a room opens a session picker filtered to that room.
- The user can go back from session picker to room picker with Escape or a Back item.
- Empty rooms show a clear message and a new-session option.

### Requirement: `/new` creates sessions in an explicit room

The `/new` command MUST create a session in a selected room.

#### Current

`/new` creates a session using `state.status?.activeRoomId`, which may be missing.

#### Target

If a room is active, `/new` creates the session there. If no room is active, `/new` opens a room picker. Personal Chat is preselected as the default.

#### Acceptance

- `/new` without an active room asks for a room before creating a session.
- `/new` with an active room creates a session in that room without another prompt.
- The created session uses the active owner scope and appears in that owner's Web UI room navigation after refresh or event update.
- User and assistant messages from the CLI session appear in Web trace/history.

### Requirement: CLI-created sessions are first-class Web sessions

Sessions created from the CLI MUST be visible and navigable in Web Chat under the same room.

#### Acceptance

- A CLI-created session is returned by Web bootstrap/navigation APIs.
- Opening `/sessions/<piboSessionId>` or `/rooms/<roomId>/sessions/<piboSessionId>` in Web displays the session.
- User messages, assistant messages, tool events, status, and last activity are stored in the same event-log/read-model tables used by Web Chat.
- No duplicate session/sidebar entries appear for the same CLI session.
- No CLI-created Web-visible session uses `user:unknown` unless an operator explicitly selects a legacy owner with that exact scope.

### Requirement: CLI exposes Web Slash Command catalog

The CLI MUST derive available session Slash Commands from the same gateway capability catalog as Web Chat, plus CLI-only commands.

#### Current

CLI has a hard-coded V1 Slash Command list.

#### Target

CLI command suggestions and command handling include supported Web session actions:

- `/status`
- `/compact [instructions]`
- `/session`
- `/clear`
- `/abort`
- `/kill`
- `/kill-all`
- `/thinking [level]`
- `/fast`
- `/session-current`
- `/sessions`
- `/fork-candidates`
- `/clone`
- `/login`
- `/model`
- terminal-supported equivalents for `/download`, `/upload`, and `/thinking-show`

The CLI may also keep CLI-only navigation commands:

- `/help`
- `/new`
- `/room`
- `/agent`
- `/owner` or `/profile`
- `/exit`
- `/quit`

#### Acceptance

- CLI suggestions and `/help` are generated from one shared command catalog.
- Unknown commands show a bounded, actionable error.
- Unsupported Web-only commands are listed as unavailable with a reason, not silently hidden.
- Every supported command has at least one behavior test.

### Requirement: Slash suggestions appear while typing

When the input starts with `/`, the CLI MUST show filtered command suggestions.

#### Acceptance

- Typing `/` shows all available commands with descriptions.
- Typing `/th` filters to matching commands such as `/thinking` and `/thinking-show`.
- Arrow keys move through suggestions; Enter accepts or runs according to the input state.
- Escape closes suggestions without losing the typed input unless pressed twice or explicitly cleared.

### Requirement: Interactive Web commands have keyboard-native CLI flows

Commands that return menus or require browser clicks MUST have equivalent CLI picker flows.

#### Acceptance

- `/thinking` without an argument opens a level picker with options such as default/current/off/minimal/low/medium/high/xhigh when supported.
- `/thinking <level>` directly sets the level and validates the value.
- `/model` opens provider then model pickers, preserving disabled/unavailable states.
- `/login` opens a provider/auth-method picker and prints/copies the URL or API-key instructions in a terminal-safe way.
- `/fast` toggles fast mode and shows the resulting mode.
- `/clone` opens the created session when the command returns a derived session id.
- Fork-related flows expose fork candidates and support keyboard selection where possible.

### Requirement: Status uses the shared rich status presentation

The CLI MUST render `/status` using shared status descriptors, including context usage and quota/progress bars when available.

#### Current

CLI status is a redacted single text line.

#### Target

CLI shows a terminal card with session id, profile, model, runtime state, queue/stream state, context usage, provider usage/quota, thinking level, fast mode, cwd, and relevant warnings.

#### Acceptance

- Context and quota values render as text bars in Ink and visual bars in Web from the same descriptor.
- Secrets are redacted.
- Missing data is shown as unavailable, not zero.
- Status card snapshot tests cover full, partial, and error states.

### Requirement: Keyboard navigation is consistent

The CLI MUST provide predictable keyboard controls for rooms, sessions, command suggestions, menus, and transcript focus.

#### Acceptance

- Up/Down moves selection.
- Enter confirms.
- Escape backs out one level or closes the current overlay.
- Ctrl+C exits cleanly.
- Help text shows the current overlay controls.

### Requirement: Web behavior remains unchanged

The implementation MUST preserve existing Web Chat behavior unless a requirement explicitly changes shared behavior.

#### Acceptance

- Web Chat typecheck/build/tests pass.
- Existing Web Compact Terminal View rendering remains visually compatible.
- Existing Web Slash Command behavior remains compatible.

## Edge Cases

- No owner scopes exist.
- One owner scope exists.
- Multiple owner scopes exist.
- Legacy sessions exist under `user:unknown`.
- An operator switches owner while a session is open.
- No rooms exist.
- Only Personal Chat exists.
- A selected room is archived or deleted while CLI is open.
- A selected session is archived, deleted, or changed by Web while CLI is open.
- The session runtime is not loaded yet when a command is executed.
- A command is unsupported by the active profile/provider.
- A command returns a browser-only action.
- Model or login provider catalog is empty.
- OAuth URL cannot be opened from SSH.
- Terminal width is very small.
- Terminal does not support color.
- Event log contains unknown row/card kinds.
- Large JSON or markdown values exceed terminal limits.
- Secrets appear in command output or errors.

## Constraints

- **Renderer separation:** Ink components and Web DOM components cannot be directly shared.
- **Shared model:** Reuse must happen through `src/session-ui` or another renderer-neutral module.
- **Security:** CLI output must redact secrets. Host-root owner impersonation is allowed only as an explicit local recovery/admin mode and must show the active owner before actions.
- **Compatibility:** Existing `pibo tui:sessions --session <id>` must keep working.
- **Performance:** The CLI must keep bounded rendering for large traces.
- **SSH-first:** All interactions must work without a mouse or browser, except OAuth flows that intentionally provide an external URL.

## Success Criteria

- [ ] SC-001: `pibo tui:sessions` resolves an explicit owner scope and never silently creates new sessions as `user:unknown`.
- [ ] SC-002: `pibo tui:sessions` can open owner picker -> room picker -> session picker -> transcript.
- [ ] SC-003: `/new` creates a Web-visible session in the selected owner's selected room.
- [ ] SC-004: CLI and Web share terminal rows plus rich card/status/menu descriptors.
- [ ] SC-005: CLI supports the Web Slash Command catalog where terminal-safe, with explicit unsupported reasons otherwise.
- [ ] SC-006: Slash suggestions work for `/` input and keyboard selection.
- [ ] SC-007: `/thinking`, `/model`, `/login`, `/fast`, `/compact`, `/clone`, `/abort`, `/kill`, and `/kill-all` have CLI behavior tests.
- [ ] SC-008: `/status` shows owner scope plus context/quota/progress bars from shared descriptors.
- [ ] SC-009: Web UI behavior and tests remain green.
- [ ] SC-010: Pseudo-TTY snapshots cover representative Web-parity terminal rendering.

## Assumptions and Open Questions

### Assumptions

- Host-root CLI access is trusted local recovery/admin access and may choose any locally known owner scope.
- The Root recovery owner is a local pseudo-user with no email and a stable owner scope chosen by implementation; it must not be `user:unknown`.
- Personal Chat maps to the selected owner's default chat room used by Web Chat, currently expected to be `room_default` where no more specific room applies.
- The Web Slash Command capability catalog remains the source of truth for session runtime actions.
- Some Web-only product areas remain out of scope even though their sessions may appear in the Web sidebar.
- Visual parity means semantic/layout parity within terminal constraints, not pixel identity.

### Open Questions

- What exact owner-scope string and display name should the local Root recovery owner use?
- Should CLI startup always show owner picker, or auto-select the last owner and provide `/owner` for switching?
- Should CLI startup always show room picker, or open the last selected room/session and provide `/room` for switching?
- Should `/agent` change only the default profile for new sessions, or attempt to patch sessions before first activity like Web does?
- Should `/upload` copy files into `~/.pibo/uploads` by path only, or support interactive file browsing?
- Should CLI persist per-user room/session selection like Web localStorage does, and where should it store that state?
- Which Web commands should be explicitly marked browser-only rather than adapted?

## Traceability

| Requirement | Future PRD area | Status |
|---|---|---|
| Owner/profile selection | Recovery owner and impersonation | Draft |
| Shared terminal view model | Shared model extraction | Draft |
| Web-parity Ink renderer | Ink renderer parity | Draft |
| Room-first navigation | Rooms and sessions | Draft |
| Web-visible CLI sessions | Data/runtime integration | Draft |
| Web Slash catalog | Slash commands | Draft |
| Command suggestions | Slash command UX | Draft |
| Interactive command flows | Keyboard menus | Draft |
| Rich status card | Status and telemetry | Draft |
| Web unchanged | Regression validation | Draft |
