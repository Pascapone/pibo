# Spec: Chat Web Virtualized Session Scrolling

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Source coverage job, based on current workspace code
**Related docs:**
- [Chat Web Trace and Terminal View](./chat-web-trace-and-terminal-view.md)
- [Chat Web Cache and Live State](./chat-web-cache-and-live-state.md)
- [Chat Web Trace Render Diagnostics](./chat-web-trace-render-diagnostics.md)

## Why

Long-running Pibo Sessions can produce large trace trees and compact terminal transcripts. The Chat Web App must keep these views usable while runtime output streams, while history is loaded, and while a user inspects older rows.

Scrolling behavior is user-visible product behavior, not only a rendering optimization. The app must follow new output when the user is reading the latest content and must stop following when the user intentionally scrolls away.

## Goal

Session views SHALL render large trace and terminal timelines with bounded browser work, stable row identity, and predictable sticky-to-latest behavior.

## Background / Current State

The Trace Session View and Compact Terminal Session View use virtualized lists. Both route their scroll behavior through a shared sticky-scroll hook. The hook tracks whether the viewer is at the bottom, distinguishes user scroll intent from content growth, resets on session or trace changes, and exposes a `Scroll to latest` action when the view is no longer sticky.

The development build can count selected component renders through a browser global, and the repository contains a CDP-based performance script that records long tasks while exercising heavy Chat Web actions.

## Scope

### In Scope

- Virtualized rendering behavior for Trace Session View and Compact Terminal Session View.
- Sticky-to-latest behavior while output streams or row heights change.
- User-controlled pause and resume of automatic following.
- Stable row identity for virtualization and live patching.
- Browser-side performance diagnostics used to verify large-session behavior.

### Out of Scope

- Server-side trace materialization and event ingestion — covered by trace and data-store specs.
- Exact visual styling of trace cards or terminal rows — covered by UI implementation and design docs.
- Replacing the virtualization library — this spec defines behavior, not a required dependency.

## Requirements

### Requirement: Session timelines are virtualized

The Chat Web App MUST render Trace Session and Compact Terminal Session rows through a viewport-bounded list instead of mounting every row in the DOM.

#### Current

Trace timeline rows and compact terminal rows are passed to virtualized list components with overscan windows.

#### Target

Large sessions remain scrollable without requiring all historical rows to be mounted at once.

#### Acceptance

A browser inspection of a large session shows that only the visible row window and bounded overscan are mounted, while all rows remain reachable by scrolling.

#### Scenario: Large trace opens

- GIVEN a Pibo Session has many trace spans
- WHEN a user opens the Trace Session View
- THEN the view initially lands at the latest row
- AND older rows can be reached by scrolling
- AND the browser does not mount one DOM subtree per trace span.

### Requirement: Row identity is stable across live updates

Each rendered timeline row MUST expose a stable key derived from the underlying trace or terminal row identity.

#### Current

Trace rows use visible span row ids, and compact terminal rows use terminal row ids as virtualization keys.

#### Target

Streaming updates, expansion changes, and live patches preserve unaffected row identity.

#### Acceptance

When new output appends to a selected session, unchanged visible rows keep their virtualization keys and local expansion state is not reset except where the backing trace or view selection changes.

#### Scenario: New output appends

- GIVEN a user expanded a row in a selected session
- WHEN new runtime output adds later rows
- THEN the expanded row keeps its identity
- AND the new rows append without remounting unrelated rows.

### Requirement: Sticky scrolling follows only when the user is at the latest content

The session view MUST automatically stay at the latest content while the viewer is sticky and MUST stop auto-following when the user intentionally scrolls away.

#### Current

The shared sticky-scroll hook tracks bottom proximity, wheel and touch movement, pointer actions, keyboard scrolling, and scroll direction.

#### Target

Automatic scrolling helps users follow active work without fighting users who inspect earlier output.

#### Acceptance

While the viewer is at the bottom, appended rows and row-height changes keep the latest content visible. After the user scrolls upward, appended rows do not force the scroll position back to the bottom.

#### Scenario: User reads older output during streaming

- GIVEN a session is streaming output and the view is showing the latest row
- WHEN the user scrolls upward with wheel, touch, pointer, or keyboard input
- THEN the view exits sticky mode
- AND later output does not pull the user back to the latest row.

### Requirement: A paused viewer can return to the latest content explicitly

When automatic following is paused, the session view MUST expose an explicit `Scroll to latest` control.

#### Current

Both trace and compact terminal views render a bottom-right button when the sticky hook reports non-sticky state.

#### Target

Users can resume following without manually dragging to the end of a long list.

#### Acceptance

When the viewer is not sticky, an accessible control titled or labeled `Scroll to latest` is visible. Activating it scrolls to the latest row and restores sticky following.

#### Scenario: Resume following

- GIVEN a user has scrolled away from the latest row
- WHEN the user activates `Scroll to latest`
- THEN the latest row becomes visible
- AND future appended output remains visible until the user scrolls away again.

### Requirement: Session or trace changes reset sticky state safely

Changing the selected session or backing trace MUST reset sticky state and avoid carrying scroll intent from the previous view.

#### Current

Trace view resets on trace id changes, and compact terminal view resets on Pibo Session ID changes.

#### Target

A newly selected conversation starts at the latest content and does not inherit paused scrolling from another session.

#### Acceptance

After navigating from one Pibo Session to another, the selected view is sticky by default and displays the latest content when rows exist.

#### Scenario: User switches sessions

