---
type: "Historical Record"
title: "Pibo VS Code Extension Implementation Plan"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/plans/pibo-vscode-extension-implementation-plan-2026-06-06.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "04da5749233e217ab7362549bc640e9e718a7c3b"
  source_bytes: 57928
  source_sha256: "e0f81b284526a426f3889690b101a814a6d92129ddd768ef981a3cb47a1730b1"
  source_body_sha256: "e0f81b284526a426f3889690b101a814a6d92129ddd768ef981a3cb47a1730b1"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Pibo VS Code Extension Implementation Plan

Date: 2026-06-06
Status: Draft
Investigation source: internal investigation on 2026-06-06
Last revision: 2026-06-06 — switch from per-workspace data store to room-based integration; add slash commands and dedicated session selector.

## Goals

1. Ship a VS Code extension for Pibo that surfaces the same Terminal (Session) View already used in the Chat Web App.
2. Reuse the existing UI component repertoire (1:1 with the Web App) for the session transcript. The extension renders **only the Session View** — no CRON area, no Ralph area, no Workflow Builder, no Settings, no Context-Files editor, no Projects area, no chat-sidebar.
3. Organise VS Code sessions as **rooms** in the existing Pibo system. The extension does not introduce a new data store, a new channel, or a new SQLite file. Sessions are written to the global `~/.pibo/pibo.sqlite`, attached to a `PiboRoom` whose `workspace` field matches the VS Code workspace folder, and therefore appear in the Session Tab of the Chat Web App.
4. On activation the extension resolves the VS Code workspace folder to a `PiboRoom`: search for an existing room whose `workspace` field matches the folder; if none exists, create one. The room is the organising unit, the same way the Web App organises its sessions.
5. Reuse the Web App's slash command system 1:1. The composer in the extension uses the same `SlashCommand` catalog built from `bootstrap.capabilities.actions`, the same `runCommand` plumbing, and the same `postAction` endpoint.
6. Provide a dedicated, minimal **VS Code Session Selector** component in the WebView that lists the sessions in the current room, allows creating new sessions, switching between sessions, and deleting sessions. The Web App's full `SessionSidebar` is **not** reused — it brings 764 LOC of room-tree, room-creation, and session-archive logic that is irrelevant in the extension.
7. Distribute the extension as a single `.vsix` that bundles the same React + Tailwind frontend, plus a small VS Code adapter layer.

## Non-Goals

- Re-implement the Workflow Builder, Settings panels, Context-Files editor, or any other Chat Web area inside VS Code. The WebView only contains the session transcript, the session selector, and the composer.
- Reuse the Web App's `SessionSidebar` (or any of the room-tree / room-archive logic). The extension uses a much smaller selector that only knows about the single workspace-resolved room.
- Spawn a `pibo gateway:web` child process. The extension connects to an existing gateway started by the user (`pibo gateway:web` running in dev or prod mode) and reuses its REST API and SSE endpoints. The gateway owns the SQLite store; the extension is a thin client.
- Add a new auth model. The extension reuses the existing login state in `~/.pibo/` (API keys, OAuth sessions) via the same `setApiKey` / `completeLogin` actions the CLI uses.
- Persist VS Code-internal UI state across machines. Project-local session data must follow the project.
- Build a "Workspace Sessions" web app area. With room-based integration, workspace sessions are simply rooms in the Web App, shown in the normal room tree, and the user can opt in by archiving all other rooms or by filtering the room list. No new view is required.

## Architectural Decisions

### A. Same component repertoire — single React bundle, scoped to session-only components

The Pibo Chat Web App is a Vite-built React SPA in `src/apps/chat-ui/`. The components that are **reused** by the extension are:

```text
src/apps/chat-ui/src/
├── composer/Composer.tsx                     # the chat input — supports /commands, $skills, upload
├── session-views/compact-terminal/           # the Session View (Terminal)
│   ├── CompactTerminalSessionView.tsx
│   ├── TerminalDetails.tsx
│   ├── TerminalLine.tsx
│   ├── TerminalLoginCard.tsx
│   ├── TerminalModelCard.tsx
│   ├── TerminalStatusCard.tsx
│   ├── TerminalThinkingCard.tsx
│   ├── TerminalInlineJson.tsx
│   ├── loginMenu.ts
│   ├── terminalRows.ts
│   └── terminalValue.ts
├── session-views/types.ts                    # ChatSessionViewProps contract
└── app-command-catalog.ts                    # buildSlashCommands(), availableSkillsForSession()
```

The components that are **not** reused (intentionally excluded) are:

```text
src/apps/chat-ui/src/
├── App.tsx                                   # the full chat-web app orchestrator
├── app-chrome.tsx                            # sidebar, header, navigation
├── session-sidebar.tsx                       # room tree, archive logic — too large
├── CronArea.tsx, RalphArea.tsx, WorkflowsArea.tsx
├── agents/, context/, settings/, projects/
└── chat-upload-attachments.tsx (web-only bits)
```

The reused components are imported by the extension's WebView entry and rendered as-is. The view-model layer at `src/session-ui/terminalRows.ts` is also shared with the Ink CLI TUI — the extension becomes the third consumer. The slash command catalog at `src/apps/chat-ui/src/app-command-catalog.ts` is also reused 1:1 (it is a pure function over `bootstrap.capabilities.actions`).

**No new React components are written for the extension** in the session-transcript area. The Composer, the Terminal View, the Terminal sub-cards, the slash command catalog builder, and the available-skills resolver are all imported.

**The one new component the extension does add** is the VS Code Session Selector (see Decision D). It lives in `src/apps/chat-vscode/extension/webview/SessionSelector.tsx` and is the only frontend code in the extension that has no counterpart in the Web App.

### B. Sessions live in `~/.pibo/pibo.sqlite` organised in rooms — no new data layer

There is **no** per-workspace data store, **no** `<workspace>/.pibo/` directory, **no** new `PiboDataStore` factory, **no** `pibo-vscode` channel. The extension writes through the existing `pibo gateway:web` REST API and the gateway writes to the same SQLite database the Web App uses.

A VS Code session is just a `PiboSession` with:

