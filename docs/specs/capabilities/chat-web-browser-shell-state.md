# Spec: Chat Web Browser Shell State

**Status:** Draft  
**Created:** 2026-05-10  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code  
**Related docs:** [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Chat Web Trace and Terminal View](./chat-web-trace-and-terminal-view.md), [Custom Agents and Agent Designer](./custom-agents.md), [Scheduled Pibo Jobs](./scheduled-pibo-jobs.md), [Continuous Ralph Jobs](./continuous-ralph-jobs.md)

## Why

The Chat Web App is more than the backend room, session, and trace contracts. The browser shell owns route interpretation, area navigation, persisted local preferences, selected-session recovery, composer drafts, command completion, and optimistic navigation updates. These behaviors keep the UI usable across refreshes, reconnects, deep links, mobile sidebar changes, and gateway restarts.

Without a browser-shell spec, agents can change backend APIs correctly while still breaking user-visible continuity: links may canonicalize to the wrong session, drafts may leak between sessions, local preferences may reset, or transient navigation errors may leave the app unusable.

## Goal

The Chat Web browser shell MUST provide deterministic route-based navigation, resilient local browser state, and safe composer behavior while treating server state as authoritative for rooms, projects, sessions, and capabilities.

## Background / Current State

The current implementation in `src/apps/chat-ui/src/main.tsx` maps same-origin Chat Web paths under `/apps/chat` into `ChatAppRoute` values. `src/apps/chat-ui/src/App.tsx` then loads bootstrap or navigation data, canonicalizes session URLs, stores last browser selections in `localStorage`, subscribes to room and signal event streams, and passes route and preference state into the active area.

The composer stores per-session drafts, keeps a bounded message history, supports slash-command completion, supports skill reference insertion, and routes slash commands through gateway actions or browser-local commands. Browser storage failures are intentionally non-fatal.

## Scope

### In Scope

- Browser route parsing for Chat Web areas, room/session routes, project/session routes, settings panels, and session-view query state.
- Browser-side canonicalization from stale, partial, or remembered selections to authoritative server-selected room and session ids.
- `localStorage` preferences and continuity state owned by the Chat Web browser shell.
- Session and project composer draft, history, slash-command, and skill-insertion behavior.
- Browser-side live navigation refresh behavior from room event streams and session signal streams.
- Optional service worker registration and gateway health display behavior as browser-shell concerns.

### Out of Scope

- Server-side Chat Web room, session, and stream API contracts — covered by `chat-web-rooms-and-event-streams.md`.
- Trace materialization and terminal rendering semantics — covered by `chat-web-trace-and-terminal-view.md`.
- Project data model and workflow semantics — covered by `spec-product-projects-area.md`.
- Custom agent, context file, prompt, MCP, package, cron, and provider setting domain behavior — covered by their capability specs.
- Visual design tokens and layout polish — this spec only requires observable behavior.

## Requirements

### Requirement: Routes map to one browser area and optional selection

The browser shell MUST parse Chat Web URLs into exactly one area and its supported route parameters without requiring an initial backend request.

#### Current

`chatRouteFromLocation` recognizes `/`, `/sessions/:piboSessionId`, `/rooms/:roomId`, `/rooms/:roomId/sessions/:piboSessionId`, `/projects`, `/projects/:projectId`, `/projects/:projectId/sessions/:piboSessionId`, `/agents`, `/cron`, `/ralph`, `/context`, `/settings`, `/settings/pi-packages`, `/settings/skills`, and `/settings/providers`. It accepts a `view` search parameter for session-capable areas and ignores that session-view state for management-only areas such as Agents, Cron, Ralph, Context, and Settings.

#### Target

Route parsing remains deterministic and unknown paths fall back to the sessions area instead of crashing the app.

#### Acceptance

A browser-only test can call the route parser or mount the router and verify that each supported path produces the expected area, ids, settings panel, and session view.

#### Scenario: Deep link to a room session

- GIVEN the user opens `/apps/chat/rooms/room_a/sessions/ps_1?view=terminal`
- WHEN the browser shell parses the route
- THEN the app route is the sessions area with `roomId=room_a`, `piboSessionId=ps_1`, and terminal session view selected.

#### Scenario: Unknown path

- GIVEN the user opens `/apps/chat/unknown/path`
- WHEN the browser shell parses the route
- THEN the app starts in the sessions area and does not throw a routing error.

#### Scenario: Ralph management route

