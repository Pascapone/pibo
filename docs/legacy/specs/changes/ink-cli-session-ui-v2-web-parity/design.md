# Design: Ink CLI Session UI V2 Web Parity

## Context

V1 proved that Ink can run over SSH and that the CLI can use the real local session router. It also exposed two architectural gaps: owner scope resolution and shared terminal parity. The CLI runs outside Web Auth, so it can create sessions under the wrong owner when no owner is selected. The Web and CLI also currently share compact terminal rows, but the rich Web terminal experience still lives in DOM-specific React components and Web-only command handling.

The V2 design should avoid trying to render Web DOM components in Ink. Instead, it should move shared behavior into renderer-neutral models and let Web and Ink render those models separately.

## Goals

- Share terminal presentation logic between Web and CLI through headless view models.
- Keep Web and Ink renderers separate but behaviorally aligned.
- Resolve an explicit effective owner scope so CLI sessions appear for the intended Web user or Root recovery profile.
- Make room/session organization identical enough that CLI sessions appear in Web rooms.
- Drive Slash Commands from the same capability catalog used by Web.
- Adapt click flows to keyboard flows without losing functionality.

## Non-Goals

- Pixel-perfect Web CSS rendering in a terminal.
- Importing Web DOM components into `src/apps/cli-ui`.
- Rebuilding full product areas such as Workflows, Cron, Ralph, or Agent Designer in CLI.
- Mouse-dependent terminal UI.

## Decisions

### Decision: Treat host-root CLI as explicit recovery/admin impersonation

- **Choice:** `pibo tui:sessions` resolves an effective owner scope before room/session navigation. It discovers known owner scopes from local Web/session data, offers a picker when needed, and supports an explicit Root recovery owner when no Web user exists.
- **Rationale:** The CLI runs as root on the host and is primarily a backup/recovery surface. It must be able to continue as a selected user, but it must not silently create `user:unknown` sessions that Web filters out.
- **Implications:** All room lists, session lists, custom agents, actions, and `/new` calls are scoped to the selected owner. The active owner appears in the header and status card.
- **Alternatives considered:** Require `--owner-scope` for every CLI launch. Rejected because recovery usage should remain usable from SSH without copying an opaque id, though `--owner-scope` should still be supported for automation.

### Decision: Reuse through headless `session-ui` models

- **Choice:** Extend `src/session-ui` so it owns shared terminal rows, cards, command catalog descriptors, status descriptors, menu descriptors, and formatting helpers.
- **Rationale:** Ink and DOM cannot share components directly, but they can share data models, grouping rules, labels, tokens, status semantics, and validation.
- **Alternatives considered:** Import Web components into Ink. Rejected because Web components depend on DOM/CSS/browser APIs.

### Decision: Keep renderer-specific components thin

- **Choice:** Web components in `src/apps/chat-ui/src/session-views/compact-terminal` and Ink components in `src/apps/cli-ui` should mainly map shared descriptors to renderer primitives.
- **Rationale:** This creates parity without forcing a lowest-common-denominator UI.
- **Trade-off:** Some duplication remains in layout primitives and keyboard/mouse handling.

### Decision: Add room-aware source contracts

- **Choice:** Expand `CliSessionSource` behavior around rooms instead of having the Ink app infer room state from sessions.
- **Expected contract additions:**
  - list rooms with Personal Chat/default room metadata
  - list sessions by room
  - create session in room
  - expose active room/session
  - notify room/session navigation changes
- **Rationale:** The source knows how local data maps to Web navigation. The UI should not duplicate storage rules.

### Decision: Add action execution to the CLI source

- **Choice:** The CLI source should expose session actions from the routed gateway capability catalog.
- **Expected contract additions:**
  - list slash commands/actions for active session
  - execute action with parsed params
  - normalize action results into shared command-result descriptors
- **Rationale:** Web already posts actions through route/session APIs. CLI needs equivalent runtime access without hard-coding every action.

### Decision: Build command UX as descriptors

- **Choice:** Slash suggestions, help text, unsupported reasons, command arguments, and interactive menus are shared descriptors.
- **Rationale:** Web and CLI should not drift on command names/descriptions.
- **Example:** `/thinking` descriptor says it accepts optional `level`. Web renders clickable levels; Ink renders an arrow-key picker.

### Decision: Model room-first navigation as a stacked overlay state machine

- **Choice:** The Ink app should use one overlay stack for rooms, sessions, slash suggestions, command menus, confirmations, and details.
- **Controls:** Up/Down move, Enter confirms, Escape goes back, Ctrl+C exits.
- **Rationale:** V1 picker state is too narrow for nested flows such as room -> session and provider -> model.

### Decision: Persist CLI-created sessions through Web read-model paths

- **Choice:** Session creation and message/action events should update the same session, navigation, event-log, message, and observation stores used by Web.
- **Rationale:** Web visibility is a product requirement. Separate CLI-only state is not acceptable.
- **Migration:** Existing V1 CLI sessions without room metadata should be shown under Personal Chat or repaired lazily when opened.

## Proposed Modules