- `channel: "pibo.chat-web"` — same as every other Web App session. Sessions are not tagged with a "vscode" origin because the room already identifies the workspace, and the user wants these sessions to be fully visible in the Web App.
- `metadata.chatRoomId` set to the room that was resolved for the workspace (see Decision C).
- `workspace` set to the resolved workspace folder path. The existing `roomWorkspaceFromMetadata()` helper already handles this, and the Web App's session creation flow at `src/apps/chat/web-app.ts:1046` already sets it.

When the Web App renders the room tree, the new room appears in the sidebar. When the user clicks the room in the Web App, they see exactly the same sessions the extension sees. The composer, the slash command system, the session view, the SSE stream — all the same code paths.

This is the simplest possible integration: the extension is a thin client that picks a room and runs the same UI as the Web App would, minus the chrome.

### C. The extension resolves a room per workspace folder; the WebView shows the picker

When the extension activates, it gets a `vscode.WorkspaceFolder[]` from `vscode.workspace.workspaceFolders`. For each folder, in order, it:

1. Reads the canonical absolute path: `vscode.Uri.fsPath` resolved via `path.resolve` and `fs.realpathSync` to defeat symlinks.
2. Calls a new gateway endpoint `GET /api/chat/rooms?workspace=<absolute-path>` to find existing rooms whose `workspace` field equals the folder path. (`LIKE` is not used — paths must match exactly so the same folder across machines does not collide.)
3. If **no room matches**, the extension posts `POST /api/chat/rooms` with `{ name: <basename-of-folder>, workspace: <absolute-path>, metadata: { workspace: <absolute-path> } }` to create a new room. (Both the top-level `workspace` field and the `metadata.workspace` field are set so that the `roomWorkspaceFromMetadata` helper at `src/apps/chat/types/rooms.ts:60` and the explicit column stay in sync.) The newly created room becomes the active room directly.
4. If **exactly one room matches**, that room is the active room and the WebView immediately shows its session list. The user sees the Session View without an intermediate picker step.
5. If **multiple rooms match** (an edge case after a workspace rename or after manually creating a second room for the same path), the WebView shows a **Room Picker** state in place of the Session Selector. The user picks one room; the choice is sent to the extension host via `postMessage`; the host writes the chosen `roomId` to `vscode.ExtensionContext.workspaceState` and pushes the new `roomId` to the WebView, which re-renders into the Session Selector view. The room picker is **not** a `vscode.window.showQuickPick`; it lives in the new React component (Step 3) so the user picks the room in the same surface they will be working in.
6. The chosen `roomId` is stored in `vscode.ExtensionContext.workspaceState` so the extension does not re-resolve on every reload. Re-resolving only happens on `onDidChangeWorkspaceFolders` or when the workspace folder changes.

The new endpoint `GET /api/chat/rooms?workspace=<path>` is a thin addition to `src/apps/chat/web-app.ts` (the existing `GET /api/chat/rooms` returns the full room tree; a query parameter adds a filtered variant). It is a SQL `SELECT … WHERE workspace = ?` against the existing `rooms` table.

A workspace-folder watcher in the extension calls the same resolver on `onDidChangeWorkspaceFolders` so that opening a different folder immediately switches the active room. The watcher always goes through the same three-branch logic (zero / one / many rooms) and surfaces the result to the WebView through the same `roomId` postMessage.

### D. The WebView renders a minimal three-pane layout

The WebView is laid out as:

```text
┌────────────────────────────────────────────────────────────────┐
│ VS Code Session Selector  (extension-only component)           │
│  ┌──────────────┐                                               │
│  │ [+] New      │  ◉ "Refactor auth middleware"  running  2m   │
│  │              │  ○ "Investigate pgbouncer"      idle     1h   │
│  │              │  ○ "Add typed wrappers"          error    3d   │
│  └──────────────┘                                               │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  CompactTerminalSessionView  (reused from chat-ui)             │
│                                                                │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│ Composer  (reused from chat-ui, including slash commands)      │
│  > Type a message, /help, or $skill-name                       │
└────────────────────────────────────────────────────────────────┘
```

The Session Selector at the top is a small React component (~150 LOC) implemented in `src/apps/chat-vscode/extension/webview/SessionSelector.tsx`. It does not reuse the Web App's `SessionSidebar` (764 LOC, with room-tree, room-creation dialog, archive filters, mobile menu, and unread counters). The extension's selector only needs:

- A list of sessions in the current room, sorted by `lastActivityAt` desc.
- A `[+]` button that calls `POST /api/chat/sessions` (the existing Web App endpoint) with `roomId` set to the resolved room.
- A row click that selects the session and triggers a `postMessage` to the WebView's host (extension-side `workspace-channel-manager.ts`) to update the selected `piboSessionId`.
- A small `…` menu on each row for delete (`DELETE /api/chat/sessions/:id`) and rename (`PATCH /api/chat/sessions/:id`).
- A status pill (`running` / `idle` / `error`) reusing the same colour tokens from `styles.css`.

The selector's data is fetched from a new endpoint `GET /api/chat/rooms/:roomId/sessions` (or it can use the existing `GET /api/chat/bootstrap?roomId=…` which already returns the room's sessions). The latter is preferred to avoid a new endpoint.

### E. The WebView communicates with the extension over `postMessage`

The WebView's renderer is intentionally minimal. The heavy lifting lives in the extension host:

```text
WebView (renderer)                                  Extension Host (Node)
──────────────────                                  ────────────────────
fetch baseUrl = vscode://pibo/                      resolves workspace folder
  → loads bundled <dist>/apps/chat-vscode/          calls resolveRoomForWorkspace
    index.html                                      single   → pibo/set-selector-mode { sessions }
mounts <ChatTerminalApp />                            multiple → pibo/set-selector-mode { rooms, candidates }
fetches <http://127.0.0.1:<gw>/api/chat/...>  ◀──▶  the gateway is the source of truth
EventSource /api/chat/events                        no child process spawned
postMessage channels (typed, see below)             the host drives the WebView's
                                                    selector mode through pibo/
                                                    set-selector-mode
```

The `postMessage` channels are typed and minimal. Direction is **host → WebView** for `pibo/set-selector-mode` and **WebView → host** for everything else.

Host → WebView:

- `pibo/set-selector-mode` → `{ mode: { kind: "sessions", roomId } | { kind: "rooms", candidates, workspace } }` — tells the WebView which view to render in the selector slot.

WebView → host:

