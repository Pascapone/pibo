# PRD 08: Web Terminal Difference Matrix and Shared Fixtures

**Status:** Draft  
**Created:** 2026-05-17  
**Source change:** `docs/specs/changes/ink-cli-terminal-rendering-parity/`  
**Related docs:** `../web-terminal-reference-audit.md`, `../spec.md`, `../tasks.md`, `../../../TERMINAL_DESIGN.md`

## 1. Executive Summary

### Problem Statement

Ink parity work has improved `/status`, wrapping, and warning noise, but implementation still advances through small symptom fixes. The team needs a complete difference matrix derived from the Web Compact Terminal, plus shared fixtures that make those differences executable.

### Proposed Solution

Create a Web-vs-Ink terminal matrix that covers layout, row grammar, spacing, preview/expansion, JSON, markdown, status, streaming, slash commands, pickers, owner/room/session labels, and validation evidence. Add or extend shared fixtures so each matrix row has a testable fixture, not just prose.

### Success Criteria

- SC-08-01: A durable matrix lists every known Web Compact Terminal law, current Ink behavior, required target behavior, and owning PRD/story.
- SC-08-02: Shared fixtures cover long output, nested JSON, markdown, status, room/session labels, slash commands, pickers, streaming/running rows, and errors.
- SC-08-03: Tests fail if Web and Ink drift on row kinds, statuses, preview counts, descriptor labels, or redaction.
- SC-08-04: Future Ralph stories can be generated from matrix rows without rereading the conversation.

## 2. User Experience & Functionality

### User Personas

- **SSH operator:** Wants the TUI to behave like Web Terminal View, including names and details, not just IDs.
- **Reviewer:** Wants a precise checklist showing what remains different and how each gap is verified.
- **Implementer/Ralph:** Needs small executable stories tied to fixtures and acceptance checks.

### User Stories

- As an SSH operator, I want room names, session names, statuses, tool previews, and JSON to match Web semantics so I can navigate without decoding IDs.
- As a reviewer, I want all Web-derived terminal laws captured in one matrix so I can detect partial parity claims.
- As an implementer, I want fixtures for every behavior so I can change renderers safely.

## 3. Required Difference Matrix Areas

The matrix MUST include at least:

1. **Terminal shell and header chrome**: profile/model/error badges, breadcrumbs, owner/session/room display, command hints, top chrome density.
2. **Row grammar**: prefix column, row-first vs card-first behavior, user/assistant distinction, running/done/error markers.
3. **Spacing**: row `py-2` equivalent, no decorative blank lines, detail gap 0-2 lines, major divider rules.
4. **Preview/expansion**: five output preview lines, six exploration child summaries, no per-line character truncation, full details.
5. **Details**: row-owned expansion, Input/Output/Error, linked session controls, compacted full-output disclosure.
6. **JSON**: inline function-call JSON, nested disclosure, string/literal/key/punctuation tones, detail JSON wells.
7. **Markdown and code**: headings, lists, blockquotes, inline code, fenced code, tables, reasoning tone.
8. **Status**: context/provider bars, remaining quota, state badges, folded tools, unavailable states, warnings/errors.
9. **Streaming**: live/running rows, Working footer semantics, chronological append behavior.
10. **Slash commands**: all catalog commands and command-result placement.
11. **Pickers/overlays**: owner, room, session, agent, model, login, thinking, fork candidates.
12. **Room/session naming**: Web room names and session titles resolved everywhere, IDs secondary.
13. **Accessibility/no-color/narrow terminal**: text markers, ASCII fallbacks, wrapping behavior.

## 4. Fixture Requirements

Fixtures MUST be renderer-neutral under `test/fixtures/` or equivalent and cover:

- Long output with at least 12 lines.
- Long unbroken tokens and long wrapped prose.
- Nested object/array JSON with strings over 140 chars.
- Markdown with headings, lists, blockquotes, inline code, fenced code, table, and reasoning variant.
- Status with available, partial, zero, high, unavailable, warnings, errors, credits, plan, context, and provider limits.
- Room/session data with Web-style names, renamed rooms, default room, archived room, missing room, and room ID fallback.
- Slash command result rows for supported, terminal-adapted, browser-only/deferred, and error cases.
- Streaming order with user message, assistant message, reasoning, tool call, command result, and status result.

## 5. Validation Requirements

- Shared fixture tests assert semantic equality before renderer snapshots.
- Web tests assert the fixture maps to expected DOM hooks and collapse/expand semantics.
- Ink tests assert equivalent text/ANSI semantics without importing Web components.
- PTY evidence is not required for every fixture in this PRD, but the matrix must mark which later PRD provides PTY evidence.

## Web UI Preservation Gate

Web Compact Terminal is the reference surface and must not be changed to accommodate Ink. Ink must adapt to Web semantics. Any change under `src/session-ui/**` is Web-impacting and requires Web Compact Terminal regression evidence. Direct changes under `src/apps/chat-ui/src/session-views/compact-terminal/**` are allowed only for tests or stable semantic hooks unless the user explicitly approves a Web behavior change.

## 6. Non-Goals

- Implementing all renderer changes in this PRD.
- Pixel-perfect Web reproduction in terminal cells.
- Replacing Web Compact Terminal components.