```text
src/session-ui/
  terminalRows.ts             # already shared
  terminalCards.ts            # shared status/model/login/thinking card descriptors
  commandCatalog.ts           # shared slash command descriptors and filtering
  commandResults.ts           # normalize gateway action results for rendering
  ownerViewModel.ts           # shared owner/profile picker descriptors
  roomSessionViewModel.ts     # shared room/session picker descriptors
  statusViewModel.ts          # context/quota/progress/status formatting

src/apps/chat-ui/src/session-views/compact-terminal/
  *.tsx                       # Web renderers for shared descriptors

src/apps/cli-ui/
  InkSessionApp.tsx           # app shell and overlay state
  InkTerminalView.tsx         # transcript renderer
  InkCards.tsx                # Ink renderers for shared cards
  InkCommandPalette.tsx       # slash suggestions and command menus
  InkRoomSessionPicker.tsx    # room/session navigation

src/cli-session/
  source contracts            # owner/room/action/status capabilities
  local source                # owner-scoped Web-visible persistence and router actions
```

## Interaction Design

### Startup

1. Resolve the effective owner scope.
   - If `--owner-scope` is provided, use it after validating/localizing the owner label.
   - If one owner exists, select it automatically and show it.
   - If multiple owners exist, show owner picker.
   - If no owner exists, create/use Root recovery owner.
2. If `--session <id>` is provided, verify that it belongs to the effective owner or ask for confirmation/owner switch.
3. Otherwise load rooms for the effective owner.
4. If a persisted CLI selection exists for that owner and still exists, optionally open it.
5. Otherwise show room picker.
6. Selecting a room shows sessions in that room and a `+ New session in this room` item.

### `/owner` or `/profile`

1. Open owner picker.
2. Select Web user owner or Root recovery owner.
3. Clear active room/session unless still valid for the selected owner.
4. Load rooms for the new owner.

### `/session`

1. Open room picker.
2. Select room.
3. Open session picker filtered by room.
4. Select session or create a new one.

### `/new`

1. Use the active owner scope.
2. If an active room exists, create in that room.
3. If not, open that owner's room picker with Personal Chat selected.
4. Create and open the session.
5. Persist owner scope, room id, navigation row, and event data needed for Web navigation.

### Slash suggestions

1. Input starts with `/`.
2. Shared catalog filters commands by prefix.
3. Ink shows a suggestion list above the input.
4. Enter accepts the selected command if the input is only a prefix, or runs the full command when complete.

### `/thinking`

- `/thinking high` runs directly.
- `/thinking` opens a picker:
  - current/default
  - off
  - minimal
  - low
  - medium
  - high
  - xhigh
- Enter posts the action.

### `/model`

1. Load model menu action result.
2. Select provider.
3. Select model.
4. Confirm and apply when supported by runtime action flow.

### `/login`

1. Load provider/auth-method menu.
2. Select provider.
3. Select auth method.
4. For OAuth, print URL and completion instructions.
5. For API key, prompt for hidden input if supported, or show command/instruction.

### `/status`

Render a shared status card:

- effective owner label/scope
- session id/title/profile
- active model
- runtime state
- queue/stream flags
- cwd
- context usage bar
- provider usage/quota bar if available
- thinking level
- fast mode
- warnings/errors

## Testing Strategy

- Unit tests for shared command catalog filtering and descriptors.
- Unit tests for shared status/card descriptors.
- Unit tests for room/session source behavior and Web-visible persistence.
- Integration tests for CLI source action execution against a fake router/action catalog.
- Pseudo-TTY smoke tests for startup, room picker, slash suggestions, and status rendering.
- Snapshot-like string tests for representative Ink rows/cards.
- Web regression tests for Compact Terminal View and Slash Command behavior.
- Full `npm test` before merge/deploy.

## Risks / Trade-offs

- Rich parity may require several PRDs; one Ralph job may be too broad unless split into stories.
- Some Web actions may rely on browser-only affordances. These need explicit terminal equivalents or unsupported reasons.
- Shared descriptors must not become so generic that Web loses quality.
- Status/quota data may not always be available from local CLI runtime; missing values must be represented clearly.

## Migration / Rollback

- Keep `pibo tui:sessions --demo` as a deterministic smoke path.
- Keep `--session <id>` direct-open behavior.
- Existing V1 sessions without owner metadata or with `user:unknown` should not be selected for new writes by default. A repair or reassignment path should let an operator move legacy CLI sessions to the intended owner.
- Existing V1 sessions without room metadata should be treated as Personal Chat in the CLI and Web navigation after owner resolution.
- If V2 action execution fails, users can still send normal messages and use basic navigation.
- Rollback can revert the command to V1 behavior without data migration if new metadata is additive.

## Open Questions

- What exact canonical owner scope should identify Root recovery owner?
- How should the CLI discover Better Auth users that have no sessions yet?
- Should legacy `user:unknown` sessions be repaired automatically after owner selection, or only through an explicit repair prompt?
- Should CLI persist last selected owner/room/session globally or per owner scope?
- Which exact Web action results require new shared descriptors before implementation starts?
- Should `/agent` patch existing inactive sessions like Web, or only set the default for new sessions?
- Should terminal OAuth completion be handled by polling, manual code paste, or both?