- `pibo/select-room` → `{ roomId: string }` — the user picked a room in the Room Picker.
- `pibo/select-session` → `{ piboSessionId: string }` — the user picked a session in the Session List.
- `pibo/new-session` → `{ profile: string }` (host posts back the new id).
- `pibo/delete-session` → `{ piboSessionId: string }`
- `pibo/rename-session` → `{ piboSessionId: string, title: string }`
- `pibo/open-external` → `{ uri: string }` (delegated to `vscode.env.openExternal`)

The WebView does **not** call `vscode.commands.executeCommand` or any other VS Code API. From the WebView's perspective, the only contract is HTTP fetch + `postMessage` to the host.

### F. Slash commands work because the composer is reused

The slash command system is preserved by reusing the existing `Composer` component from `src/apps/chat-ui/src/composer/Composer.tsx` (623 LOC) and the existing `app-command-catalog.ts` helpers.

The data flow is:

1. Web App's bootstrap already returns `bootstrap.capabilities.actions` (the gateway action catalog from `pluginRegistry.getGatewayActionInfos()`). The same bootstrap is fetched by the extension's WebView from `GET /api/chat/bootstrap?roomId=…`.
2. The extension's host builds `slashCommands` with `buildSlashCommands(bootstrap.capabilities.actions)` and `skills` with `availableSkillsForSession(bootstrap, selectedPiboSessionId)` — these are the same calls `App.tsx:751-752` uses today.
3. Both arrays are passed as `commands={slashCommands}` and `skills={skills}` to the `<Composer />`.
4. The Composer's `submit()` calls `onCommand(text)` if the text starts with `/`. The extension's `onCommand` is a thin wrapper that:
   - Resolves the slash command via `slashCommands.find((c) => c.slash === commandText)`.
   - For the special commands `/download`, `/upload`, `/thinking-show` (built-in by `app-command-catalog.ts:30`), handles them as the Web App does.
   - For gateway actions, calls `postAction(selectedPiboSessionId, action, params)` against `POST /api/chat/action` — the same endpoint the Web App uses.
5. The slash command suggestion popover in the composer is driven by the same `commands.filter((c) => c.slash.startsWith(commandTrigger))` logic. No new code is needed.

This means every slash command the Web App supports (`/help`, `/compact`, `/thinking`, `/model`, `/session.clone`, `/session.fork`, etc.) works in the extension with **zero new code**. The only thing the extension must do is pass the right `commands` and `skills` props to the composer, which is just calling the existing helpers.

### G. No new `pibo-vscode` channel, no per-workspace data store, no `dev-auth` shim

The extension talks to the existing `pibo gateway:web` running in dev or prod mode. The user starts the gateway exactly the way they do today (`pibo gateway:web`), and the extension picks the gateway URL from the user's `PIBO_CHAT_WEB_URL` env var or a `pibo.chatWebUrl` setting (defaulting to `http://127.0.0.1:4788`).

There is no:

- per-workspace `.pibo/` directory,
- per-workspace `PiboDataStore`,
- `pibo-vscode` channel,
- `pibo-vscode` session helpers,
- `WorkspaceVscodeChannel` class,
- `WorkspaceChannelManager`,
- loopback HTTP server in the extension,
- `dev-auth` mode toggle,
- `Authorization` header for the WebView.

