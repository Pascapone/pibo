# Ink CLI Session UI V2 Current-State Audit

**Date:** 2026-05-17  
**Change:** `docs/specs/changes/ink-cli-session-ui-v2-web-parity/`  
**Purpose:** Establish the current Web/Ink sharing surface, V2 parity scope, command inventory, and owner-scope guardrails before feature implementation.

## Summary

`pibo tui:sessions` currently has a real local source path and shares compact transcript row construction with Web Chat, but it remains a V1 reduced terminal UI. V2 should keep shared presentation logic in renderer-neutral `src/session-ui` modules, keep Web DOM and Ink renderers separate, and resolve an explicit owner scope before room/session writes.

Key findings:

- `src/session-ui/terminalRows.ts` and `src/session-ui/terminalValue.ts` are already shared by Web Compact Terminal and Ink.
- Rich Web cards for status, thinking, model, login, details, and JSON rendering remain DOM-specific under `src/apps/chat-ui/src/session-views/compact-terminal/`.
- Ink rendering lives under `src/apps/cli-ui/` and currently renders shared rows plus a small V1 command set.
- CLI local runtime integration lives in `src/cli-session/` and is wired from `src/apps/cli-ui/cliSessionsCommand.ts` to `PiboSessionRouter`, `PiboDataStore`, `PiboDataSessionStore`, and the plugin registry.
- If `pibo tui:sessions` runs without `--owner-scope`, `LocalCliSessionSource.createSession()` passes no owner to the session store. The persistent data session store writes `user:unknown`, and the ingest/navigation path can also write `session_navigation.owner_scope = user:unknown`. Web bootstrap filters sessions by the authenticated `webSession.ownerScope`, so these sessions are hidden from that user.

## Current shared terminal surface

| Module | Current responsibility | Current consumers | V2 gap |
| --- | --- | --- | --- |
| `src/session-ui/terminalRows.ts` | Builds `CompactTerminalRow` records from `PiboSessionTraceView`; defines row kinds, statuses, inline tokens, detail items, grouping, compact transcript semantics. | Web: `CompactTerminalSessionView.tsx`, `TerminalLine.tsx`, `TerminalDetails.tsx`, card components. Ink: `InkSessionApp.ts`, `InkTerminalView.ts`, `InkTerminalRow.ts`, `InkTerminalLine.ts`, `inkColors.ts`. Tests: `session-ui-terminal-rows.test.mjs`, CLI renderer/source tests. | It only models transcript rows. V2 needs renderer-neutral card, status, command result, command catalog, and picker descriptors. |
| `src/session-ui/terminalValue.ts` | Converts unknown values into safe/renderable text/JSON values for terminal details. | Web details/value re-export, Ink detail rendering, tests. | V2 should reuse this from command result/status descriptors and ensure secret redaction before rendering. |
| `src/session-ui/index.ts` | Re-exports terminal rows and values. | Ink imports from the package index. | Add future shared descriptors here only if they remain renderer-neutral. |

Current row kinds already include message, reasoning, tool call/status/thinking/login/model, exploring groups, delegation, async agent, yielded run, execution command/compaction, and error semantics. This is the strongest reuse boundary and should remain free of React, Ink, DOM, CSS, browser APIs, and component imports.

## Web Compact Terminal DOM-only renderer map

Files under `src/apps/chat-ui/src/session-views/compact-terminal/` are Web renderer code:

- `CompactTerminalSessionView.tsx`: React DOM shell for compact terminal rows and row state such as thinking visibility.
- `TerminalLine.tsx`: DOM rendering for prefixes, tokens, function calls, colors, CSS classes, and inline terminal layout.
- `TerminalDetails.tsx`: DOM details/expanders using shared `renderableTerminalValue()`.
- `TerminalInlineJson.tsx`: browser JSON rendering.
- `TerminalStatusCard.tsx`: Web-only rich status card layout.
- `TerminalThinkingCard.tsx`: Web-only thinking controls/card.
- `TerminalModelCard.tsx`: Web-only model provider/model card.
- `TerminalLoginCard.tsx`: Web-only login/provider/auth card.
- `loginMenu.ts`: Web login menu helper.
- `terminalRows.ts` and `terminalValue.ts`: compatibility re-exports from shared `src/session-ui`.

