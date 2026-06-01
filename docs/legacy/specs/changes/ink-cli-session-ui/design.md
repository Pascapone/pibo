# Design: Ink CLI Session UI

**Status:** Draft  
**Created:** 2026-05-16  
**Owner / Source:** `docs/reports/ink-cli-session-subset-report.md`  
**Related docs:** `proposal.md`, `spec.md`, `tasks.md`, `prds/README.md`

## Design Principles

1. **Web UI remains primary.** The CLI is a reduced session interface, not a parallel control center.
2. **Share data, not DOM.** Reuse trace/session models and compact terminal rows, not Web presentation components.
3. **Ink-native presentation.** Terminal UI uses Ink `Box`/`Text` and terminal-safe controls.
4. **Small V1 command set.** Keep the first CLI useful for sessions while excluding Web-only surfaces.
5. **Local/recovery first.** The CLI must be useful when Web UI or Web Gateway is unavailable.
6. **Phased implementation.** Build shared model, then static renderer, then interactivity, then hardening.

## Target Architecture

```text
                    ┌──────────────────────────┐
                    │ Pibo runtime/session data │
                    │ stores/router/events      │
                    └─────────────┬────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ PiboSessionTraceView      │
                    └─────────────┬────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ shared terminal view model│
                    │ buildCompactTerminalRows  │
                    └───────┬──────────┬───────┘
                            │          │
                            ▼          ▼
              ┌─────────────────┐ ┌─────────────────┐
              │ Web renderer     │ │ Ink renderer     │
              │ existing DOM UI  │ │ new CLI UI       │
              └─────────────────┘ └─────────────────┘
```

## Proposed Module Boundaries

### Shared terminal model

Possible path:

```text
src/session-ui/
  terminalRows.ts
  terminalValue.ts
  terminalTypes.ts
```

Responsibilities:

- Convert `PiboSessionTraceView` into compact rows.
- Normalize values for previews/details.
- Avoid renderer dependencies.
- Expose stable row/line/token/detail types.

Compatibility approach:

- Existing Web files may temporarily re-export shared modules to reduce import churn.
- Web component code should import the shared model without changing rendering.

### Ink CLI app

Possible path:

```text
src/apps/cli-ui/
  InkSessionApp.tsx
  InkTerminalView.tsx
  InkTerminalRow.tsx
  InkTerminalLine.tsx
  InkDetailsPanel.tsx
  InkSlashCommandPalette.tsx
  InkSessionPicker.tsx
  InkAgentPicker.tsx
  InkStatusBar.tsx
  inkColors.ts
  inkJson.ts
  inkMarkdown.ts
```

Responsibilities:

- Render status, transcript, pickers, input, and details.
- Convert row tones/statuses to Ink colors and symbols.
- Keep row output bounded.
- Use keyboard input and focus management.
- Avoid Web-specific dependencies.

### CLI session controller

Possible path:

```text
src/cli-session/
  controller.ts
  commands.ts
  sessionSource.ts
  localSessionSource.ts
```

Responsibilities:

- Own app state outside rendering details.
- Parse Slash Commands.
- Create/select sessions.
- List agents/profiles.
- Subscribe to trace/session updates.
- Send user messages.
- Clean up on exit.

## SessionSource Interface

The CLI should depend on a small interface instead of hardcoding Web or local runtime details.

Conceptual shape:

```ts
type CliSessionSource = {
  listRooms(): Promise<readonly CliRoom[]>;
  listSessions(roomId?: string): Promise<readonly CliSessionSummary[]>;
  createSession(input: CreateCliSessionInput): Promise<CliSessionSummary>;
  openSession(sessionId: string): Promise<CliOpenSession>;
  sendMessage(sessionId: string, text: string): Promise<void>;
  listAgents(): Promise<readonly CliAgentSummary[]>;
  setSessionAgent(sessionId: string, agentId: string): Promise<void>;
  getStatus(): Promise<CliRuntimeStatus>;
  close(): Promise<void>;
};
```

`CliOpenSession` should expose:

- current `PiboSessionTraceView | null`,
- session metadata,
- subscribe/unsubscribe for updates,
- current status/error.

V1 recommendation: implement a local/direct session source first. Keep Gateway-backed mode as a later implementation behind the same interface.

## Command Routing

Slash Commands should be parsed before normal message sending.

V1 commands:

| Command | Behavior |
|---|---|
| `/help` | Show supported CLI commands and Web-only limitations. |
| `/new` | Start new session flow. |
| `/session` | Open room/session picker. |
| `/agent` | Open agent/profile picker. |
| `/status` | Show current source/session/agent/model state. |
| `/clear` | Clear local rendered transcript window only; does not delete session. |
| `/exit` | Exit CLI. |
| `/quit` | Exit CLI. |

Unknown commands produce a terminal error row/message and are not forwarded as normal chat text.

## Rendering Design

### Layout

```text
StatusBar
TranscriptViewport
InputLine / Picker / DetailsPanel
```

### Transcript

- Input: shared compact rows.
- Output: Ink rows with symbols/colors.
- Default: tail window of recent rows.
- Scroll: optional PageUp/PageDown over bounded in-memory row list.
- Details: selected row can open a text details panel in later V1/v1.1 if needed.

### Markdown

V1 markdown handling should be plain and terminal-safe:

- paragraphs as text,
- lists as `-`,
- code fences as indented blocks,
- links as `label (url)`,
- no browser HTML renderer.

### JSON

V1 JSON handling:

- pretty print bounded JSON,
- truncate long values,
- no interactive JSON tree required.

### Icons

Use terminal-safe symbols:

- `›` prompt/user input,
- `•` tool/action,
- `✓` done,
- `✕` error,
- `…` running,
- `↳` delegated/session relation.

## Web UI Integration Strategy

The Web UI should continue to use existing React DOM components. Any shared model extraction must be minimal:

1. Move or copy row model into UI-neutral module.
2. Update Web imports.
3. Keep Web rendering code unchanged.
4. Add tests proving row output did not change.

The Web UI must not import Ink modules.

## Testing Strategy

- Unit tests for Slash Command parsing.
- Unit tests for shared terminal row generation fixtures.
- `renderToString()` tests for Ink row rendering.
- Controller tests with fake `CliSessionSource`.
- Build/typecheck for root and Chat Web.
- Manual smoke test in TTY.
- Non-TTY failure/fallback test.

## Security and Privacy

- Do not print hidden secrets from config, auth, or provider state.
- Do not expand full tool args/results by default beyond existing row/detail preview limits.
- Use explicit details view for larger output, still bounded.
- Treat local CLI as operating in local owner scope unless a later Gateway/auth spec changes this.

## Migration and Compatibility

- Existing `pibo tui` and `pibo tui:routed` continue to work.
- New command discovery should explain the difference between direct Pi TUI, local routed TUI, and new CLI Session UI.
- If a command name later replaces an old one, add alias/deprecation docs in a separate migration task.

## V1 Design Decisions and Open Questions

### Decisions

- Final V1 command name: `pibo tui:sessions`.
- V1 source mode is local/direct first; the `CliSessionSource` boundary remains Gateway-/hybrid-ready for later work.
- V1 Slash Commands are `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, and `/quit`.
- `/model`, `/thinking`, `/fork`, and `/details` are later-scope commands unless separately approved.

### Open Questions

- Exact local room semantics.
- Default transcript row limit and scroll behavior.