The extension is a client. The gateway is the server. The data store is the gateway's data store. The slash commands, the composer, the session view, the SSE stream are all gateway-backed.

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│ VS Code Workbench                                                                │
│  ┌──────────────────────────────────────────────────────────────────────────┐    │
│  │ Sidebar / Editor WebView (Chromium iframe)                                │    │
│  │   loads bundled <dist>/apps/chat-vscode/index.html                        │    │
│  │   mounts <ChatTerminalApp />                                              │    │
│  │   ┌──────────────────────────────────────────────────────────────────┐    │    │
│  │   │ SessionSelector  (extension-only, ~150 LOC)                      │    │    │
│  │   │   - lists sessions in the current room                          │    │    │
│  │   │   - [+] new, rename, delete                                      │    │    │
│  │   └──────────────────────────────────────────────────────────────────┘    │    │
│  │   ┌──────────────────────────────────────────────────────────────────┐    │    │
│  │   │ <CompactTerminalSessionView />  (reused 1:1 from chat-ui)       │    │    │
│  │   └──────────────────────────────────────────────────────────────────┘    │    │
│  │   ┌──────────────────────────────────────────────────────────────────┐    │    │
│  │   │ <Composer />  (reused 1:1 from chat-ui, with slash commands)   │    │    │
│  │   └──────────────────────────────────────────────────────────────────┘    │    │
│  │   fetches <http://127.0.0.1:4788/api/chat/...>  (the existing gateway)   │    │
│  │   EventSource /api/chat/events (SSE, works in WebViews)                  │    │
│  │   postMessage to extension host for non-HTTP actions                       │    │
│  └──────────────────────────────────────────────────────────────────────────┘    │
│              │ fetch + EventSource + postMessage                                  │
│  ┌───────────▼──────────────────────────────────────────────────────────────┐      │
│  │ Extension Host (Node, src/apps/chat-vscode/extension/src/extension.ts) │      │
│  │  - resolves <workspaceFolder> → PiboRoom  (Decision C)                  │      │
│  │  - reads ~/.pibo/ login state via getLoginStatus()                       │      │
│  │  - handles onDidChangeWorkspaceFolders → re-resolves the room            │      │
│  │  - wires postMessage ↔ vscode.commands / vscode.env.openExternal         │      │
│  └─────────────────────────────────────────────────────────────────────┬────┘      │
└────────────────────────────────────────────────────────────────────┼────────────┘
                                                                   │  HTTP / SSE
                                                                   ▼
                          ┌────────────────────────────────────────────────────┐
                          │ pibo gateway:web  (existing, started by the user)   │
                          │   --web-port 4788 --web-host 127.0.0.1              │
                          │   /apps/chat/*  serves the Web App                  │
                          │   /api/chat/*   REST API used by both               │
                          │   data store: ~/.pibo/pibo.sqlite (unchanged)       │
                          └─────────────────────┬──────────────────────────────┘
                                                │
                                                ▼
                          ┌────────────────────────────────────────────────────┐
                          │ ~/.pibo/pibo.sqlite  (unchanged)                    │
                          │   rooms    WHERE workspace = '<vscode-folder>'      │
                          │   sessions WHERE metadata.chatRoomId = <room>      │
                          │                                                       │
                          │ The room is visible in the Web App's room tree.    │
                          │ The sessions are visible in the Session Tab.       │
                          │ Both surfaces see exactly the same data.            │
                          └────────────────────────────────────────────────────┘
```

## Implementation Steps

### Step 1 — Gateway endpoint: list rooms by workspace

**File:** `src/apps/chat/web-app.ts`

Add a query parameter to the existing `GET /api/chat/rooms` handler (currently line 4549). When `?workspace=<path>` is present, return only rooms whose `workspace` column equals that path:

```ts
// NEW (sketch)
if (url.pathname === `${CHAT_WEB_API_PREFIX}/rooms` && request.method === "GET") {
  const webSession = await requireSession(request, context);
  state.roomService.ensureDefaultRoom();
  const workspaceFilter = url.searchParams.get("workspace");
  if (workspaceFilter) {
    const rooms = state.roomService.listRooms().filter(
      (room) => room.workspace === workspaceFilter,
    );
    return responseJson({ rooms });
  }
  return responseJson({ rooms: state.roomService.listRoomTree() });
}
```

Notes:

- `state.roomService.listRooms()` already exists in `src/apps/chat/data/room-service.ts:33`. The filter is a single line.
- The filter uses **exact** string equality on the path. `LIKE` or prefix matching is intentionally avoided to prevent two different folders with overlapping path prefixes from matching.
- The endpoint also matches the existing `metadata.workspace` field via `roomWorkspaceFromMetadata` for backwards compatibility (rooms created before this column was canonical still match).

Success criteria:

- A test creates two rooms with different `workspace` values, hits `GET /api/chat/rooms?workspace=/path/A`, and confirms only the matching room is returned.
- A test confirms the unfiltered `GET /api/chat/rooms` still returns the full tree.
- `npm run typecheck` passes.

### Step 2 — WebView entry: `ChatTerminalApp`

**New file:** `src/apps/chat-vscode/extension/webview/ChatTerminalApp.tsx`

The WebView's React entry. It is small (~80 LOC) and its only job is to wire three reused components together. It owns the `selectorMode` state which decides whether the Session Selector renders as a Session List (the common case) or a Room Picker (when the room resolver returns `kind: "multiple"`):

```tsx
// Sketch
type SelectorMode =
  | { kind: "sessions";  roomId: string }
  | { kind: "rooms";     candidates: readonly PiboRoom[]; workspace: string };

export function ChatTerminalApp({ baseUrl, workspace, initialRoomId }: { baseUrl: string; workspace: string; initialRoomId: string | null }) {
  const [roomId, setRoomId] = useState<string | null>(initialRoomId);
  const [selectorMode, setSelectorMode] = useState<SelectorMode>(
    initialRoomId
      ? { kind: "sessions", roomId: initialRoomId }
      : { kind: "rooms", candidates: [], workspace },  // will be replaced on resolve
  );
  const [selectedPiboSessionId, setSelectedPiboSessionId] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);

  // Fetch bootstrap when roomId changes. The bootstrap already contains
  // sessions, capabilities.actions, agentCatalog.skills, etc. — exactly what
  // App.tsx in the Web App uses.
  useEffect(() => { if (roomId) { /* fetch /api/chat/bootstrap?roomId=... */ } }, [baseUrl, roomId]);

  // Subscribe to live SSE. The same /api/chat/events endpoint the Web App uses.
  useEffect(() => { if (roomId) { /* EventSource /api/chat/events?roomId=...&since=... */ } }, [baseUrl, roomId, selectedPiboSessionId]);

  // Listen for postMessage from the extension host:
  //   pibo/set-selector-mode   { mode: SelectorMode }
  //   pibo/select-room         { roomId: string }
  //   pibo/select-session      { piboSessionId: string }
  //   pibo/new-session         { profile: string }
  //   pibo/delete-session      { piboSessionId: string }
  //   pibo/rename-session      { piboSessionId, title }
  useEffect(() => { /* window.addEventListener("message", ...) */ }, []);

  const slashCommands = useMemo(
    () => bootstrap ? buildSlashCommands(bootstrap.capabilities.actions) : [],
    [bootstrap],
  );
  const skills = useMemo(
    () => availableSkillsForSession(bootstrap, selectedPiboSessionId),
    [bootstrap, selectedPiboSessionId],
  );

  return (
    <div className="pibo-vscode-panel">
      <SessionSelector
        mode={
          selectorMode.kind === "rooms"
            ? { kind: "rooms", candidates: selectorMode.candidates, workspace: selectorMode.workspace }
            : { kind: "sessions", roomId, sessions: bootstrap?.sessions ?? [], selectedPiboSessionId }
        }
        onSelectSession={setSelectedPiboSessionId}
        onNewSession={...}
        onDeleteSession={...}
        onRenameSession={...}
        onSelectRoom={(rid) => { setRoomId(rid); setSelectorMode({ kind: "sessions", roomId: rid }); }}
      />
      {selectorMode.kind === "sessions" && (
        <>
          <CompactTerminalSessionView
            traceView={...} selectedTrace={...} isLoading={...}
            showThinking={false} expandThinking={false}
            sessionAgentProfile={...} sessionActiveModel={...}
            selectedSessionStatus={...} selectedSessionSignal={...}
            sessionNodes={...} sessionBreadcrumbs={...} originSession={...}
            derivedSessions={...} agentProfiles={...} sessionProfileChangeDisabled={false}
            onSessionAgentProfileChange={...} onFork={...} onOpenSession={...}
            onThinkingLevelChange={...} onModelChanged={...} onRefreshBootstrap={...}
            onError={...}
          />
          <Composer
            sessionId={selectedPiboSessionId}
            commands={slashCommands}
            skills={skills}
            value={composerText}
            focusSignal={composerFocusSignal}
            selectedWebAnnotations={[]}
            selectedUploadAttachments={[]}
            onValueChange={setComposerText}
            onCommand={runCommand}
            onDetachWebAnnotation={...} onClearWebAnnotations={...}
            onAttachUploadedFiles={...} onDetachUploadAttachment={...} onClearUploadAttachments={...}
            onSend={onSend}
          />
        </>
      )}
    </div>
  );
}
```

The component:

- Imports `CompactTerminalSessionView` from `src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx`.
- Imports `Composer` from `src/apps/chat-ui/src/composer/Composer.tsx`.
- Imports `buildSlashCommands` and `availableSkillsForSession` from `src/apps/chat-ui/src/app-command-catalog.ts`.
- Imports the new `SessionSelector` from Step 3.

When `selectorMode.kind === "rooms"`, the WebView renders only the Room Picker; the Terminal View and the Composer are **not** rendered. This is a deliberate choice: a session in an unselected room cannot be shown, and showing the Composer without a selected session would be confusing. Once the user picks a room, `selectorMode` flips to `"sessions"` and the rest of the WebView appears.

No new view components are written for the session transcript. The Composer is reused as-is — its `slash` and `$skill` suggestion popovers, history navigation, and upload dialog all work because they are driven by the `commands` and `skills` props.

Success criteria:

- The file is under 250 LOC.
- When the host pushes `selectorMode = { kind: "rooms", candidates: [...], workspace: "..." }`, the WebView renders only the Room Picker and the Terminal View + Composer are unmounted.
- When the host pushes `selectorMode = { kind: "sessions", roomId: "..." }`, the Room Picker is replaced by the Session List and the rest of the WebView mounts.
- `grep "CompactTerminalSessionView\|Composer" src/apps/chat-vscode/extension/webview/ChatTerminalApp.tsx` shows one import and one usage of each.
- `npm run chat-ui:typecheck` passes (the chat-ui files are not modified).

### Step 3 — VS Code Session Selector (the one new component, with a Room Picker mode)

**New file:** `src/apps/chat-vscode/extension/webview/SessionSelector.tsx`

A minimal selector, ~200 LOC, that operates in **two mutually exclusive modes**:

- **Session mode** (the common case): shows a horizontal list of sessions in the active room, sorted by `lastActivityAt` desc, with a `[+]` button and a `…` menu per row.
- **Room Picker mode** (only when `resolveRoomForWorkspace` returns `kind: "multiple"`): shows a vertical list of all matching rooms, with their `name`, `topic`, `createdAt`, and `updatedAt`. Each row is clickable; clicking sends `postMessage('pibo/select-room', { roomId })` to the extension host. There is no `vscode.window.showQuickPick` — the picker lives in the WebView so the user picks the room in the same surface they will be working in.

The component is a single React file that branches on a `mode` prop:

```tsx
// Sketch
export type SessionSelectorMode =
  | { kind: "sessions";  roomId: string; sessions: readonly PiboWebSessionNode[]; selectedPiboSessionId: string | null; }
  | { kind: "rooms";     candidates: readonly PiboRoom[]; workspace: string; }
  ;