These files may consume shared descriptors, but Ink must not import them. They use React DOM concepts, CSS/class names, browser interaction patterns, and Web-specific controls.

## Current Ink renderer map

Files under `src/apps/cli-ui/` are the terminal renderer and command entry point:

- `InkSessionApp.ts`: app shell, startup open-first-session behavior, V1 slash parser/handler, status line, session/agent pickers, input reducer, and error formatting.
- `InkTerminalView.ts`: bounded row-window rendering.
- `InkTerminalRow.ts`: maps `CompactTerminalRow` to terminal sections.
- `InkTerminalLine.ts`: maps inline tokens and function-call labels to Ink `Text`.
- `inkColors.ts`: maps shared row kind/status/token tones to Ink colors.
- `inkJson.ts`: terminal-safe JSON formatting.
- `inkMarkdown.ts`: terminal markdown/plain-text formatting.
- `cliSessionsCommand.ts`: `pibo tui:sessions` command runner, TTY guard, source selection, local context wiring, debug PTY mocked router, and command help text.
- `index.ts`: app exports.

Current Ink limitations:

- Startup opens the most recent session or shows a reduced empty-state message. It does not resolve owner, pick room first, or require room-scoped creation.
- Pickers are flat and limited to sessions/agents.
- The command list is hard-coded to `/help /new /session /agent /status /clear /exit /quit`.
- `/status` is a text line, not a shared rich status card.
- `/new` uses `state.status?.activeRoomId` if present and otherwise creates a session with no explicit room.

## CLI source/runtime integration

Current runtime integration lives in `src/cli-session/`:

- `sessionSource.ts`: source contract for rooms, sessions, agents, status, open/send/create operations, and updates.
- `localSessionSource.ts`: local/default source backed by `PiboSessionStore`; optional `PiboDataStore` ingest; optional `LocalCliSessionRouter`; derives rooms from session metadata; hydrates trace from event log; updates in-memory traces from router events.
- `fakeSessionSource.ts`: deterministic source for tests and demo mode.
- `index.ts`: exports.

`src/apps/cli-ui/cliSessionsCommand.ts` builds the default local source by constructing:

- `PiboDataStore`
- `PiboDataSessionStore`
- default plugin registry and custom-agent profiles
- `PiboSessionRouter`
- `LocalCliSessionSource`

This is close to the real/default path and is the right place to add owner discovery, default room mapping, action execution, and explicit admin/recovery owner state. Fake/demo sources remain useful for smoke tests, but PRD acceptance for user-facing behavior should prefer the real/default local path or `pibo debug pty` mocked-local-router path where provider calls would be unsafe.

## V2 parity scope matrix

| Area | V2 target | Explicit boundary |
| --- | --- | --- |
| Owner/profile recovery | Resolve effective owner before listing rooms/sessions or writing sessions/messages/actions. Show active owner in header and `/status`. Provide Root recovery owner if no Web owner exists. | Do not silently fall back to `user:unknown`. Do not hide impersonation; host-root owner selection must be visible. |
| Room/session navigation | Owner → room → session flow at startup and for `/session`; `/new` creates in active/selected room; Personal Chat is default/fallback. | Do not keep flat session-only navigation as the primary path. |
| Shared presentation | Use `src/session-ui` for rows, cards, status, command menus/results, owner/room/session picker descriptors, tones, labels, and progress values. | Do not import Web DOM/CSS/browser components into Ink. Do not move Ink/React DOM dependencies into `src/session-ui`. |
| Slash commands | Derive terminal catalog from gateway capabilities plus CLI-only commands; support or clearly mark every relevant Web command. | Product-area screens such as Agent Designer, Projects, Workflows, Cron, Ralph, settings, and context management remain Web-only unless another PRD adds them. |
| Interactive controls | Adapt Web click flows to keyboard pickers with Up/Down, Enter, Escape, and Ctrl+C. | No mouse-only terminal flows. OAuth/API-key flows must avoid exposing secrets. |
| Web visibility | CLI-created sessions/messages/events write the same `sessions`, `session_navigation`, `event_log`, and `chat_messages` data used by Web. | No duplicate sidebar entries. No new hidden `user:unknown` sessions unless the operator explicitly selects that legacy owner. |