- GIVEN a user scrolled away from the bottom in one session
- WHEN the user opens another session
- THEN the new session view starts in sticky mode
- AND old scroll intent timers do not affect the new view.

### Requirement: Content growth inside existing rows preserves latest visibility

When sticky mode is active, row-height changes inside the last visible rows MUST keep the viewport aligned to the latest content.

#### Current

The sticky hook reacts to content keys and total list height changes, then schedules bottom alignment after animation frames.

#### Target

Streaming text, expanding tool output, and measured row-height changes do not leave the latest content partially hidden when the user is following output.

#### Acceptance

During streaming assistant or tool output, the latest content remains visible even when existing row content grows without increasing the row count.

#### Scenario: Streaming row grows

- GIVEN the viewer is sticky and an assistant or tool row is growing
- WHEN the row height changes without adding a new row
- THEN the viewport remains aligned to the bottom.

### Requirement: Performance checks are explicit and artifact-producing

Performance validation for Chat Web session views MUST be an explicit developer action that records browser long-task results to a report file.

#### Current

The performance check script connects to an existing CDP target, navigates to Chat Web, exercises heavy UI actions, records long tasks, writes JSON under `docs/reports/` by default, and exits non-zero when the configured maximum long task is exceeded.

#### Target

Agents can produce repeatable evidence when changing virtualization, live state, or large-session rendering behavior.

#### Acceptance

Running the performance check with a valid Chat Web URL and CDP page endpoint writes a JSON report containing the checked URL, timestamp, long-task count, maximum long-task duration, and individual long-task entries.

#### Scenario: Developer validates a large-session change

- GIVEN a browser target is open to an authenticated Chat Web environment
- WHEN an agent runs the performance check with `--cdp-url` and `--url`
- THEN the script writes a report file
- AND exits with failure if the maximum observed long task exceeds the configured threshold.

### Requirement: Development render counters are non-production diagnostics

Render counting MUST be available only in development builds and MUST NOT create production-visible state.

#### Current

The render counter returns immediately unless the bundler reports development mode, then increments counts on a browser global.

#### Target

Render diagnostics help identify regressions during development without affecting production behavior or user data.

#### Acceptance

In a production build, no render counter global is created by the counter helper. In a development build, instrumented components can increment named counters for inspection.

#### Scenario: Production user opens Chat Web

- GIVEN Chat Web is built for production
- WHEN a user opens a session view
- THEN render counting does not create or mutate a diagnostics global.

## Edge Cases

- Empty timelines show an empty state instead of an empty virtualized list.
- Negative or invalid latest-row indexes do not attempt to scroll.
- Sticky intent timers are cleared when the view unmounts.
- Keyboard scrolling counts as user intent for common navigation keys.
- Pointer intent is recognized only when the pointer action targets the scrolling surface.
- The performance script must fail fast when URL or CDP input is missing.

## Constraints

- **Compatibility:** Session view behavior must remain compatible with existing Trace Session View and Compact Terminal Session View contracts.
- **Security / Privacy:** Performance reports must stay local artifacts and must not upload trace content or browser state.
- **Performance:** Large-session changes must preserve viewport-bounded rendering and avoid unbounded DOM growth.
- **Dependencies:** The behavior may use a virtualization library, but tests and acceptance checks should verify observable scrolling and rendering behavior rather than library internals.

## Success Criteria

- [ ] SC-001: Trace and compact terminal session views mount bounded row windows for large sessions.
- [ ] SC-002: Appended output follows the bottom only while the viewer is sticky.
- [ ] SC-003: User scroll intent pauses automatic following until `Scroll to latest` is activated or the viewer returns to the bottom.
- [ ] SC-004: Session and trace changes reset sticky state and start at the latest row.
- [ ] SC-005: A CDP performance check writes a long-task report and fails when the configured threshold is exceeded.
- [ ] SC-006: Render counters mutate diagnostics state only in development builds.

## Assumptions and Open Questions

### Assumptions

- Current virtualization behavior is the product baseline and should be preserved unless a future spec changes it.
- The default long-task threshold is a diagnostic guardrail, not a formal product SLO.

### Open Questions

- What fixture size should become the canonical large-session benchmark for CI or release validation?
- Should the performance report include row counts and mounted DOM counts in addition to long-task data?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Session timelines are virtualized | Large trace opens | Source-backed; add browser fixture test | Draft |
| REQ-002 Row identity is stable across live updates | New output appends | Source-backed; add key stability regression test | Draft |
| REQ-003 Sticky scrolling follows only when the user is at the latest content | User reads older output during streaming | Source-backed; add sticky-scroll hook test | Draft |
| REQ-004 A paused viewer can return to the latest content explicitly | Resume following | Source-backed; add UI accessibility test | Draft |
| REQ-005 Session or trace changes reset sticky state safely | User switches sessions | Source-backed; add navigation regression test | Draft |
| REQ-006 Content growth inside existing rows preserves latest visibility | Streaming row grows | Source-backed; add streaming row-height test | Draft |
| REQ-007 Performance checks are explicit and artifact-producing | Developer validates a large-session change | Source-backed; manual/script validation | Draft |
| REQ-008 Development render counters are non-production diagnostics | Production user opens Chat Web | Source-backed; build-mode unit test | Draft |

## Verification Basis

This spec is based on the current workspace code in:

- `src/apps/chat-ui/src/components/useStickyVirtuoso.ts`
- `src/apps/chat-ui/src/tracing/TraceTimeline.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx`
- `src/apps/chat-ui/src/renderMetrics.ts`
- `scripts/chat-web-performance-check.mjs`
- `package.json`