export type SessionSelectorProps = {
  mode: SessionSelectorMode;
  onSelectSession: (piboSessionId: string) => void;
  onNewSession: (profile: string) => Promise<void>;
  onDeleteSession: (piboSessionId: string) => Promise<void>;
  onRenameSession: (piboSessionId: string, title: string) => Promise<void>;
  onSelectRoom: (roomId: string) => void;  // Room Picker mode only
};

export function SessionSelector({ mode, onSelectSession, onNewSession, onDeleteSession, onRenameSession, onSelectRoom }: SessionSelectorProps) {
  if (mode.kind === "rooms") return <RoomPickerView candidates={mode.candidates} workspace={mode.workspace} onSelectRoom={onSelectRoom} />;
  return <SessionListView sessions={mode.sessions} selectedPiboSessionId={mode.selectedPiboSessionId} onSelectSession={onSelectSession} onNewSession={onNewSession} onDeleteSession={onDeleteSession} onRenameSession={onRenameSession} />;
}
```

The **Session List View** is the original spec from the previous revision:

```tsx
function SessionListView({ sessions, selectedPiboSessionId, onSelectSession, onNewSession, onDeleteSession, onRenameSession }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
      <button onClick={() => onNewSession(defaultProfile)} title="New session">+</button>
      <ul className="flex gap-1 overflow-x-auto">
        {sessions.map((session) => (
          <li key={session.piboSessionId}>
            <button
              className={session.piboSessionId === selectedPiboSessionId ? "active" : ""}
              onClick={() => onSelectSession(session.piboSessionId)}
            >
              <StatusPill status={session.status} />
              <span>{session.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

The **Room Picker View** is a small new addition (~50 LOC):

```tsx
function RoomPickerView({ candidates, workspace, onSelectRoom }) {
  return (
    <div className="border-b border-slate-800 px-3 py-3">
      <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">
        Multiple rooms found for <span className="font-mono text-slate-300">{workspace}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {candidates.map((room) => (
          <li key={room.id}>
            <button
              className="w-full text-left px-3 py-2 border border-slate-700 rounded hover:border-[#11a4d4]"
              onClick={() => onSelectRoom(room.id)}
            >
              <div className="font-semibold text-slate-200">{room.name}</div>
              {room.topic && <div className="text-xs text-slate-400">{room.topic}</div>}
              <div className="text-xs text-slate-500 mt-1">
                Created {formatDate(room.createdAt)} · Updated {formatDate(room.updatedAt)}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

The component:

- Uses the same Tailwind classes as the Web App (because the WebView shares the bundled Tailwind CSS).
- Calls `POST /api/chat/sessions` to create, `DELETE /api/chat/sessions/:id` to delete, `PATCH /api/chat/sessions/:id` to rename — existing endpoints (`src/apps/chat-ui/src/api-chat-sessions.ts:101, 152, 163`).
- Reuses the `PiboWebSessionNode` and `PiboRoom` types from `src/apps/chat-ui/src/types.ts` and `src/apps/chat/types/rooms.ts` so the data shape matches the Web App's bootstrap response.
- Reuses the same colour tokens from the Web App's `styles.css` (`#11a4d4` for active state, `slate-700` / `slate-800` for borders).

The Room Picker mode is **only** entered when `resolveRoomForWorkspace` returns `kind: "multiple"`. The two modes are never active at the same time. The transition between them is driven by the `mode` prop, which the host updates through `postMessage`.

Success criteria:

- The file is under 300 LOC (a bit more than the previous 200-LOC target because the Room Picker View is a real addition).
- In **single-room** mode, the selector lists sessions from `bootstrap.sessions` (the same data the Web App's `SessionSidebar` would render for the same room).
- In **multi-room** mode, the picker lists all matching rooms with `name`, `topic`, `createdAt`, and `updatedAt`. Clicking a room calls `onSelectRoom(roomId)` and the host re-fetches bootstrap for the chosen room.
- Creating a new session causes a re-fetch of bootstrap, which triggers a re-render with the new session in the list.

### Step 4 — Room resolver: find or create

**New file:** `src/apps/chat-vscode/extension/src/room-resolver.ts`

The room-resolver turns a VS Code workspace folder into a `RoomResolution`. It does **not** itself pick the room when multiple matches exist; that decision is left to the WebView (Step 3):

```ts
// Sketch
export type RoomResolution =
  | { kind: "single";     room: PiboRoom; workspace: string }
  | { kind: "multiple";   rooms: readonly PiboRoom[]; workspace: string }
  | { kind: "create";     workspace: string }
  ;

export async function resolveRoomForWorkspace(
  baseUrl: string,
  workspaceFolder: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<RoomResolution> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const canonicalPath = await canonicalizePath(workspaceFolder);

  // 1. Search for an existing room.
  const list = await fetchImpl(`${baseUrl}/api/chat/rooms?workspace=${encodeURIComponent(canonicalPath)}`);
  if (!list.ok) throw new Error(`rooms list failed: ${list.status}`);
  const { rooms } = await list.json() as { rooms: PiboRoom[] };

  if (rooms.length === 1) return { kind: "single",   room: rooms[0], workspace: canonicalPath };
  if (rooms.length > 1)   return { kind: "multiple", rooms,         workspace: canonicalPath };

  // 2. No room exists — create one.
  const folderName = path.basename(canonicalPath) || "VS Code Workspace";
  const create = await fetchImpl(`${baseUrl}/api/chat/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: folderName,
      workspace: canonicalPath,
      metadata: { workspace: canonicalPath },
      type: "chat",
    }),
  });
  if (!create.ok) throw new Error(`room create failed: ${create.status}`);
  const { room } = await create.json() as { room: PiboRoom };
  return { kind: "single", room, workspace: canonicalPath };
}

export async function pickRoom(
  baseUrl: string,
  roomId: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<PiboRoom> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(`${baseUrl}/api/chat/rooms/${encodeURIComponent(roomId)}`);
  if (!res.ok) throw new Error(`room fetch failed: ${res.status}`);
  const { room } = await res.json() as { room: PiboRoom };
  return room;
}
```

Notes on the data shape:

- `kind: "single"` covers both "exactly one match" and "just created". The WebView treats both the same way: show the Session Selector with the sessions of that room.
- `kind: "multiple"` carries all matching rooms. The WebView switches to a **Room Picker** state (Step 3) that lists each room with its `name`, `topic`, `createdAt`, and `updatedAt` (so the user can tell which is the older one). The user clicks one; the choice is sent back as a `postMessage` `pibo/select-room` event; the extension host calls `pickRoom(baseUrl, roomId)`, stores the choice in `workspaceState`, and pushes the active `roomId` to the WebView.
- `kind: "create"` is reserved for a future flow where the extension shows "create a new room for this folder" before doing it. Today the resolver auto-creates in this case, so the variant is unused but kept in the type for symmetry and future expansion.

`canonicalizePath` uses `fs.realpathSync` to resolve symlinks, then `path.resolve` to get an absolute path. The path is **not** lowercased — case-sensitive comparison matches the Web App's `roomService.createRoom` behavior, which stores the path verbatim.

The `metadata: { workspace: <path> }` body field is what `roomWorkspaceFromMetadata()` reads; the top-level `workspace` field is the explicit column. Both are set so the new endpoint and the old helper stay consistent.

The resolver is also called by Step 6 (workspace folder watcher) when the workspace folders change. The watcher's branch is identical: `single` → push `roomId` and show sessions; `multiple` → push the matched rooms and let the WebView show the picker.

Success criteria:

- A test stubs `fetch` and confirms the right endpoint is hit for the "no existing room" case (POST `/api/chat/rooms`).
- A test stubs `fetch` to return two rooms for a workspace and confirms the resolver returns `kind: "multiple"` with both rooms — **without** calling any picker or showing any prompt.
- A test confirms symlink resolution: a folder accessed via `/tmp/link` and `/tmp/real` resolves to the same canonical path.
- A test confirms case-sensitive path matching.

### Step 5 — Extension package skeleton

**New directory:** `src/apps/chat-vscode/extension/`

```text
src/apps/chat-vscode/
├── README.md
├── CHANGELOG.md
├── package.json              # VS Code extension manifest
├── tsconfig.json
├── extension/                # VS Code-specific Node code
│   ├── src/
│   │   ├── extension.ts                       # activate(context: vscode.ExtensionContext)
│   │   ├── room-resolver.ts                   # Step 4
│   │   ├── workspace-folder-watcher.ts        # Step 6
│   │   ├── auth-bridge.ts                     # Step 7
│   │   ├── webview-host.ts                    # owns the vscode.WebviewView
│   │   ├── postmessage-rpc.ts                 # typed postMessage protocol
│   │   └── commands.ts                        # Step 8
│   ├── media/
│   │   └── chat-vscode-panel.html             # WebView HTML host
│   └── tsconfig.json
└── dist/
    ├── extension.cjs                          # esbuild bundle
    └── webview/                               # Vite output (Step 9)
```

`package.json` (extension manifest) contributes:

- `engines.vscode`: `^1.96.0`
- `main`: `./dist/extension.cjs`
- `activationEvents`: `onStartupFinished` (cheap; the WebView shows a "open a folder" empty state if no workspace is open)
- `contributes.commands`:
  - `pibo.newSession` — create a new session in the current room
  - `pibo.deleteCurrentSession` — delete the currently selected session
  - `pibo.renameCurrentSession` — rename via VS Code's input box
  - `pibo.openInChatWeb` — open the Web App at the same room in the user's browser
  - `pibo.signIn` — open an integrated terminal running `pibo login <provider>`
- `contributes.viewsContainers.activitybar` + `contributes.views.pibo`: registers the "Pibo" sidebar icon
- `contributes.viewsWelcome`: empty state when no folder is open
- `contributes.configuration`: `pibo.chatWebUrl` (default `http://127.0.0.1:4788`)

Success criteria:

- `npm run vscode:package` produces a `.vsix`.
- Loading the `.vsix` in a clean VS Code instance activates the extension without errors.

### Step 6 — Workspace folder watcher

**New file:** `src/apps/chat-vscode/extension/src/workspace-folder-watcher.ts`

Subscribes to `vscode.workspace.onDidChangeWorkspaceFolders`:

- Calls `resolveRoomForWorkspace(baseUrl, newFolder.uri.fsPath)`.
- Branches on the result:
  - `kind: "single"` → pushes `pibo/set-selector-mode { mode: { kind: "sessions", roomId } }` to the WebView. The WebView re-renders into the Session List view.
  - `kind: "multiple"` → pushes `pibo/set-selector-mode { mode: { kind: "rooms", candidates, workspace } }` to the WebView. The WebView re-renders into the Room Picker view.
  - `kind: "create"` is reserved for a future flow; today the resolver auto-creates and returns `kind: "single"`, so this branch is unreachable but handled for type-safety.
- Caches the active `roomId` in `vscode.ExtensionContext.workspaceState` so reloading the window does not re-resolve. A reload of the same folder always re-enters Session List mode, never Room Picker, because the choice is persisted.

The watcher is the only place that has to think about multi-root workspaces: the extension picks the first folder; future work can add a folder picker.

Success criteria:

- Closing all folders shows the empty state.
- Opening a different folder replaces the session list with that folder's sessions within 1 s.
- A previously-resolved workspace folder reloading the window enters Session List mode directly (no Room Picker), because the persisted `roomId` skips the resolver.

### Step 7 — Auth bridge (read-only reuse of `~/.pibo/` login state)

**New file:** `src/apps/chat-vscode/extension/src/auth-bridge.ts`

Reuses existing CLI login state. The WebView's `TerminalLoginCard` (already in the Web App's terminal view, reused by the extension) calls `GET /api/chat/bootstrap` which already includes `bootstrap.identity` from the Web App's auth layer (`src/apps/chat/web-app.ts:3705`). No new code is needed to surface the identity in the WebView.

