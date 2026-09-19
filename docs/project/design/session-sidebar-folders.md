---
type: "Decision Record"
title: "Design System: Session Sidebar Room Folders"
description: "Preserves the supporting visual and interaction design rationale for the Chat Web session sidebar room-folder tree."
tags: ["chat-web", "design", "rooms", "sessions", "sidebar"]
status: "draft"
authority: "supporting"
generated:
  by: "process:muse-code"
  at: "2026-09-19T15:01:41Z"
---
# Design System: Session Sidebar Room Folders

The Chat Web session sidebar renders Rooms as an expandable folder tree with their Sessions nested inside, replacing the previous flat Room list plus separate selected-Room Session list. Room rows stay visually quiet; only the selected Session carries a full-bleed selection. This record preserves the visual and interaction rationale. The normative Room/Session data contracts in [Chat Web Rooms and Session Trees](/specs/web/rooms-and-session-trees.md) are unchanged: folders are a presentational projection with client-side expansion state.

Primary reference files:

- `src/apps/chat-ui/src/session-sidebar.tsx` (`SessionSidebar`, `RoomNode`, `RoomFolderBranch`, `ForeignRoomFolderSessions`)
- `src/apps/chat-ui/src/session-folder-model.ts` (expansion state, pinned filter, status overlay)
- `src/apps/chat-ui/src/session-node.tsx` (`SessionNode` full-bleed selection)
- `src/apps/chat-ui/src/action-menu.tsx` (shared menu, custom trigger icons)
- `src/apps/chat-ui/src/App.tsx` (`createSession(profile, roomId)` cross-Room creation)
- `test/chat-ui-session-sidebar-folders.test.mjs` (folder behavior coverage)

## 1. Layout and hierarchy

- One `Rooms` section lists every Room as a folder row. The Shared Chat (personal/default) Room sorts first inside that same list without its own heading.
- Each expanded folder shows that Room's Sessions directly beneath its row, connected by a thin muted vertical guide line in the same style as the existing Subsession connectors. Nested Rooms render as nested folders with cumulative guides.
- A pinned-only pin toggle in the section header filters every folder to pinned Sessions.
- Expansion state persists per browser via `session-folder-model` storage; the active Room is always expanded.

## 2. Room rows

- Room rows carry no selection frame or background, selected or not. Unread badges, loading spinners, and drag indicators still render on the row.
- The folder icon is the expand/collapse toggle. Open Rooms show the folder-open glyph, collapsed Rooms the folder glyph. Shared Chat keeps its green lock and archived Rooms their amber archive glyph in both states.
- The Room that contains the selected Session is marked icon-only: the icon tile draws the standard accent border and the glyph takes the accent color (blue for standard Rooms, green for Shared Chat, amber for archived Rooms). Inactive tiles use a transparent border so activation never shifts layout.
- Room name clicks only expand/collapse. They never select a Room or load a Session. A Room counts as active once a Session inside it is selected. Archived and legacy nested Rooms without a folder toggle keep select-on-click.

## 3. Session rows and selection

- The selected Session fills edge to edge: the translucent accent fill spans from the folder guide line on the left to the sidebar edge on the right, with a 3px solid accent bar seated on the guide line. The row keeps its exact size and content alignment, so status lamps stay in one column across selected and unselected rows.
- Session rows carry their own insets so the selection can bleed without overflowing the scroll container or introducing a horizontal scrollbar.
- Flat legacy lists (Room support unavailable) select full width without a left bleed.

## 4. Per-Room actions

- Each Room row has an inline Plus button that opens the agent menu for that Room; the menu checks the Room's default agent and creating a Session stores the chosen agent as that Room's preference.
- Workflow Sessions and archived-Session visibility moved into the selected Room's `...` action menu. The global agent select and the separate New-Workflow/New-Session toolbar are gone.
- Foreign (non-active) Rooms lazily load a Session preview with `Show more` paging; rename, archive, pin, delete, and context actions refresh that Room's preview after the mutation.

## 5. Loading and stability behavior

- Expanding a Room with no data shows a single minimal spinner row, never a shimmer skeleton.
- Foreign Room Sessions are cached per Room (stale-while-revalidate): re-expanding or returning to a Room renders instantly while a silent background refresh keeps data fresh.
- Foreign lists refetch only on mount and when their own Room unread count changes, never on unrelated session switches or signal overlays.
- Scroll position restores only on Room-list key changes and loading transitions, never on Session selection, so switching Sessions cannot move the sidebar.
- Clicking a Session in another Room keeps the already-rendered cached list during navigation and flips to the props-driven list once data arrives, instead of flashing the loading skeleton.

## 6. Accessibility and responsive notes

- Folder toggles expose `aria-expanded` with `Collapse room X` / `Expand room X` labels; Room and Session navigation buttons expose `aria-current`. Guide lines and the selection bar are decorative and hidden from assistive technology.
- The loading spinner row uses `role="status"` with a `Loading room sessions` label.
- Compact mode, mobile breakpoints, drag-and-drop indicators, and the archived-Rooms section keep their existing contracts.