- GIVEN the user opens `/apps/chat/ralph?view=terminal`
- WHEN the browser shell parses the route
- THEN the app route is the Ralph management area
- AND the `view` query does not select a session view or request a session bootstrap selection.

### Requirement: Navigation URLs are canonicalized from authoritative server selection

The browser shell MUST replace stale or partial session routes with the server-selected room and session when the server returns a valid selection.

#### Current

`App` loads bootstrap or navigation data from requested route ids and remembered selections. When the returned selection differs from the route, it navigates to the selected room/session path. If a remembered room-specific session is invalid, the shell removes only that room mapping and retries without it. If remembered global state is invalid, the shell clears stored selection and retries default loading.

#### Target

Deep links, refreshes, and remembered selections converge to a valid canonical URL while explicit invalid route selections show a user-visible error instead of silently selecting unrelated work.

#### Acceptance

A UI test with mocked bootstrap/navigation endpoints can assert that stale remembered state is cleared, explicit invalid route state reports an error, and valid server selections replace partial URLs.

#### Scenario: Remembered room session no longer exists

- GIVEN local storage remembers `ps_old` for `room_a`
- AND the user opens `/apps/chat/rooms/room_a`
- WHEN the navigation request for `ps_old` fails
- THEN the shell removes only the `room_a -> ps_old` mapping
- AND retries loading `room_a` without a session id.

#### Scenario: Explicit invalid session link

- GIVEN the user opens `/apps/chat/sessions/ps_missing`
- WHEN the backend rejects the selection
- THEN the shell shows the error and does not clear unrelated remembered selections.

### Requirement: Browser preferences are local, bounded, and non-fatal

The browser shell MUST persist browser-only preferences in local storage when available and continue with defaults when storage is unavailable or malformed.

#### Current

The app stores state such as last selection, session view, composer drafts, composer history, thinking visibility, raw event visibility, archive toggles, preferred new-session profile, project archive toggles, and agent archive toggles. Storage reads and writes catch exceptions and fall back to safe defaults.

#### Target

Browser preferences improve continuity but never become required for authentication, authorization, session ownership, or data correctness.

#### Acceptance

A browser test can make `localStorage.getItem` and `setItem` throw and verify that Chat Web still renders, defaults are used, and server requests remain authenticated shared-app API calls.

#### Scenario: Locked-down browser storage

- GIVEN local storage throws on read and write
- WHEN the user opens Chat Web
- THEN the app loads server bootstrap data
- AND uses default view and preference values
- AND no preference exception escapes to the page.

### Requirement: Last session selection is remembered per browser and per room

The browser shell MUST remember the latest selected room and Pibo Session for the current browser, including room-specific session mappings, without treating them as authority over backend access.

#### Current

`readStoredSelection` accepts only string ids and filters invalid `sessionsByRoom` entries. `writeStoredSelection` merges new room/session selections into the existing room mapping. `clearStoredSelection` and `removeStoredRoomSelection` remove broken remembered state during fallback.

#### Target

A refresh without explicit route ids restores the user's last usable selection when the backend still permits it, while cross-owner or deleted records are rejected by the server and recovered by the route fallback logic.

#### Acceptance

A UI test can select two rooms with different sessions, reload each room path, and observe that the appropriate session id is requested for that room.

#### Scenario: Room-specific selection

- GIVEN the browser last selected `ps_a` in `room_a` and `ps_b` in `room_b`
- WHEN the user opens `/apps/chat/rooms/room_b` without a session id
- THEN the first navigation request targets `room_b` and `ps_b`.

### Requirement: Session view selection is URL-addressable and remembered

The browser shell MUST keep the selected session view in the URL for session-capable areas and remember the last valid view for later session navigation.

#### Current

The app reads `view` from route search, falls back to `pibo.chat.sessionView`, validates to supported view ids, and writes changes back to storage. Session and project navigation include the selected view in the route search state.

#### Target

Deep links can request a supported view, invalid view values fall back to the default, and switching views updates future navigation without changing selected session ownership.

#### Acceptance

A UI test can open a terminal-view deep link, switch views, navigate to another session, and verify that the selected view persists in the URL and local storage.

#### Scenario: Invalid view query

- GIVEN local storage contains `terminal`
- AND the user opens `/apps/chat/sessions/ps_1?view=unknown`
- WHEN the shell parses the route
- THEN the active view falls back to the default parser result
- AND no unsupported view id is passed to session view rendering.

### Requirement: Composer drafts are scoped to one session

