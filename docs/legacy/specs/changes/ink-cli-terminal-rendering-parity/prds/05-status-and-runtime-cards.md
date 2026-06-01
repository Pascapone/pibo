# PRD 05: Status and Runtime Cards

**Status:** Draft  
**Created:** 2026-05-17  
**Source change:** `docs/specs/changes/ink-cli-terminal-rendering-parity/`  
**Related docs:** `../spec.md`, `../design.md`, `04-ink-compact-terminal-renderer.md`, `src/apps/chat-ui/src/session-views/compact-terminal/TerminalStatusCard.tsx`

## 1. Executive Summary

### Problem Statement

The current TUI status output is too verbose and does not match the Web Compact Terminal status component. It exposes long owner strings, debug messages, and unavailable fields in a way that feels noisy. It lacks a concise ASCII status layout with meaningful context/provider quota bars.

### Proposed Solution

Implement an Ink status/runtime card that uses the same shared status descriptor semantics as Web, but renders in a compact ASCII/ANSI style. The card must show the same categories as Web when available: session, cwd, processing/streaming/queue badges, context usage, provider quota, credits, enabled tools, warnings, and errors. Missing values must be compact and non-noisy.

### Success Criteria

- SC-01: `/status` renders as a compact terminal status card in transcript flow.
- SC-02: Ink status content matches Web status categories and shared descriptor semantics.
- SC-03: Context and provider quota render as readable ASCII progress bars when available.
- SC-04: Unavailable data is concise and does not dominate the screen.
- SC-05: Secrets are redacted.

## 2. User Experience & Functionality

### User Personas

- **SSH operator:** Needs a fast runtime snapshot without reading debug dumps.
- **Web Compact Terminal user:** Expects the same status concepts in TUI as in Web.
- **Reviewer:** Needs deterministic status fixtures for full, partial, unavailable, and error states.

### User Stories

- As a user, I want `/status` to show runtime health, model/session context, and quota in a compact terminal card.
- As a user, I want context/quota bars when data exists so I can scan usage quickly.
- As a user, I do not want long owner ids and debug messages to drown out useful status.

## 3. Status Content Requirements

### Required Data Categories

The Ink status card MUST support the same categories as the Web status card where data is available:

- title: `Status`
- session id/title
- cwd/workspace
- processing badge
- streaming badge
- queued message count
- disposed/error state
- context usage bar
- provider quota/usage bars
- provider plan type where available
- credits where available
- enabled/active tools count and optional expansion/detail
- owner/profile/model/runtime fields when provided by CLI runtime
- warnings and errors

### Compact Display Rules

- Primary line SHOULD summarize runtime state, session/model, and owner in abbreviated form.
- Long owner scopes SHOULD be abbreviated by default while full scope remains available in detail/status text when needed.
- Debug messages such as “discovered 68 sessions” SHOULD not appear in the primary status card unless they are warnings/errors or explicitly relevant.
- Unavailable context/provider data SHOULD render compactly, for example:
  ```text
  ctx unavailable   quota unavailable
  ```
  not multiple verbose lines.
- Zero usage MUST be rendered as `0.0%`, not unavailable.
- Missing usage MUST be rendered as unavailable, not zero.

### ASCII Progress Bars

When available, context/provider quota MUST render as text bars:

```text
ctx    ███████░░░ 72.0%  72k/100k tokens
quota  ███░░░░░░░ 25.0%  openai requests
```

Requirements:

- Width adapts to terminal width.
- Bar uses filled/empty glyphs or ASCII fallback.
- Tone follows shared threshold semantics: green/yellow/red or equivalent markers.
- `NO_COLOR=1` remains understandable.

### Transcript Flow

- `/status` MUST append an `execution.command` row and a `tool.status` row/card.
- The status card MUST appear immediately above the input/current prompt after execution.
- Running/streaming transcript rows already visible MUST remain before the command/status rows.

## 4. Parity with Web TerminalStatusCard

### Web Concepts to Preserve

- Header/title and health/state indication.
- Session/cwd fields.
- State badges for processing/streaming/queue/disposed.
- Context usage progress.
- Provider quota progress and reset/remaining details where available.
- Credits summary.
- Enabled tools collapsed/expanded concept or concise count in TUI.

### Ink-Specific Rendering

- Use text markers instead of icons.
- Use ASCII/Unicode progress bars instead of CSS bars.
- Use compact inline badges instead of DOM pills.
- Prefer dense row layout over card chrome.

## 5. Acceptance Criteria

- Full status fixture renders session, cwd, processing, streaming, queue, context bar, provider quota bar, credits, tools, warnings, and errors.
- Partial status fixture renders only available fields plus compact unavailable context/quota.
- Zero usage fixture renders `0.0%` bars.
- High usage fixture uses warning/error tone or marker.
- Secret-bearing status fields are redacted.
- `/status` PTY artifact shows the status card in transcript flow, not header message.
- Status output stays readable at narrow width.
- Web status descriptor tests and Ink status renderer tests use the same fixture.

## 6. Technical Notes

- Extend `TerminalStatusViewModel` only with renderer-neutral fields.
- Add Ink-specific status formatting helpers only under `src/apps/cli-ui` if they are presentation-specific.
- Avoid always rendering every possible field. Favor concise primary layout plus optional detail rows.
- Ensure provider usage supports non-OpenAI providers; label must come from descriptor data.

## 7. Validation Requirements

- Shared status view model tests for full/partial/unavailable/zero/high/error states.
- Ink render tests for ASCII bars and compact unavailable states.
- PTY test for live `/status` path.
- PTY or fake-source test with provider quota available.
- Web regression test for `TerminalStatusCard` shared descriptor use.
- Typecheck passes.
- Full tests pass.

## 8. Risks & Non-Goals

### Risks

- Live provider quota may be unavailable locally. Use deterministic fixtures for bar rendering and live path for command flow.
- Too many fields can recreate the current noisy output. Keep compactness as an acceptance criterion.

### Non-Goals

- Adding new provider quota APIs.
- Pixel-perfect Web card rendering.
