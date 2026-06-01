# PRD 09: Collapsed Output, Details, and Row Expansion

**Status:** Draft  
**Created:** 2026-05-17  
**Related docs:** `../web-terminal-reference-audit.md`, `../spec.md`, `../../../TERMINAL_DESIGN.md`

## 1. Executive Summary

### Problem Statement

The TUI correctly stopped character-truncating visible text, but the Web Terminal has a second rule: collapsed tool/command output is line-bounded. Web shows a compact preview and lets the user expand details. Ink currently risks dumping too much output by default and lacks a consistent row-owned expansion model.

### Proposed Solution

Reintroduce Web preview line bounds in the shared model while preserving wrapping. Add metadata for omitted lines and implement Ink row selection/expansion so full details are available below the parent row.

### Success Criteria

- SC-09-01: Collapsed tool/command/yielded/async/execution previews show at most five output lines.
- SC-09-02: Exploration groups show at most six child summary lines collapsed.
- SC-09-03: No visible line is character-truncated; long lines wrap.
- SC-09-04: Ink users can open details and see full Input/Output/Error.

## 2. User Experience & Functionality

- Default transcript remains compact and readable.
- Large command/tool output no longer floods the TUI.
- Details open below the parent row, preserving chronological context.
- Full content remains available without switching to Web.

## 3. Behavioral Requirements

### Collapsed previews

- Applicable rows: `tool.call`, tool-result-equivalent rows, `agent.async`, `yielded.run`, shell command rows, `execution.command`.
- Collapsed preview limit: first 5 output lines.
- Exploration group child summary limit: first 6 lines.
- Preview omission must be explicit: `+N more lines` or equivalent detail hint.
- Preview omission must not replace redaction.

### Ink expansion

- The app tracks selected row and expanded row IDs.
- Keyboard controls must not break text input or slash picker flows.
- Expansion renders directly below the row.
- Sections: `Input`, `Output`, `Error`, `Linked session` where applicable.
- JSON-looking values render through the JSON detail renderer from PRD 11.
- Compacted validation output exposes `Show full output (N lines)` or file path equivalent.

## 4. Edge Cases

- Output has fewer than five lines.
- Output has empty lines.
- Output is a JSON object, array, string, Error-like object, or unknown value.
- Row has only input, only output, only error, or linked session only.
- Narrow terminal wraps each preview line into multiple visual rows.
- Row is running and later completes while expanded.

## 5. Validation

- Shared fixture tests for preview counts and full details.
- Web tests proving existing expansion still works with new metadata.
- Ink render/controller tests for collapsed and expanded states.
- PTY test opening details for a long-output row.

## Web UI Preservation Gate

Web Compact Terminal is the reference surface and must not be changed to accommodate Ink. Ink must adapt to Web semantics. Any change under `src/session-ui/**` is Web-impacting and requires Web Compact Terminal regression evidence. Direct changes under `src/apps/chat-ui/src/session-views/compact-terminal/**` are allowed only for tests or stable semantic hooks unless the user explicitly approves a Web behavior change.