The composer MUST store unsent draft text per Pibo Session ID and clear that draft after successful submit or explicit empty value.

#### Current

The sessions composer reads and writes `pibo.chat.composerDraft.<piboSessionId>`. Project sessions keep their active composer state tied to the route Pibo Session. Forking with selected text writes the selected text into the derived session draft before navigating.

#### Target

Typing in one session does not affect another session, and fork-derived selected text appears only in the derived session composer.

#### Acceptance

A UI test can type drafts in two sessions, switch between them, and verify each session restores only its own draft.

#### Scenario: Switch sessions with drafts

- GIVEN the user typed `draft A` in `ps_a`
- AND typed `draft B` in `ps_b`
- WHEN the user returns to `ps_a`
- THEN the composer shows `draft A`
- AND `draft B` remains associated with `ps_b`.

### Requirement: Composer history is bounded and avoids adjacent duplicates

The composer MUST keep a browser-local history of submitted messages that can be navigated with arrow keys when the current composer is empty.

#### Current

`appendStoredComposerHistory` trims entries, ignores empty values, skips adjacent duplicates, and stores at most `COMPOSER_HISTORY_LIMIT` entries. History navigation starts only from an empty composer, restores the original draft when moving past the newest entry, and resets when the session changes.

#### Target

History assists local input without resubmitting text automatically or leaking server-side message records.

#### Acceptance

A component test can submit more than the history limit, assert only the newest limit remains, and verify adjacent duplicates are not added.

#### Scenario: Navigate message history

- GIVEN the composer is empty
- AND browser history contains `first` then `second`
- WHEN the user presses ArrowUp
- THEN the composer shows `second`
- WHEN the user presses ArrowDown past the newest entry
- THEN the composer restores the draft that existed before history navigation.

### Requirement: Slash commands and skill insertions are explicit composer actions

The composer MUST distinguish normal messages, slash commands, and skill insertions before submit.

#### Current

The app builds slash commands from registered gateway actions, excluding `/tree`, and adds browser-local `/download` and `/thinking-show`. If a typed slash prefix matches commands but is not an exact command, submit completes the command instead of sending. Skill suggestions appear for `$` triggers and insertion replaces only the trigger range.

#### Target

Command completion and skill insertion are visible, keyboard-accessible actions. Normal text submission only happens when no command or skill completion should consume the submit.

#### Acceptance

A component test can type `/thi`, press Enter, and verify the composer completes the command rather than sending a message. A second test can type a `$` trigger and verify insertion replaces the trigger with the selected skill name.

#### Scenario: Browser-local thinking toggle

- GIVEN `/thinking-show` is visible in command suggestions
- WHEN the user submits `/thinking-show`
- THEN the shell toggles local historical thinking visibility
- AND does not post a message to the selected session.

### Requirement: Live navigation indicators are eventually consistent

The browser shell MUST update visible session status and navigation state from live streams, but it MUST refresh from server state when events imply structural changes.

#### Current

For the sessions area, the shell subscribes to room event streams from the latest known room stream id. It updates visible session status from live events and schedules a full bootstrap refresh for navigation-changing events. It also subscribes to the selected session's signal tree, applies snapshots and patches to local bootstrap state, and refetches a signal snapshot if a patch cannot be applied.

#### Target

Live indicators feel responsive during active work, while room/session trees remain server-authoritative after creates, archive changes, deletes, forks, clones, or missed patches.

#### Acceptance

A UI integration test can feed a running event and verify status updates immediately, then feed a structural event and verify a delayed bootstrap refresh is scheduled.

#### Scenario: Signal patch cannot apply

- GIVEN the shell has a signal snapshot for `ps_root`
- WHEN a signal patch arrives that cannot be applied to the current snapshot
- THEN the shell requests a fresh signal tree for `ps_root`
- AND replaces local signal/bootstrap overlays with the fresh snapshot.

### Requirement: Optional browser platform features do not block Chat Web

The browser shell MUST treat service worker registration and gateway health display as optional enhancements.

#### Current

`main.tsx` registers `sw.js` on load when service workers are available and ignores registration failures. `App` polls `/health` every five seconds to display main or fallback gateway mode and clears the display when health checks fail.

#### Target

A failed service worker registration or health request never prevents Chat Web from rendering or sending authenticated API requests.

#### Acceptance

A browser test can force service worker registration and `/health` to fail and verify that the app still renders bootstrap content and allows session selection.