## Slash command inventory

### Gateway capability commands registered by built-in plugins

Source: `src/plugins/builtin.ts` gateway actions and slash commands.

| Slash | Action name | Current Web status | V2 CLI expectation |
| --- | --- | --- | --- |
| `/status` | `status` | Available from gateway catalog. | Supported; render shared rich status descriptor. |
| `/compact [instructions]` | `compact` | Available. | Supported where runtime supports compaction; render result descriptor. |
| `/session` | `session_id` | Available, returns active routed Pibo session id. | Name conflicts with V1 navigation; V2 should use room-first `/session` navigation and expose active id through `/session-current`/result text as specified. |
| `/clear` | `clear_queue` | Available. | Supported; distinguish queue clear from local display clear if both remain. |
| `/abort` | `abort` | Available. | Supported with clear runtime/no-active-run result. |
| `/kill` | `kill` | Available. | Supported with confirmation if needed. |
| `/kill-all` | `kill_all` | Available. | Supported with confirmation if needed. |
| `/thinking [level]` | `thinking` | Available; Web also has `/thinking-show`. | Supported direct argument and picker flow. |
| `/fast` | `fast_mode` | Available. | Supported; show changed/unsupported state. |
| `/session-current` | `session.current` | Available. | Supported. |
| `/sessions` | `session.list` | Available. | Supported; format session links/ids for terminal. |
| `/fork-candidates` | `session.fork_candidates` | Available. | Supported as list; selection/fork may be staged. |
| `/clone` | `session.clone` | Available. | Supported; open/select derived session when returned. |
| `/tree` | `session.tree` | Registered by gateway but Web filters it out of composer suggestions. | CLI should either support a terminal tree view or mark unsupported/deferred with reason. |
| `/login` | `login` | Available. | Supported via provider/auth-method picker; OAuth URL printed safely. |
| `/model` | `model` | Available. | Supported via provider/model picker or clear unavailable/auth-required result. |

Gateway actions without slash commands include lower-level follow-ups such as `session.fork`, `session.tree_navigate`, `session.switch`, `login.start`, `login.complete`, `login.api_key`, `login.remove`, `model.set`, and context/user-setting helpers. V2 CLI should call these only through explicit interactive flows and should not expose them as raw slash commands unless a PRD adds that surface.

### Web-added composer commands

Source: `src/apps/chat-ui/src/App.tsx` composer command list.

| Slash | Web behavior | V2 CLI boundary |
| --- | --- | --- |
| `/download <path>` | Downloads a file by absolute path or relative to cwd through browser download APIs. | Terminal equivalent can write/copy path or mark unsupported until path-based download is implemented. |
| `/upload` | Opens browser/clipboard upload flow to `~/.pibo/uploads`. | Terminal equivalent should be path-based upload or explicitly unsupported; no drag/drop dependency. |
| `/thinking-show` | Toggles historical thinking display in browser state. | Terminal equivalent can toggle local transcript thinking visibility or mark browser-only if not implemented. |

### CLI-only commands required for V2

| Slash | Purpose |
| --- | --- |
| `/help` | Catalog-generated help grouped by available, CLI navigation, and unsupported/deferred. |
| `/new` | Create a new session in the active or selected room under the active owner. |
| `/room` | Change active room through room picker. |
| `/agent` | Select an existing agent/profile for current or next session within active owner constraints. |
| `/owner` or `/profile` | Switch effective owner/profile in host-root recovery mode. |
| `/exit`, `/quit` | Exit TUI cleanly. |