The auth-bridge is needed only for the `pibo.signIn` command:

- On `pibo.signIn`, call `getLoginStatus()` from `src/auth/login-actions.ts` to detect a missing provider.
- If missing, open an integrated terminal running `pibo login <provider>`.
- Once the user closes the terminal, the gateway re-emits the bootstrap on the next request, the WebView re-renders, and the user is no longer signed-out.

Success criteria:

- A user who has run `pibo login openai` in their terminal sees the same identity in the VS Code extension within 2 s of activation.
- If no provider is configured, the extension shows the same `TerminalLoginCard` already used in the Web App, with a button "Run `pibo login`" that opens an integrated terminal.

### Step 8 — Commands

**New file:** `src/apps/chat-vscode/extension/src/commands.ts`

Register the commands listed in Step 5. The commands mostly call the same gateway endpoints the Web App uses, plus a small `vscode.env.openExternal` for `pibo.openInChatWeb`.

Success criteria:

- All commands are listed in the Command Palette with the `Pibo:` prefix.
- They have icons declared in `package.json` `contributes.commands`.

### Step 9 — Vite build for the WebView

**New file:** `src/apps/chat-vscode/extension/vite.config.ts`

Mirrors `src/apps/chat-ui/vite.config.ts` with these deltas:

- `base: "./"` (relative paths, WebViews run from `vscode-extension://` URI).
- `outDir: "../../dist/webview"`.
- `build.lib.entry: "../webview/ChatTerminalApp.tsx"` (the entry from Step 2).
- Same `tailwindcss()` + `react()` plugins.
- `dedupe: ["react", "react-dom", "lexical"]` (same as chat-ui).