#### Scenario: Gateway health request fails

- GIVEN the Chat Web API is otherwise usable
- AND `/health` times out
- WHEN the health poll runs
- THEN gateway mode display becomes unknown
- AND no page-level error is shown.

## Edge Cases

- Malformed local-storage JSON returns default values and does not clear valid server state.
- Browser storage write failures do not prevent route navigation, message submit, or command execution.
- Explicit invalid deep links show errors; implicit remembered selections are recoverable.
- Archived rooms disable message and command submission in that room.
- Mobile navigation may close the sidebar on route changes, but callers can keep it open for specific flows.
- The same session view query is meaningful only for session-capable areas; non-session management areas such as Agents, Cron, Ralph, Context, and Settings ignore it.
- Composer history is browser-local and may contain text from different sessions; drafts remain session-scoped.

## Constraints

- **Compatibility:** Existing Chat Web paths under `/apps/chat` must remain deep-link compatible.
- **Security / Privacy:** Browser-local state is not an access-control mechanism. All room, project, session, and mutation requests must remain authenticated and resolved by shared resource semantics on the server.
- **Performance:** Live stream handlers should patch small local state immediately and defer full bootstrap refreshes with a short debounce instead of reloading on every delta.
- **Reliability:** The UI must tolerate missing storage, failed service worker registration, health timeouts, stale remembered ids, and missed signal patches.
- **Dependencies:** The behavior depends on TanStack Router, TanStack Query, browser `localStorage`, EventSource, and the Chat Web server APIs.

## Success Criteria

- [ ] SC-001: All documented Chat Web paths map to the expected browser route without backend access.
- [ ] SC-002: Stale remembered selections are recoverable, while explicit invalid links surface errors.
- [ ] SC-003: Disabling or breaking local storage does not prevent the app from rendering and navigating.
- [ ] SC-004: Composer drafts are scoped by Pibo Session ID and do not leak across sessions.
- [ ] SC-005: Composer history remains bounded to 100 non-empty entries and ignores adjacent duplicates.
- [ ] SC-006: Slash-command completion, browser-local commands, and skill insertion consume submit before normal message sending.
- [ ] SC-007: Live events update visible running status and schedule server refresh for navigation-changing events.
- [ ] SC-008: Service worker and health-poll failures are non-fatal.

## Assumptions and Open Questions

### Assumptions

- Browser-local preferences are intentionally per-browser, not synced through Pibo accounts.
- The backend remains the authority for shared room, project, and session existence. Legacy membership/owner fields do not authorize current product behavior.
- The current two supported session views are the default trace-style view and the terminal view.

### Open Questions

- Should composer history become per-session like drafts, or remain global browser-local history?
- Should route parsing be exported for direct unit tests instead of tested only through router mounting?
- Should local preference keys be versioned before changing stored shapes?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Routes map to one browser area and optional selection | Deep link to a room session; Unknown path; Ralph management route | Browser route tests for `src/apps/chat-ui/src/main.tsx` | Pending |
| REQ-002 Navigation URLs are canonicalized from authoritative server selection | Remembered room session no longer exists; Explicit invalid session link | Navigation fallback tests | Pending |
| REQ-003 Browser preferences are local, bounded, and non-fatal | Locked-down browser storage | Local storage failure tests | Pending |
| REQ-004 Last session selection is remembered per browser and per room | Room-specific selection | Selection persistence tests | Pending |
| REQ-005 Session view selection is URL-addressable and remembered | Invalid view query | Session view routing tests | Pending |
| REQ-006 Composer drafts are scoped to one session | Switch sessions with drafts | Composer draft tests | Pending |
| REQ-007 Composer history is bounded and avoids adjacent duplicates | Navigate message history | Composer history tests | Pending |
| REQ-008 Slash commands and skill insertions are explicit composer actions | Browser-local thinking toggle | Composer command tests | Pending |
| REQ-009 Live navigation indicators are eventually consistent | Signal patch cannot apply | Event stream and signal tests | Pending |
| REQ-010 Optional browser platform features do not block Chat Web | Gateway health request fails | Optional platform tests | Pending |

## Verification Basis

This spec is based on the current code in:

- `src/apps/chat-ui/src/main.tsx`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/cache.ts`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/RalphArea.tsx`
- `src/apps/chat-ui/src/session-views/types.ts`
- `src/apps/chat/web-app.ts`
- `src/apps/chat/stream.ts`
- `test/chat-ui-integration.test.mjs`