## Unsupported and product-area boundaries

V2 is session UI parity, not full product UI parity. The CLI should state unsupported boundaries explicitly instead of implying commands do not exist:

- Agent Designer editing remains Web-only.
- Project, Workflow, Cron, Ralph, Settings, Context Files, MCP configuration, and full custom-agent management screens remain Web-only.
- Browser drag/drop, clipboard image upload, and browser download semantics need terminal equivalents before they are marked supported.
- Raw low-level gateway actions without slash commands should stay hidden behind safe interactive flows.
- Secret entry must never echo secrets into PTY artifacts, logs, commits, or reports.

## Owner-scope visibility bug

### Current behavior

When the CLI local source has no `ownerScope`:

1. `src/apps/cli-ui/cliSessionsCommand.ts` creates `LocalCliSessionSource` with `ownerScope: options.ownerScope`.
2. `src/cli-session/localSessionSource.ts` passes `ownerScope: input.ownerScope ?? this.ownerScope` to `sessionStore.create()`.
3. If both are undefined, `src/sessions/pibo-data-store.ts` persists `sessions.owner_scope` as `user:unknown`.
4. When the source has a `PiboDataStore` and a room id, `ChatDataIngestService.upsertNavigation()` writes `session_navigation.owner_scope` from `session.ownerScope ?? "user:unknown"`.
5. Web bootstrap and navigation use `listOwnedSessions(context, webSession)` which calls `findSessions({ ownerScope: webSession.ownerScope })`. A Web user with owner `user:<auth-user-id>` does not see a `user:unknown` session.

### Required invariant for V2

Before listing rooms, listing sessions, creating sessions, sending messages, ingesting assistant events, or executing slash actions, the CLI must have an explicit effective owner scope. New session rows and navigation rows must agree:

- `sessions.owner_scope = <activeOwnerScope>`
- `session_navigation.owner_scope = <activeOwnerScope>`
- message/event actor metadata must not imply a different owner for user actions
- active room/session/agent lists must be filtered by `<activeOwnerScope>`

`user:unknown` may only appear when an operator explicitly selects that legacy owner for inspection or repair. It must not be the implicit fallback for new writes.

## PTY validation convention

For user-facing CLI/TUI behavior, Ralph agents must use the project debug PTY tool instead of ad hoc shell wrappers when practical:

```bash
npm run dev -- debug pty run --artifact --expect "Pibo CLI Sessions" -- pibo tui:sessions --demo
npm run dev -- debug pty scenario --artifact <scenario.json>
npm run dev -- debug pty scenario --builtin cli-session-ui-mocked-e2e --artifact
```

Inside this Ralph loop's Docker worker, run through the mounted workspace when validating the real or mocked local path:

```bash
docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run dev -- debug pty --help'
docker exec pibo-dev-ink-cli-v2-web-parity bash -lc 'cd /workspace && npm run dev -- debug pty scenario --builtin cli-session-ui-mocked-e2e --artifact --docker-worker pibo-dev-ink-cli-v2-web-parity --workdir /workspace'
```

Each completed PRD story that touches user-facing CLI/TUI paths must record:

- command and environment
- fake/demo/mocked/real classification
- scripted input and assertions
- raw ANSI artifact path
- clean output artifact path
- observed result

## Validation added by this audit batch

- `test/ink-cli-v2-current-state.test.mjs` verifies this report keeps the required current-state map and command/PTY inventory.
- The same test file reproduces the current persistent `user:unknown` fallback through `LocalCliSessionSource` + `PiboDataSessionStore` + `ChatDataIngestService` and verifies a Web-owner filter does not return that session.
- A pending regression fixture captures the desired future behavior: CLI-created sessions without an explicit owner must not persist `user:unknown`.