The new build re-uses the **identical** `tsconfig.json` and dependency tree as `src/apps/chat-ui/`. No second copy of React, Tailwind, TanStack.

`npm run vscode:webview:build` runs the new Vite config and emits to `dist/webview/`.

Success criteria:

- `dist/webview/index.html` references hashed JS/CSS bundles.
- The Tailwind output for the shared `Composer` and `CompactTerminalSessionView` is byte-identical to the Web App's output for the same input.

### Step 10 — Build & packaging scripts

**File:** `package.json` (root) and `src/apps/chat-vscode/package.json`

Add scripts (root `package.json` `scripts`):

- `vscode:webview:build` — Vite build for the WebView bundle.
- `vscode:extension:build` — esbuild bundle for the Node-side `extension.cjs`.
- `vscode:package` — runs `vsce package --no-dependencies` to produce the `.vsix`.

Add a `@vscode/vsce` dev dependency. Add a new `prepare` chain entry so the WebView is always built before the extension bundle.

Success criteria:

- `npm run vscode:package` from a clean checkout produces a `.vsix` whose `dist/webview/index.html` references the same hashed bundles as a regular `npm run chat-ui:build` would for the same source.
- Total `.vsix` size under 5 MB (most of it is the React/Tailwind runtime, identical to the web app).

### Step 11 — Documentation

- `src/apps/chat-vscode/README.md` — installation, screenshots, "How rooms are resolved", "Why my session shows up in the Web App", troubleshooting.
- `docs/specs/capabilities/pibo-vscode-extension.md` — follow the format of `channel-runtime-context.md`. Document the WebView shape, the room-resolver, the reuse of the Composer and Terminal View, and the slash command contract.
- `docs/project/architecture/chat-runtime-call-stack.md` — add a small note about the new extension.
- `GLOSSARY.md` — add three new terms: `VS Code Session Room`, `Pibo VS Code Extension`, `Workspace Room Resolver`.
- `open-work.md` — remove the corresponding line once shipped.

Success criteria:

- A new contributor can read the spec and the README in under 10 minutes and know exactly where sessions live, how the room is resolved, and which Web App components are reused.

### Step 12 — Validation

