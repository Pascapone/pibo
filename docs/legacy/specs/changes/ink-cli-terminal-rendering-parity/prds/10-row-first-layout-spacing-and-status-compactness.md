# PRD 10: Row-First Layout, Spacing, and Status Compactness

**Status:** Draft  
**Created:** 2026-05-17  
**Related docs:** `../web-terminal-reference-audit.md`, `../spec.md`, `../../../TERMINAL_DESIGN.md`

## 1. Executive Summary

### Problem Statement

Ink still renders too many normal events as `✓ ▣` cards. Web Terminal treats normal tools, commands, yielded runs, compaction, and errors as transcript rows. Card-like surfaces are exceptions for structured controls. This difference creates extra vertical spacing and a product feel that diverges from Web.

### Proposed Solution

Refactor Ink rendering so normal events use row-first grammar: prefix glyph, terse verb, inline tokens, bounded preview, and optional details. Keep structured renderers for status/thinking/login/model, but compact status/header chrome to match Web's dense rhythm.

### Success Criteria

- SC-10-01: Normal tool/command/yielded/error rows no longer render decorative `▣` headers.
- SC-10-02: Adjacent rows match Web spacing rhythm: compact, row-owned, no unexplained blank lines.
- SC-10-03: Status remains structured but less dump-like: grouped fields, relevant badges, folded tools.
- SC-10-04: Header chrome is compact and does not dominate transcript content.

## 2. Row Grammar Requirements

Normal row kinds:

- `tool.call`
- `tool.group.exploring`
- `agent.delegation`
- `agent.async`
- `yielded.run`
- `execution.command`
- `execution.compaction`
- `error`

These MUST render as terminal rows first. They may have details, but not card headers by default.

Structured exceptions:

- `tool.status`
- `tool.thinking`
- `tool.login`
- `tool.model`

These may render as structured terminal-native panels because Web also uses special control cards for them.

## 3. Spacing Requirements

- One CompactTerminalRow maps to one compact Ink row block.
- Detail preview lines sit directly under parent line with continuation/detail markers.
- No blank spacer between ordinary adjacent transcript rows.
- One spacer may be used only for semantic overlay/header separation.
- No repeated long status/header metadata inside normal rows.
- Narrow wrapping must keep prefix/content alignment readable.

## 4. Status Compactness Requirements

- Continue using real runtime data.
- Context/provider bars use remaining quota wording and remaining-based bars.
- Show processing/streaming/queued/disposed badges only when relevant.
- Fold enabled tools by default or summarize with count; full tool names belong in details/expansion.
- Avoid duplicating the same provider limit in multiple forms unless Web does.
- Warnings/errors remain high signal.

## 5. Header Requirements

- Header is external chrome, not transcript.
- Room/session names should appear when available, with IDs secondary.
- Header should not repeat every field from `/status`.
- Long identifiers may wrap, but should not crowd out the transcript.

## 6. Validation

- Ink snapshots cover adjacent user/assistant/tool/command/status/error rows.
- Snapshot tests fail on `▣` for normal row kinds.
- PTY visual artifact demonstrates dense transcript spacing with status and normal rows.

## Web UI Preservation Gate

Web Compact Terminal is the reference surface and must not be changed to accommodate Ink. Ink must adapt to Web semantics. Any change under `src/session-ui/**` is Web-impacting and requires Web Compact Terminal regression evidence. Direct changes under `src/apps/chat-ui/src/session-views/compact-terminal/**` are allowed only for tests or stable semantic hooks unless the user explicitly approves a Web behavior change.

