# PRD 04: Ink Compact Terminal Renderer

**Status:** Draft  
**Created:** 2026-05-17  
**Source change:** `docs/specs/changes/ink-cli-terminal-rendering-parity/`  
**Related docs:** `../spec.md`, `../design.md`, `../../../TERMINAL_DESIGN.md`

## 1. Executive Summary

### Problem Statement

The current Ink renderer is too flat. Rows, command results, pickers, user messages, assistant messages, and cards are not visually distinct enough. The TUI does not yet feel like the Pibo Compact Terminal, even though some shared descriptors exist.

### Proposed Solution

Implement a high-quality Ink renderer that follows `TERMINAL_DESIGN.md`: transcript-first, dense, monospaced, semantic color, prefix glyphs, clear user/assistant distinction, compact spacing, inline details, and ASCII/Unicode terminal primitives. The renderer may use its own ASCII style, but must preserve the same elements and flow as Web Compact Terminal.

### Success Criteria

- SC-01: User, assistant, reasoning, tool, command, status, yielded-run, compaction, and error rows are visually distinguishable.
- SC-02: The renderer follows Compact Terminal spacing, density, and prefix semantics.
- SC-03: Narrow-width and `NO_COLOR=1` output remain readable.
- SC-04: PTY artifacts show a terminal UI that is recognizable as Pibo Compact Terminal.

## 2. User Experience & Functionality

### User Personas

- **SSH operator:** Needs a dense terminal transcript that can be read quickly.
- **Agent user:** Needs to distinguish their prompts from assistant output and tool/runtime events.
- **Reviewer:** Needs objective tests for row style, spacing, markers, and readability.

### User Stories

- As a user, I want my messages to be clearly distinguishable from assistant messages so I can scan conversation turns.
- As a user, I want tool calls, command results, status, and errors to have clear markers and tones so I can identify state quickly.
- As a user on SSH, I want the TUI to remain useful in narrow or no-color terminals.

## 3. Renderer Requirements

### Transcript Shell

- The transcript MUST be the dominant visual surface.
- Header/chrome MUST be compact and secondary.
- Rows MUST render in chronological order.
- The renderer MUST avoid dashboard-style blocks that compete with transcript rows.

### Row Structure

Rows MUST map shared `CompactTerminalRow` semantics to terminal primitives:

| Row kind | Required Ink behavior |
|---|---|
| `message.user` | Prompt glyph `›`, distinct tint/style marker, clearly separated from assistant text |
| `message.assistant` | Plain transcript prose/markdown, different marker/indent than user |
| `reasoning` | Amber thinking marker and compact reasoning block |
| `tool.call` | Bullet/status marker, action verb, function name/args, preview/detail support |
| `tool.status` | Status card/row using PRD 05 requirements |
| `tool.thinking` | Thinking card/menu using shared descriptor |
| `tool.model` | Model card/menu using shared descriptor |
| `tool.login` | Login card/menu using shared descriptor |
| `yielded.run` | Running/done/error marker and run summary |
| `execution.command` | Command row with slash/shell command and result preview |
| `execution.compaction` | Compacting/running/done state matching Web semantics |
| `error` | Red error marker, concise message, details when available |

### User vs Assistant Distinction

- User rows MUST have a distinct visual treatment analogous to the Web user tint.
- Since terminal background tints are limited, use a combination of prompt glyph, cyan/blue tone, prefix, and/or subtle border line.
- Assistant rows MUST not use the same prefix/tone as user rows.
- Tests MUST assert that user and assistant rows render with different markers or style tokens.

### Spacing and Density

- Rows SHOULD be compact: one-line rows should stay one line.
- Padding/blank lines MUST be minimal.
- Important adjacent events MUST still be distinguishable through markers, separators, or subtle spacing.
- Long content MUST wrap/truncate predictably without hiding status/error meaning.

### Details

- Expandable row details MUST appear inline below the parent row.
- Detail sections MUST use labels equivalent to Web: Input, Output, Error, Linked session, etc.
- Large JSON/markdown MUST be bounded.

### Color and No-Color

- Use semantic tones equivalent to Web: cyan action, green success, red error, amber reasoning, yellow command/function, dim metadata.
- With `NO_COLOR=1`, markers/labels must still communicate status.
- Tests MUST cover no-color output.

## 4. Technical Notes

- Continue using Ink `Box` and `Text` primitives.
- Do not import Web DOM/Tailwind/lucide components.
- Keep row/card rendering thin and descriptor-driven.
- Introduce renderer primitives if helpful:
  - `InkTerminalFrame`
  - `InkTerminalRowLayout`
  - `InkInlineTokenText`
  - `InkProgressBar`
  - `InkDetailPanel`
  - `InkBadge`

## 5. Validation Requirements

- Render tests cover every row kind listed above.
- Snapshot/semantic tests cover normal, narrow, and no-color terminals.
- PTY test captures a mixed transcript with user, assistant, tool, status, and error rows.
- Tests assert user and assistant rows are visually distinguishable.
- Typecheck passes.
- Full tests pass.

## 6. Risks & Non-Goals

### Risks

- Excessive borders can violate terminal density. Prefer subtle separators and markers over heavy cards.
- Overly exact snapshots may become brittle. Use semantic assertions plus selected golden screens.

### Non-Goals

- Pixel-perfect Web rendering.
- Mouse interactions.
- Rewriting Web Compact Terminal components.