- `npm run typecheck` — must pass after every step.
- `npm run chat-ui:typecheck` — must pass; the Web App's view components and composer are imported but not modified.
- `npm run build` — full build including Vite.
- A new test `test/chat-vscode/extension.test.mjs` covers:
  - Two workspaces (`/tmp/ws-a`, `/tmp/ws-b`) get two different rooms when `resolveRoomForWorkspace` is called for each.
  - Re-calling `resolveRoomForWorkspace` for the same workspace returns the existing room (`kind: "single"`).
  - When the gateway returns two rooms for a workspace, `resolveRoomForWorkspace` returns `kind: "multiple"` with both rooms — **without** calling any picker or showing any prompt.
  - The gateway endpoint `GET /api/chat/rooms?workspace=<path>` returns only rooms with matching `workspace`.
  - A slash command like `/help` is mapped to a gateway action by `buildSlashCommands` and `runCommand` issues a `POST /api/chat/action` with the right payload.
  - The `SessionSelector` renders the Room Picker view (and unmounts the Composer / Terminal View) when `mode.kind === "rooms"`.
  - The `SessionSelector` renders the Session List view (and mounts the Composer / Terminal View) when `mode.kind === "sessions"`.
- A manual end-to-end test plan in `docs/reports/pibo-vscode-validation-2026-06-XX.md`:
  1. Open VS Code on `/tmp/test-vscode-pibo` (empty).
  2. Start `pibo gateway:web` in a separate terminal.
  3. Activate the extension. Confirm the sidebar shows the empty Pibo state until a folder is opened.
  4. Open `/tmp/test-vscode-pibo` as a folder. Confirm a new room is auto-created (visible in the Web App's room list) and the WebView shows the **Session List directly** (no Room Picker, because there is exactly one matching room).
  5. Click "New session". Type "Hello". Confirm the user message appears in the Terminal View.
  6. Type `/help` in the composer. Confirm the slash command suggestion popover appears.
  7. Submit `/help`. Confirm the action is sent to the gateway (visible in the Web App's trace).
  8. Open the Web Chat App in a browser. Confirm the new room is in the sidebar and the session is in the Session Tab.
  9. In the Web App, click the session. Confirm the same Terminal View renders the same messages (because the data store is shared).
  10. In the Web App, type `/help` in the same session. Confirm the action works.
  11. Back in VS Code, open a second folder `/tmp/test-vscode-pibo-2`. Confirm a new room is created and the session list switches.
  12. Switch back to `/tmp/test-vscode-pibo`. Confirm the original session is still there.
  13. Delete a session in the extension. Confirm it disappears in the Web App too.
  14. **Multi-room test**: in the Web App, manually create a second room with the same `workspace` field as `/tmp/test-vscode-pibo` (e.g., via `POST /api/chat/rooms` with the same workspace). Then in VS Code, run the "Reload Window" command. Confirm the WebView now renders the **Room Picker** with both rooms (name, topic, created/updated dates). Confirm the Terminal View and Composer are **not** rendered at this point.
  15. Click one of the rooms. Confirm the WebView switches to the Session List for that room, and the choice is persisted across reloads.
  16. Archive the unused duplicate room in the Web App. Confirm the next reload of the VS Code window shows the Session List directly (only one matching room again).

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| The user has not started `pibo gateway:web` | Medium | Medium | The extension shows a clear "Pibo gateway is not running at <url>" panel with a "Start gateway" button that opens an integrated terminal running `pibo gateway:web`. After 5 s the WebView retries the bootstrap. |
| The gateway URL changes between machines or VS Code windows | Low | Low | `pibo.chatWebUrl` is a `contributes.configuration` entry with a default. Users can override it per workspace. |
| The slash command catalog is stale because the user added a new plugin while the extension was running | Low | Low | The WebView re-fetches bootstrap on SSE events that include `capability.changed` patches. The composer re-renders with the new `slashCommands`. (Same pattern the Web App uses.) |
| A `PiboRoom` was created manually with a `workspace` that does not match the canonical path | Low | Low | The `room-resolver` uses `realpathSync` so symlinks resolve to the canonical path. Manual mismatches require a manual re-create; the README documents the convention. |
| Two VS Code windows on the same workspace folder could create two duplicate rooms | Low | Medium | Step 1 returns the existing room if exactly one matches. The `POST /api/chat/rooms` endpoint should add a deduplication check in M3 (re-use an existing room if the workspace matches exactly), but the current implementation may briefly create a duplicate. The Step 12 manual test plan catches this and the fix is a one-line SQL `SELECT id FROM rooms WHERE workspace = ? LIMIT 1` before INSERT. |
| A future change to the Web App's `Composer` or `CompactTerminalSessionView` breaks the extension's import | Low | High | The extension pulls from the same import path (`src/apps/chat-ui/src/...`). The typecheck in Step 12 catches breaking changes before they ship. If a future change is needed in the view to support both targets, the patch is local and reviewed in one PR. |
| `localStorage` keys collide between WebView and a parallel browser Web App session | Low | Low | The storage adapter namespaces keys with the prefix `pibo-vscode:`. The Web App's keys remain unchanged. |
| `PiboRoom.workspace` is not yet a first-class indexed column | Low | Low | It is already a column in the `rooms` table (`src/data/schema.ts`). The new query in Step 1 uses the existing column. If a migration is needed, `applyPiboDataSchema` in `src/data/schema.ts` is the entry point. |

## Sequencing & Milestones

- **M1 — Foundation (steps 1, 4):** the gateway endpoint for room-by-workspace lookup, plus the room-resolver in the extension. No VS Code UI yet. Validates that a VS Code folder maps cleanly to a `PiboRoom`.
- **M2 — VS Code skeleton (steps 5, 9, 10):** empty extension with sidebar icon, WebView that renders "no session selected" with a stub `<CompactTerminalSessionView />`. Validates build & packaging.
- **M3 — Live terminal (steps 2, 3, 6, 7, 8):** Session Selector + reused Composer + reused Terminal View + room-resolver wired to the WebView. Slash commands work end-to-end. Functional MVP.
- **M4 — Polish (steps 11, 12):** docs, validation report. Ship-ready.

Each milestone ends with a passing `npm run typecheck`, `npm run build`, and a new test or a recorded manual validation report in `docs/reports/`.

## Out of Scope / Future Work

- Multi-root workspace support (current scope: first folder only). Easy follow-up: add a `vscode.window.showQuickPick` for the folder.
- Editor WebView as a tab (`pibo.openSessionInEditor`) — easy follow-up.
- Quick-pick `pibo.searchSessions` using `vscode.quickPick` over the current room's history.
- Per-file annotations in the editor that link to a session (separate plugin idea; tracked in `open-work.md` if requested).
- Sync of sessions across machines — explicitly out of scope to keep sessions in the user's local Pibo home.
- Deduplicating duplicate rooms created in the race window (see Risks table).
